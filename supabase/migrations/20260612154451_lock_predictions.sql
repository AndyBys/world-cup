-- ===========================================================================
-- Make predictions ONE-SHOT (final, no edits) — anti-cheat.
-- Run this WHOLE file in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Was: submit_prediction upserted, so a pick could be changed any time before
-- kickoff. Now: the first pick is inserted and locked; a second attempt raises
-- ALREADY_PICKED. Combined with the existing kickoff lock, a pick can be made
-- once and never revised.
-- ===========================================================================

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
  on conflict (player_id, match_key) do nothing;
  if not found then
    raise exception 'ALREADY_PICKED'
      using hint = 'You already predicted this match — picks are final.';
  end if;
end;
$$;
