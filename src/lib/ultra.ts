// The "ultra-gamble" prize pool: the longest of long-shots. At sign-up a player
// can forfeit their chance at a top team and instead be assigned — instantly,
// at random — one of these underdogs. Maximum chaos, no takebacks.
//
// IMPORTANT: this list mirrors config.ultra_teams in Supabase (the source of
// truth the server draws from), exactly as POOL mirrors config.teams. Keep them
// in sync. Names must match openfootball spelling (e.g. "Curaçao").

export const ULTRA_TEAMS: string[] = [
  'Curaçao',
  'Haiti',
  'Iraq',
  'Cape Verde',
  'Jordan',
  'Uzbekistan',
  'New Zealand',
  'Panama',
];
