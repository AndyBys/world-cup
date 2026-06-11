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
