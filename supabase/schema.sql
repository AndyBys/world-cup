-- ===========================================================================
-- World Cup 2026 Friends Lottery — Supabase schema
-- Run this whole file in the Supabase SQL editor (Dashboard → SQL → New query).
-- Then edit the seed row at the bottom with YOUR teams, max_players and passcode.
-- ===========================================================================

-- --- Tables -----------------------------------------------------------------

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_key   text not null unique,          -- lower(trim(name)), used for dedupe
  is_ultra   boolean not null default false, -- opted into ultra-gamble at sign-up
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null unique references public.players(id) on delete cascade,
  team       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.config (
  id          int primary key default 1,
  teams       text[]  not null,             -- the prize pool (>= max_players entries)
  ultra_teams text[]  not null default '{}',-- the ultra-gamble underdog pool
  max_players int     not null default 9,
  passcode    text    not null,             -- admin draw secret; never exposed to clients
  drawn       boolean not null default false,-- set true by run_draw (lobby phase flag)
  constraint config_singleton check (id = 1)
);

-- --- Row Level Security -----------------------------------------------------
-- Everyone (anon) may READ players + assignments so the roster and results show.
-- Nobody may write directly: all mutations go through the SECURITY DEFINER
-- functions below. The config table is NOT readable by anon (it holds the passcode).

alter table public.players     enable row level security;
alter table public.assignments enable row level security;
alter table public.config      enable row level security;

drop policy if exists players_read     on public.players;
drop policy if exists assignments_read on public.assignments;

create policy players_read     on public.players     for select using (true);
create policy assignments_read on public.assignments for select using (true);
-- (no policies on config → anon cannot read it at all)

-- --- join_lobby -------------------------------------------------------------
-- Adds a player. Enforces: non-empty name, capacity, dedupe.
-- Phase-aware: BEFORE the draw it just adds you to the lobby; AFTER the draw
-- (late joiner) it also assigns you a random still-unassigned team in the same
-- atomic step. If the draw is done and every team is taken, the join is rejected.
-- Returns the new player's id.

create or replace function public.join_lobby(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_key   text := lower(v_name);
  v_max   int;
  v_teams text[];
  v_count int;
  v_drawn boolean;
  v_team  text;
  v_id    uuid;
begin
  if v_name = '' then
    raise exception 'EMPTY_NAME' using hint = 'Please enter your name.';
  end if;

  select max_players, teams, drawn into v_max, v_teams, v_drawn from config where id = 1;
  if v_max is null then
    raise exception 'NO_CONFIG' using hint = 'Game is not configured yet.';
  end if;

  select count(*) into v_count from players;
  if v_count >= v_max then
    raise exception 'LOBBY_FULL' using hint = 'The lobby is full.';
  end if;

  if exists (select 1 from players where name_key = v_key) then
    raise exception 'DUPLICATE_NAME' using hint = 'That name is already taken.';
  end if;

  -- Late joiner (keyed off the draw flag, not assignment existence — ultra
  -- players hold assignments before the main draw runs). Grab the best team
  -- nobody has yet, before inserting, so a clean error if none remain.
  if v_drawn then
    -- Best still-unassigned team by ranking (teams are stored strongest-first),
    -- so a late joiner brings the next team down the list into play.
    select t into v_team
    from unnest(v_teams) as t
    where t not in (select team from assignments)
    order by array_position(v_teams, t)
    limit 1;

    if v_team is null then
      raise exception 'NO_TEAMS_LEFT'
        using hint = 'The draw is done and every team is taken.';
    end if;
  end if;

  insert into players (name, name_key) values (v_name, v_key) returning id into v_id;

  if v_drawn then
    insert into assignments (player_id, team) values (v_id, v_team);
  end if;

  return v_id;
end;
$$;

-- --- run_draw ---------------------------------------------------------------
-- Admin-only. Verifies the passcode, then (idempotently) deals out the TOP N
-- teams of the pool (N = number of players; teams are stored strongest-first)
-- and randomly assigns one to each player. Refuses to re-draw once assignments
-- exist. So 10 players → the top 10 teams are in play; weaker pool teams only
-- enter if more friends join (incl. late joiners, see join_lobby).

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

  -- Only players still without a team (ultra players are pre-assigned).
  select count(*) into v_count
  from players p
  where not exists (select 1 from assignments a where a.player_id = p.id);

  if v_count = 0 then
    -- Everyone went ultra (or nobody to deal to): mark drawn and stop.
    update config set drawn = true where id = 1;
    return;
  end if;

  if v_count > coalesce(array_length(v_teams, 1), 0) then
    raise exception 'NOT_ENOUGH_TEAMS'
      using hint = 'There are more players than teams in the pool.';
  end if;

  -- Pair each not-yet-assigned player (random order) with one of the TOP N
  -- pool teams (v_teams[1:N], random order) by row number. Ultra teams are a
  -- disjoint pool, so the top N normal teams are always free here.
  insert into assignments (player_id, team)
  select p.id, t.team
  from (
    select id, row_number() over (order by random()) as rn
    from players p2
    where not exists (select 1 from assignments a where a.player_id = p2.id)
  ) p
  join (
    select team, row_number() over (order by random()) as rn
    from unnest(v_teams[1:v_count]) as team
  ) t on t.rn = p.rn;

  update config set drawn = true where id = 1;
end;
$$;

-- --- join_ultra -------------------------------------------------------------
-- Ultra-gamble sign-up: adds a player and instantly assigns a random,
-- still-unassigned underdog from config.ultra_teams. Same name/capacity/dedupe
-- rules as join_lobby; rejects (ULTRA_FULL) when all 8 underdogs are taken.

create or replace function public.join_ultra(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_key   text := lower(v_name);
  v_max   int;
  v_ultra text[];
  v_count int;
  v_team  text;
  v_id    uuid;
begin
  if v_name = '' then
    raise exception 'EMPTY_NAME' using hint = 'Please enter your name.';
  end if;

  select max_players, ultra_teams into v_max, v_ultra from config where id = 1;
  if v_max is null then
    raise exception 'NO_CONFIG' using hint = 'Game is not configured yet.';
  end if;

  select count(*) into v_count from players;
  if v_count >= v_max then
    raise exception 'LOBBY_FULL' using hint = 'The lobby is full.';
  end if;

  if exists (select 1 from players where name_key = v_key) then
    raise exception 'DUPLICATE_NAME' using hint = 'That name is already taken.';
  end if;

  select t into v_team
  from unnest(v_ultra) as t
  where t not in (select team from assignments)
  order by random()
  limit 1;

  if v_team is null then
    raise exception 'ULTRA_FULL'
      using hint = 'All ultra underdogs are taken — join the normal lottery.';
  end if;

  insert into players (name, name_key, is_ultra) values (v_name, v_key, true)
    returning id into v_id;
  insert into assignments (player_id, team) values (v_id, v_team);

  return v_id;
end;
$$;

-- --- is_drawn ---------------------------------------------------------------
-- Anon can't read config (it holds the passcode), so expose just the draw flag.
create or replace function public.is_drawn()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select drawn from config where id = 1), false);
$$;

-- Allow the anonymous (public) API role to call the two functions.
grant execute on function public.join_lobby(text) to anon;
grant execute on function public.run_draw(text)   to anon;
grant execute on function public.join_ultra(text) to anon;
grant execute on function public.is_drawn()       to anon;

-- ===========================================================================
-- SEED — EDIT THIS before playing.
--   * teams: national-team names spelled exactly as in openfootball
--            (e.g. 'Mexico', 'Canada', 'South Korea', 'Czech Republic').
--            Provide at least as many teams as max_players.
--   * passcode: a secret only you know — needed to run the draw.
-- These are placeholders so the flow is testable immediately.
-- ===========================================================================
-- teams MUST be ordered strongest-first: run_draw deals out the top N teams
-- (N = number of players). Source: Opta Analyst top-20 win odds, 1 Jun 2026.
insert into public.config (id, teams, ultra_teams, max_players, passcode)
values (
  1,
  array['Spain','France','England','Argentina','Portugal','Brazil','Germany',
        'Netherlands','Norway','Belgium','Colombia','Morocco','Uruguay',
        'Switzerland','Croatia','Ecuador','Japan','USA','Senegal','Mexico'],
  -- ultra-gamble underdog pool (must match src/lib/ultra.ts):
  array['Curaçao','Haiti','Iraq','Cape Verde','Jordan','Uzbekistan',
        'New Zealand','Panama'],
  20,
  'change-me'
)
on conflict (id) do update
  set teams = excluded.teams,
      ultra_teams = excluded.ultra_teams,
      max_players = excluded.max_players,
      passcode = excluded.passcode;
