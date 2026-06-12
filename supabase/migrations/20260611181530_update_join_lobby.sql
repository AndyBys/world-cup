-- ===========================================================================
-- Late-join update for join_lobby().
-- Run this whole file in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- It replaces the existing join_lobby function so that:
--   * BEFORE the draw  → it just adds the player to the lobby.
--   * AFTER the draw   → it adds the player AND assigns them a random team that
--                        nobody has yet (a late joiner gets a vacant team).
--   * If the draw is done and every team is taken → the join is rejected.
-- Safe to run multiple times.
-- ===========================================================================

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

  -- Late joiner: grab a random team that nobody has yet (checked before insert,
  -- so a clean error if none remain — the whole function is one transaction).
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

grant execute on function public.join_lobby(text) to anon;
