-- ===========================================================================
-- Migration: match-prediction game (1 / X / 2) with a public leaderboard.
-- Run this WHOLE file in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to run on top of schema.sql — it only ADDS columns/tables/functions and
-- replaces run_draw with a predicts-aware version. Passcode/players untouched.
--
-- Identity: lightweight per-player PIN (name + 4-digit PIN), bcrypt-hashed.
-- Integrity: predictions are tied to the PIN-verified player and LOCKED at
-- kickoff using the server-owned `fixtures` table (never the client's clock).
-- Visibility: picks are public (anon can SELECT predictions).
-- ===========================================================================

create extension if not exists pgcrypto;

-- --- 1. Per-player PIN + predictor flag -------------------------------------
-- pin_hash null  = name not yet claimed for predictions.
-- predicts_only  = this player joined only to predict; the lottery draw ignores
--                  them so they never consume a team or break "more players
--                  than teams".
alter table public.players add column if not exists pin_hash     text;
alter table public.players add column if not exists predicts_only boolean not null default false;

-- --- 2. Server-authoritative fixtures (kickoff + settled result) ------------
-- The source of truth for the kickoff lock and settlement. Populated by the
-- sync-fixtures Edge Function from the same public feeds the client displays,
-- but server-side so it can't be spoofed. match_key must match the client's
-- matchKey() helper: lower-cased, diacritic-free `date|team1|team2`.
create table if not exists public.fixtures (
  match_key   text primary key,
  team1       text        not null,
  team2       text        not null,
  kickoff_utc timestamptz not null,
  round       text        not null,
  grp         text,
  result      text check (result in ('1','X','2')),  -- null until settled
  ft          int[],                                  -- final score, for display
  updated_at  timestamptz not null default now()
);

-- --- 3. Predictions (one row per player per match) --------------------------
create table if not exists public.predictions (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players(id)  on delete cascade,
  match_key  text not null references public.fixtures(match_key) on delete cascade,
  pick       text not null check (pick in ('1','X','2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, match_key)
);

-- --- 4. Row Level Security --------------------------------------------------
-- Everyone may READ fixtures + predictions (picks are public). Nobody writes
-- directly: predictions go through submit_prediction; fixtures are written by
-- the Edge Function using the service-role key (which bypasses RLS).
alter table public.fixtures    enable row level security;
alter table public.predictions enable row level security;

drop policy if exists fixtures_read    on public.fixtures;
drop policy if exists predictions_read on public.predictions;
create policy fixtures_read    on public.fixtures    for select using (true);
create policy predictions_read on public.predictions for select using (true);

-- --- 5. PIN verification helper (internal; not granted to anon) -------------
-- Returns the player id when name+PIN are valid, else raises. NEVER exposes the
-- hash. Used by submit_prediction.
-- search_path includes `extensions` because Supabase installs pgcrypto
-- (crypt/gen_salt) there, not in public.
create or replace function public.verify_pin(p_name text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key  text := lower(btrim(coalesce(p_name, '')));
  v_id   uuid;
  v_hash text;
begin
  select id, pin_hash into v_id, v_hash from players where name_key = v_key;
  if v_id is null then
    raise exception 'NO_PLAYER' using hint = 'No such player — claim your name first.';
  end if;
  if v_hash is null then
    raise exception 'NO_PIN' using hint = 'Set a PIN for this name first.';
  end if;
  if crypt(coalesce(p_pin, ''), v_hash) <> v_hash then
    raise exception 'BAD_PIN' using hint = 'Wrong PIN for that name.';
  end if;
  return v_id;
end;
$$;

-- --- 6. claim_player: set PIN (first time) or log in (after) ----------------
-- - Existing lottery player, no PIN yet  → set it (claim) and return id.
-- - Existing player with a PIN           → verify it (login) and return id.
-- - Unknown name                         → self-register a predicts_only player
--                                          with this PIN (harmless to the draw).
-- PIN must be exactly 4 digits.
create or replace function public.claim_player(p_name text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_key  text := lower(v_name);
  v_id   uuid;
  v_hash text;
begin
  if v_name = '' then
    raise exception 'EMPTY_NAME' using hint = 'Please enter your name.';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    raise exception 'WEAK_PIN' using hint = 'PIN must be exactly 4 digits.';
  end if;

  select id, pin_hash into v_id, v_hash from players where name_key = v_key;

  if v_id is null then
    -- New predictor (not in the lottery). predicts_only so run_draw skips them.
    insert into players (name, name_key, pin_hash, predicts_only)
    values (v_name, v_key, crypt(p_pin, gen_salt('bf')), true)
    returning id into v_id;
    return v_id;
  end if;

  if v_hash is null then
    update players set pin_hash = crypt(p_pin, gen_salt('bf')) where id = v_id;
    return v_id;
  end if;

  if crypt(p_pin, v_hash) <> v_hash then
    raise exception 'BAD_PIN' using hint = 'That name is taken — wrong PIN.';
  end if;
  return v_id;
end;
$$;

-- --- 7. submit_prediction: verify PIN, enforce kickoff lock, upsert ---------
create or replace function public.submit_prediction(
  p_name text, p_pin text, p_match_key text, p_pick text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := public.verify_pin(p_name, p_pin);
  v_kickoff timestamptz;
begin
  if p_pick not in ('1','X','2') then
    raise exception 'BAD_PICK' using hint = 'Pick must be 1, X or 2.';
  end if;

  select kickoff_utc into v_kickoff from fixtures where match_key = p_match_key;
  if v_kickoff is null then
    raise exception 'NO_MATCH' using hint = 'Unknown match.';
  end if;
  if now() >= v_kickoff then
    raise exception 'LOCKED' using hint = 'This match has kicked off — picks are closed.';
  end if;

  insert into predictions (player_id, match_key, pick)
  values (v_id, p_match_key, p_pick)
  on conflict (player_id, match_key)
  do update set pick = excluded.pick, updated_at = now();
end;
$$;

-- --- 8. Public leaderboard view --------------------------------------------
-- 1 point per correct settled outcome. Picks on unsettled matches don't score.
create or replace view public.prediction_leaderboard as
select
  p.id   as player_id,
  p.name as name,
  count(*) filter (where f.result is not null)                          as settled,
  count(*) filter (where f.result is not null and pr.pick = f.result)   as points,
  count(*)                                                              as picks
from players p
join predictions pr on pr.player_id = p.id
join fixtures    f  on f.match_key  = pr.match_key
group by p.id, p.name;

-- --- 9. run_draw: exclude predicts_only players ----------------------------
-- Same top-N logic, but prediction-only sign-ups never enter the lottery draw.
create or replace function public.run_draw(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass  text;
  v_teams text[];
  v_drawn boolean;
  v_count int;
begin
  select passcode, teams, drawn into v_pass, v_teams, v_drawn from config where id = 1;
  if v_pass is null then
    raise exception 'NO_CONFIG' using hint = 'Game is not configured yet.';
  end if;
  if coalesce(p_passcode, '') <> v_pass then
    raise exception 'BAD_PASSCODE' using hint = 'Wrong admin passcode.';
  end if;
  if v_drawn then
    raise exception 'ALREADY_DRAWN' using hint = 'The lottery has already been drawn.';
  end if;

  select count(*) into v_count
  from players p
  where not p.predicts_only
    and not exists (select 1 from assignments a where a.player_id = p.id);

  if v_count = 0 then
    update config set drawn = true where id = 1;
    return;
  end if;
  if v_count > coalesce(array_length(v_teams, 1), 0) then
    raise exception 'NOT_ENOUGH_TEAMS'
      using hint = 'There are more players than teams in the pool.';
  end if;

  insert into assignments (player_id, team)
  select p.id, t.team
  from (
    select id, row_number() over (order by random()) as rn
    from players p2
    where not p2.predicts_only
      and not exists (select 1 from assignments a where a.player_id = p2.id)
  ) p
  join (
    select team, row_number() over (order by random()) as rn
    from unnest(v_teams[1:v_count]) as team
  ) t on t.rn = p.rn;

  update config set drawn = true where id = 1;
end;
$$;

-- --- 10. Grants -------------------------------------------------------------
grant execute on function public.claim_player(text, text)               to anon;
grant execute on function public.submit_prediction(text, text, text, text) to anon;
grant select on public.fixtures               to anon;
grant select on public.predictions            to anon;
grant select on public.prediction_leaderboard to anon;
-- verify_pin is intentionally NOT granted to anon (internal helper only).
