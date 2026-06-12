// The "ultra-gamble" prize pool: the longest of long-shots. At sign-up a player
// can forfeit their chance at a top team and instead be assigned — instantly,
// at random — one of these underdogs. Big odds, tiny chance, maximum chaos.
//
// IMPORTANT: this list mirrors config.ultra_teams in Supabase (the source of
// truth the server draws from), exactly as POOL mirrors config.teams. Keep them
// in sync. `team` names must match openfootball spelling (e.g. "Curaçao").

export interface UltraTeam {
  team: string;
  /** American moneyline odds, e.g. "+700". */
  odds: string;
  /** Total returned on a $10 bet (stake + winnings), e.g. 80. */
  payout: number;
}

export const ULTRA_POOL: UltraTeam[] = [
  { team: 'Curaçao', odds: '+350', payout: 45 },
  { team: 'Haiti', odds: '+700', payout: 80 },
  { team: 'Iraq', odds: '+800', payout: 90 },
  { team: 'Cape Verde', odds: '+900', payout: 100 },
  { team: 'Jordan', odds: '+1000', payout: 110 },
  { team: 'Uzbekistan', odds: '+1100', payout: 120 },
  { team: 'New Zealand', odds: '+1100', payout: 120 },
  { team: 'Panama', odds: '+1400', payout: 150 },
];

/** Just the team names, for the server-side `config.ultra_teams` seed. */
export const ULTRA_TEAMS = ULTRA_POOL.map((u) => u.team);

/** Look up a team's ultra odds info (returns undefined for non-ultra teams). */
export function ultraInfo(team: string): UltraTeam | undefined {
  return ULTRA_POOL.find((u) => u.team === team);
}
