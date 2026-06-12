-- ===========================================================================
-- Migration: Ultra-Gamble mode
-- Run this whole file once in the Supabase SQL editor on an existing database.
-- (For a fresh install, schema.sql already includes everything below.)
--
-- Adds an opt-in "ultra-gamble" sign-up: instead of waiting for the draw to
-- deal a top team, the player is instantly assigned a random *underdog* from a
-- separate 8-team pool. Ultra teams are unique — once all 8 are taken, further
-- ultra sign-ups are rejected (ULTRA_FULL) and the player should join normally.
-- ===========================================================================

-- --- Schema changes (idempotent) -------------------------------------------
alter table public.players add column if not exists is_ultra boolean not null default false;

alter table public.config  add column if not exists drawn boolean not null default false;
alter table public.config  add column if not exists ultra_teams text[] not null default array[
  'Curaçao','Haiti','Iraq','Cape Verde','Jordan','Uzbekistan','New Zealand','Panama'
];

-- Backfill the drawn flag for a game that was already drawn before this migration.
update public.config set drawn = true
where id = 1 and exists (select 1 from public.assignments);

-- --- join_ultra -------------------------------------------------------------
-- Adds a player in ultra-gamble mode and immediately assigns them a random,
-- still-unassigned underdog from config.ultra_teams. Same name/capacity/dedupe
-- rules as join_lobby. Rejects (ULTRA_FULL) when all underdogs are taken.
-- The whole thing is one transaction, so a rejection inserts no player.

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

  -- Random underdog that nobody holds yet.
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

-- --- join_lobby (replace) ---------------------------------------------------
-- Same as before, EXCEPT the late-join phase is now keyed off config.drawn
-- rather than the existence of any assignment (ultra players hold assignments
-- before the main draw runs, so the old check would misfire).

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

  -- Late joiner: grab the best team nobody has yet (incl. teams not held by
  -- ultra players). Done before insert so a clean error if none remain.
  if v_drawn then
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

-- --- run_draw (replace) -----------------------------------------------------
-- Now deals only to players who don't already hold a team (ultra players are
-- pre-assigned), and flips config.drawn so the lobby knows the draw has run.

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

  -- Only players still without a team (ultra players already have one).
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

-- --- Grants -----------------------------------------------------------------
grant execute on function public.join_ultra(text) to anon;
grant execute on function public.is_drawn()        to anon;
grant execute on function public.join_lobby(text)  to anon;
grant execute on function public.run_draw(text)    to anon;
