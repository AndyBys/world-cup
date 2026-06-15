-- Per-match win probabilities (1 / X / 2) derived from bookmaker odds.
-- Populated by the sync-odds Edge Function once a day from The Odds API:
-- implied prob = 1/decimal-odds per outcome, then proportionally normalised so
-- p1 + px + p2 = 1 (the bookmaker margin is removed). NULL until odds are posted
-- (only near-future matches get a line), and stays NULL for matches no book covers.
--
-- Additive, forward-only: new nullable columns, no data touched. The existing
-- anon SELECT policy on fixtures already exposes these to the browser.

alter table public.fixtures
  add column if not exists p1 real,            -- P(team1 win), 0..1
  add column if not exists px real,            -- P(draw)
  add column if not exists p2 real,            -- P(team2 win)
  add column if not exists odds_updated_at timestamptz;
