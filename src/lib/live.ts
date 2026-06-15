// Live scores from worldcup26.ir, proxied through our Supabase Edge Function
// (see supabase/functions/live-scores) so the browser can read it with CORS.
// We match the feed's games to openfootball fixtures by an *unordered, normalised
// team pair* — each pairing is unique in the tournament — then orient the score
// to whichever side is team1/team2 in our data.

import { Match } from './worldcup';

// In dev, hit the Vite proxy (see vite.config.ts) which forwards to worldcup26.ir.
// In production, hit the Supabase Edge Function, which does the same CORS-adding
// passthrough. Both return the upstream's raw {games:[...]} shape.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ENDPOINT = import.meta.env.DEV
  ? '/wc-live'
  : SUPABASE_URL
    ? `${SUPABASE_URL}/functions/v1/live-scores`
    : '';

export type LivePhase = 'upcoming' | 'live' | 'finished';

export interface LiveGame {
  home: string;
  away: string;
  hs: number;
  as: number;
  phase: LivePhase;
  minute?: string; // e.g. "63" or "HT", when live
  homeScorers: string[];
  awayScorers: string[];
}

export type LiveIndex = Map<string, LiveGame>;

/** Canonical team key: collapses the few naming differences between feeds. */
export function canon(name: string): string {
  const k = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (Curaçao, Quiñones…)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
  const alias: Record<string, string> = {
    unitedstates: 'usa',
    democraticrepublicofthecongo: 'drcongo',
  };
  return alias[k] ?? k;
}

function pairKey(a: string, b: string): string {
  return [canon(a), canon(b)].sort().join('|');
}

/** Parse openfootball-feed scorer blobs like `{“J. Quiñones 9'”}` → ["J. Quiñones 9'"]. */
function parseScorers(raw: string | undefined): string[] {
  if (!raw || raw === 'null') return [];
  return raw
    .replace(/[{}]/g, '')
    .replace(/[“”"]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'null');
}

/** Raw game shape from worldcup26.ir (/get/games), passed through unchanged. */
interface RawGame {
  home_team_name_en: string;
  away_team_name_en: string;
  home_score: string;
  away_score: string;
  finished: string; // "TRUE" | "FALSE"
  time_elapsed: string; // "notstarted" | "live" | minute | ...
  home_scorers?: string;
  away_scorers?: string;
}

function toLiveGame(g: RawGame): LiveGame {
  const elapsed = g.time_elapsed;
  const finished = g.finished === 'TRUE';
  const started = elapsed !== 'notstarted' && elapsed !== '' && elapsed != null;
  const phase: LivePhase = finished ? 'finished' : started ? 'live' : 'upcoming';
  return {
    home: g.home_team_name_en,
    away: g.away_team_name_en,
    hs: Number(g.home_score) || 0,
    as: Number(g.away_score) || 0,
    phase,
    minute: phase === 'live' ? elapsed : undefined,
    homeScorers: parseScorers(g.home_scorers),
    awayScorers: parseScorers(g.away_scorers),
  };
}

/**
 * Fetches the live feed and indexes it by team pair.
 *
 * Returns `null` on any failure (network blip, non-2xx, rate-limited upstream)
 * so callers can distinguish "the poll failed" from "the feed is genuinely
 * empty" and keep the last good index instead of blanking the UI. A successful
 * fetch always returns a Map (possibly empty).
 */
export async function getLiveIndex(): Promise<LiveIndex | null> {
  if (!ENDPOINT) return new Map();
  try {
    // `no-store`: never let the browser/CDN serve a stale cached copy — each
    // poll must reach the edge function. The upstream is still shielded by the
    // edge's own short in-memory cache, so this doesn't increase upstream load.
    const r = await fetch(ENDPOINT, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`live ${r.status}`);
    const data = (await r.json()) as { games?: RawGame[] };
    const idx: LiveIndex = new Map();
    for (const raw of data.games ?? []) {
      if (!raw.home_team_name_en || !raw.away_team_name_en) continue;
      idx.set(pairKey(raw.home_team_name_en, raw.away_team_name_en), toLiveGame(raw));
    }
    return idx;
  } catch {
    return null; // poll failed → callers keep the last good index
  }
}

/**
 * Merges a freshly-fetched index into the one we already hold, so transient
 * feed hiccups and the upstream's habit of dropping finished games a few
 * minutes after the whistle don't make results flicker in and out.
 *
 * Rules:
 *  - A failed poll (`next === null`) leaves the held index untouched.
 *  - Fresh data wins on conflict (scores/minute update as the match plays).
 *  - A game we've already seen `finished` is sticky: once final, it never
 *    reverts and is never dropped, even if the feed stops listing it.
 *
 * The index only grows to the tournament's match count, so this can't leak.
 */
export function mergeLiveIndex(prev: LiveIndex, next: LiveIndex | null): LiveIndex {
  if (next === null) return prev;
  const merged: LiveIndex = new Map(prev);
  for (const [key, game] of next) {
    const held = merged.get(key);
    // Don't let a finished result get overwritten by a non-final reading.
    if (held?.phase === 'finished' && game.phase !== 'finished') continue;
    merged.set(key, game);
  }
  return merged;
}

export interface LiveInfo {
  phase: LivePhase;
  /** Score oriented to [team1, team2] of the match. Absent before kick-off. */
  ft?: [number, number];
  minute?: string;
  scorers1: string[];
  scorers2: string[];
}

/** Live info for a fixture, oriented to its team1/team2. Null if not in the feed. */
export function liveFor(m: Match, idx: LiveIndex): LiveInfo | null {
  const g = idx.get(pairKey(m.team1, m.team2));
  if (!g) return null;
  const sameOrder = canon(m.team1) === canon(g.home);
  const ft: [number, number] = sameOrder ? [g.hs, g.as] : [g.as, g.hs];
  return {
    phase: g.phase,
    ft: g.phase === 'upcoming' ? undefined : ft,
    minute: g.minute,
    scorers1: sameOrder ? g.homeScorers : g.awayScorers,
    scorers2: sameOrder ? g.awayScorers : g.homeScorers,
  };
}

/**
 * Returns a copy of `matches` with final scores from the live feed merged in for
 * matches the feed reports finished but openfootball hasn't filled yet. Used so
 * standings/bracket reflect results immediately.
 */
export function overlayFinished(matches: Match[], idx: LiveIndex): Match[] {
  if (idx.size === 0) return matches;
  return matches.map((m) => {
    if (m.score?.ft) return m;
    const info = liveFor(m, idx);
    if (info?.phase === 'finished' && info.ft) {
      return { ...m, score: { ...m.score, ft: info.ft } };
    }
    return m;
  });
}
