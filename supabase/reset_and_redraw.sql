-- ===========================================================================
-- HOTFIX (v2): production was never migrated to the ranked 20-team pool.
-- Run this WHOLE file in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- What went wrong: the live config.teams still held the OLD pool (Canada,
-- Mexico, "United States", …) AND the old full-pool run_draw, so the redraw
-- dealt the wrong teams. v1 of this script only fixed the function, not the
-- pool — this version fixes both, then re-opens the draw.
--
-- This script:
--   1. Replaces config.teams with the Opta top-20 (ranked strongest-first),
--      sets ultra_teams + max_players. Passcode is UNTOUCHED.
--   2. Re-applies the correct top-N run_draw + join_lobby (idempotent).
--   3. Clears the bad draw — KEEPS ultra-gamble players' underdog teams.
--   4. Resets the drawn flag so you can re-draw from the app (Admin → Draw).
-- ===========================================================================

-- --- 1. Ranked 20-team pool (passcode untouched) ---------------------------
update public.config
set teams = array[
      'Spain','France','England','Argentina','Portugal','Brazil','Germany',
      'Netherlands','Norway','Belgium','Colombia','Morocco','Uruguay',
      'Switzerland','Croatia','Ecuador','Japan','USA','Senegal','Mexico'
    ],
    ultra_teams = array[
      'Curaçao','Haiti','Iraq','Cape Verde','Jordan','Uzbekistan',
      'New Zealand','Panama'
    ],
    max_players = 20
where id = 1;

-- --- 2. Correct top-N run_draw (deals only v_teams[1:N]) --------------------
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
    where not exists (select 1 from assignments a where a.player_id = p2.id)
  ) p
  join (
    select team, row_number() over (order by random()) as rn
    from unnest(v_teams[1:v_count]) as team
  ) t on t.rn = p.rn;

  update config set drawn = true where id = 1;
end;
$$;

-- --- 3. join_lobby: late joiner gets the best still-unassigned team ---------
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

-- --- 4. Wipe the bad draw, keep ultra underdogs ----------------------------
delete from assignments a
using players p
where a.player_id = p.id
  and p.is_ultra = false;

-- --- 5. Re-open the draw ----------------------------------------------------
update config set drawn = false where id = 1;

-- Done. Now open the app → Admin → enter passcode → Draw. With 5 players it
-- deals the top 5 — Spain, France, England, Argentina, Portugal — at random.
