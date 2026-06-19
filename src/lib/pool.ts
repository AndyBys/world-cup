// The national teams in this lottery's prize pool, each with its pre-tournament
// World Cup *title* probability (%). Shown on the draw page so friends can see
// what they might be drawn. Source: Opta Analyst predictions, 1 June 2026
// (top 20 by win probability).
//
// IMPORTANT: the pool is ordered strongest-first, and the draw deals out the
// TOP N teams where N = number of players (10 players → Spain…Belgium). Keep
// this list in the same order as Supabase config.teams so "top N" matches.
//
// Stored as raw decimals (e.g. 16.1) and displayed rounded (16.1 → 16%).
// `team` names must match openfootball spelling (USA, not "United States").
//
// These are the ORIGINAL pre-tournament numbers and also fix the draw order
// (config.teams). The CURRENT live numbers come from the `team_odds` table —
// see getCurrentOdds() below — and are shown alongside these, never replacing
// them. The draw is unaffected by the live odds.

import { supabase } from './supabase';

export interface PoolTeam {
  team: string;
  /** Win probability as a raw percentage, e.g. 16.1 for 16.1%. */
  prob: number;
}

export const POOL: PoolTeam[] = [
  { team: 'Spain', prob: 16.1 },
  { team: 'France', prob: 13 },
  { team: 'England', prob: 11.2 },
  { team: 'Argentina', prob: 10.4 },
  { team: 'Portugal', prob: 7 },
  { team: 'Brazil', prob: 6.6 },
  { team: 'Germany', prob: 5.1 },
  { team: 'Netherlands', prob: 3.6 },
  { team: 'Norway', prob: 3.5 },
  { team: 'Belgium', prob: 2.4 },
  { team: 'Colombia', prob: 2.1 },
  { team: 'Morocco', prob: 1.9 },
  { team: 'Uruguay', prob: 1.7 },
  { team: 'Switzerland', prob: 1.7 },
  { team: 'Croatia', prob: 1.6 },
  { team: 'Ecuador', prob: 1.4 },
  { team: 'Japan', prob: 1.2 },
  { team: 'USA', prob: 1.2 },
  { team: 'Senegal', prob: 1 },
  { team: 'Mexico', prob: 1 },
];

/** Pool sorted strongest-first. */
export function poolByOdds(): PoolTeam[] {
  return [...POOL].sort((a, b) => b.prob - a.prob);
}

/** Live title-win probability for one team (raw percent, e.g. 18.3 for 18.3%). */
export interface CurrentOdds {
  /** Percent, comparable to PoolTeam.prob (so 0.183 fraction → 18.3). */
  prob: number;
  updated_at: string;
}

/**
 * Current bookmaker title-win odds by team, refreshed daily by the sync-odds
 * Edge Function into `team_odds`. Returns an empty map until the first sync
 * (the Lobby then just shows the original numbers). Stored as a 0..1 fraction;
 * scaled here to percent to match PoolTeam.prob.
 */
export async function getCurrentOdds(): Promise<Map<string, CurrentOdds>> {
  const { data } = await supabase.from('team_odds').select('team,prob,updated_at');
  const idx = new Map<string, CurrentOdds>();
  for (const r of (data as { team: string; prob: number; updated_at: string }[]) ?? []) {
    idx.set(r.team, { prob: r.prob * 100, updated_at: r.updated_at });
  }
  return idx;
}
