-- Live title-win probabilities per team, refreshed daily by the sync-odds Edge
-- Function from The Odds API outright ("winner") market: implied prob =
-- 1/decimal-odds per team, proportionally normalised across the whole field so
-- the bookmaker overround is removed. Stored as a 0..1 fraction (like the
-- fixtures p1/px/p2 columns).
--
-- This is the *current* number. The *original* pre-tournament snapshot stays
-- hardcoded in src/lib/pool.ts (the Opta 1-June figures) and also defines the
-- fixed draw order in config.teams — neither is touched here. The Lobby shows
-- both, so a team's movement is visible (e.g. Spain 16% -> 18%).
--
-- Additive, forward-only: new table, no existing data touched. Empty until the
-- first sync runs, so the UI simply omits "current" until a line is posted.

create table if not exists public.team_odds (
  team       text primary key,          -- openfootball spelling, matches config.teams
  prob       real not null,             -- live title-win prob, 0..1
  updated_at timestamptz not null default now()
);

-- Everyone may READ; nobody writes directly. The Edge Function writes with the
-- service-role key (bypasses RLS); the browser only ever reads.
alter table public.team_odds enable row level security;
drop policy if exists team_odds_read on public.team_odds;
create policy team_odds_read on public.team_odds for select using (true);

grant select on public.team_odds to anon, authenticated;

-- Defense in depth (mirrors 20260615203000_revoke_anon_table_writes): keep the
-- protection from hinging on RLS alone.
revoke insert, update, delete, truncate, references, trigger
  on public.team_odds
  from anon, authenticated;
