-- ===========================================================================
-- Migration: 20-team pool + "top N" draw
-- Run this WHOLE file in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to run after the original schema.sql — it only updates config + the two
-- functions, and does NOT touch your passcode or any existing players.
--   * Pool grows to Opta's top-20 teams, ordered strongest-first.
--   * run_draw now deals out only the TOP N teams (N = number of players).
--   * Late joiners get the best still-unassigned team (next down the list).
-- ===========================================================================

-- --- 1. Bigger, ranked pool (passcode untouched) ---------------------------
update public.config
set teams = array[
      'Spain','France','England','Argentina','Portugal','Brazil','Germany',
      'Netherlands','Norway','Belgium','Colombia','Morocco','Uruguay',
      'Switzerland','Croatia','Ecuador','Japan','USA','Senegal','Mexico'
    ],
    max_players = 20
where id = 1;

-- --- 2. run_draw: deal out the TOP N teams ---------------------------------
create or replace function public.run_draw(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass  text;
  v_teams text[];
  v_count int;
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

  select count(*) into v_count from players;
  if v_count = 0 then
    raise exception 'NO_PLAYERS' using hint = 'Nobody has signed up yet.';
  end if;

  if v_count > coalesce(array_length(v_teams, 1), 0) then
    raise exception 'NOT_ENOUGH_TEAMS'
      using hint = 'There are more players than teams in the pool.';
  end if;

  -- Each player (random order) gets one of the TOP N teams (random order).
  insert into assignments (player_id, team)
  select p.id, t.team
  from (
    select id, row_number() over (order by random()) as rn
    from players
  ) p
  join (
    select team, row_number() over (order by random()) as rn
    from unnest(v_teams[1:v_count]) as team
  ) t on t.rn = p.rn;
end;
$$;

-- --- 3. join_lobby: late joiner gets the best available team ----------------
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

  if v_drawn then
    -- Best still-unassigned team by ranking (teams stored strongest-first).
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
