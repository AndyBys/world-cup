import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surface a clear message during dev / build instead of a cryptic runtime crash.
  console.error(
    'Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      '(see .env.example).',
  );
}

export const supabase = createClient(url ?? '', anonKey ?? '');

export interface Player {
  id: string;
  name: string;
  created_at: string;
}

export interface Assignment {
  player_id: string;
  team: string;
}

/** A friend joined with their assigned team (joined view for the results table). */
export interface Result {
  player: Player;
  team: string | null;
}

/** Map Postgres error messages (the codes we raise) to friendly UI text. */
export function friendlyError(message: string): string {
  const map: Record<string, string> = {
    EMPTY_NAME: 'Please enter your name.',
    DRAW_DONE: 'The lottery has already been drawn — sign-ups are closed.',
    NO_CONFIG: 'The game has not been set up yet. Ask the organiser.',
    LOBBY_FULL: 'The lobby is full.',
    DUPLICATE_NAME: 'That name is already taken — try another.',
    BAD_PASSCODE: 'Wrong admin passcode.',
    ALREADY_DRAWN: 'The lottery has already been drawn.',
    NO_TEAMS_LEFT: 'The draw is done and every team is already taken — no spots left.',
    NO_PLAYERS: 'Nobody has signed up yet.',
    NOT_ENOUGH_TEAMS: 'There are more players than teams in the pool.',
  };
  for (const code of Object.keys(map)) {
    if (message.includes(code)) return map[code];
  }
  return message;
}
