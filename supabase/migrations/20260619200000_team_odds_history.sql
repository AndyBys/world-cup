-- Daily history of bookmaker title-win probabilities, so the Lobby can draw a
-- line chart of how each team's odds drift over the tournament. The sync-odds
-- Edge Function appends one snapshot per team per UTC day (a second run the same
-- day just overwrites that day's row via the (team, snap_date) primary key).
--
-- `team_odds` keeps only the latest value; this table keeps the trail. Both are
-- written from the same outright-market fetch. Bookmaker-only by design — there
-- is no pre-tournament backfill (The Odds API historical endpoint is paid), so
-- the series simply starts the day this ships and grows daily.
--
-- Additive, forward-only.

create table if not exists public.team_odds_history (
  team        text not null,                       -- openfootball spelling, matches team_odds
  snap_date   date not null,                        -- the UTC day of the snapshot
  prob        real not null,                        -- title-win prob, 0..1
  recorded_at timestamptz not null default now(),
  primary key (team, snap_date)
);

alter table public.team_odds_history enable row level security;
drop policy if exists team_odds_history_read on public.team_odds_history;
create policy team_odds_history_read on public.team_odds_history for select using (true);

grant select on public.team_odds_history to anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.team_odds_history
  from anon, authenticated;

-- Seed today's point from the latest team_odds so the chart isn't empty on day
-- one (sync-odds already populated team_odds with real outright odds).
insert into public.team_odds_history (team, snap_date, prob)
select team, (updated_at at time zone 'utc')::date, prob
from public.team_odds
on conflict (team, snap_date) do update set prob = excluded.prob, recorded_at = now();
