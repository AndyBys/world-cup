// The national teams in this lottery's prize pool, each with its pre-tournament
// World Cup *title* probability (%). These are shown on the draw page so friends
// can see what they might be drawn — and how strong it is.
//
// ─────────────────────────────────────────────────────────────────────────────
// EDIT THESE NUMBERS to match your source screenshot. They're stored as the raw
// decimals (e.g. 15.83) and displayed rounded to whole percent (15.83 → 16%).
// The `team` names must match openfootball spelling and your Supabase
// config.teams pool exactly (Spain, France, England, …).
// ─────────────────────────────────────────────────────────────────────────────

export interface PoolTeam {
  team: string;
  /** Win probability as a raw percentage, e.g. 15.83 for 15.83%. */
  prob: number;
}

export const POOL: PoolTeam[] = [
  { team: 'Spain', prob: 16 },
  { team: 'France', prob: 13 },
  { team: 'England', prob: 11 },
  { team: 'Argentina', prob: 11 },
  { team: 'Portugal', prob: 7 },
  { team: 'Brazil', prob: 6.5 },
  { team: 'Germany', prob: 6 },
  { team: 'Netherlands', prob: 6 },
  { team: 'Norway', prob: 4 },
  { team: 'Bosnia & Herzegovina', prob: 3.4 },
];

/** Pool sorted strongest-first. */
export function poolByOdds(): PoolTeam[] {
  return [...POOL].sort((a, b) => b.prob - a.prob);
}
