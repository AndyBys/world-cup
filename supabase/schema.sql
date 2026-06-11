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
  max_players int     not null default 9,
  passcode    text    not null,             -- admin draw secret; never exposed to clients
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

  select max_players, teams into v_max, v_teams from config where id = 1;
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

  v_drawn := exists (select 1 from assignments);

  -- Late joiner: grab a random team that nobody has yet (before inserting, so a
  -- clean error if none remain — the whole function is one transaction anyway).
  if v_drawn then
    select t into v_team
    from unnest(v_teams) as t
    where t not in (select team from assignments)
    order by random()
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
-- Admin-only. Verifies the passcode, then (idempotently) shuffles the team pool
-- and assigns one team per player. Refuses to re-draw once assignments exist.

create or replace function public.run_draw(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass  text;
  v_teams text[];
begin
  select passcode, teams into v_pass, v_teams from config where id = 1;
  if v_pass is null then
    raise exception 'NO_CONFIG' using hint = 'Game is not configured yet.';
  end if;

  if coalesce(p_passcode, '') <> v_pass then
    raise exception 'BAD_PASSCODE' using hint = 'Wrong admin passcode.';
  end if;

  if exists (select 1 from assignments) then
    raise exception 'ALREADY_DRAWN' using hint = 'The lottery has already been drawn.';
  end if;

  if not exists (select 1 from players) then
    raise exception 'NO_PLAYERS' using hint = 'Nobody has signed up yet.';
  end if;

  if (select count(*) from players) > coalesce(array_length(v_teams, 1), 0) then
    raise exception 'NOT_ENOUGH_TEAMS'
      using hint = 'There are more players than teams in the pool.';
  end if;

  -- Pair each player (random order) with a team (random order) by row number.
  insert into assignments (player_id, team)
  select p.id, t.team
  from (
    select id, row_number() over (order by random()) as rn
    from players
  ) p
  join (
    select team, row_number() over (order by random()) as rn
    from unnest(v_teams) as team
  ) t on t.rn = p.rn;
end;
$$;

-- Allow the anonymous (public) API role to call the two functions.
grant execute on function public.join_lobby(text) to anon;
grant execute on function public.run_draw(text)   to anon;

-- ===========================================================================
-- SEED — EDIT THIS before playing.
--   * teams: national-team names spelled exactly as in openfootball
--            (e.g. 'Mexico', 'Canada', 'South Korea', 'Czech Republic').
--            Provide at least as many teams as max_players.
--   * passcode: a secret only you know — needed to run the draw.
-- These are placeholders so the flow is testable immediately.
-- ===========================================================================
insert into public.config (id, teams, max_players, passcode)
values (
  1,
  array['Spain','France','England','Portugal','Brazil',
        'Argentina','Germany','Netherlands','Norway'],
  9,
  'change-me'
)
on conflict (id) do update
  set teams = excluded.teams,
      max_players = excluded.max_players,
      passcode = excluded.passcode;
