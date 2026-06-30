// Fetches public-domain World Cup 2026 data from openfootball.
// No API key required. https://github.com/openfootball/worldcup.json
//
// Source priority — raw.githubusercontent FIRST, jsDelivr as fallback:
//   * raw.githubusercontent serves the file fresh (cache-control max-age=300) and
//     sends `Access-Control-Allow-Origin: *`, so the browser can fetch it directly.
//   * jsDelivr is a nicer CDN but caches a *branch* ref (@master) for up to ~12h and
//     ignores our `?cb=` query string when keying its cache, so it can serve a stale
//     snapshot missing freshly-entered scores. We keep it only as an availability
//     fallback if raw GitHub is unreachable.
// Both send CORS headers. We try them in order so a fresh score shows within minutes.

const PRIMARY = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026';
const FALLBACK = 'https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026';

/** Fetch a worldcup file fresh, falling back to the jsDelivr CDN on failure. */
async function fetchJson(file: string, cacheBust = false): Promise<Response> {
  const qs = cacheBust ? `?cb=${Math.floor(Date.now() / 300_000)}` : '';
  try {
    const r = await fetch(`${PRIMARY}/${file}${qs}`);
    if (r.ok) return r;
  } catch {
    /* primary unreachable → fall through to CDN */
  }
  return fetch(`${FALLBACK}/${file}${qs}`);
}

export interface Score {
  ft?: [number, number]; // 90-minute (full-time) score
  ht?: [number, number]; // half-time score
  et?: [number, number]; // aggregate after extra time — knockouts only
  p?: [number, number]; // penalty-shootout score — knockouts only
}

/** A goal from openfootball, e.g. { name: "Kai Havertz", minute: "45+5", penalty: true }. */
export interface Goal {
  name: string;
  minute: string; // e.g. "9" or "90+6"
  penalty?: boolean;
  owngoal?: boolean;
}

export interface Match {
  round: string;
  date: string; // ISO yyyy-mm-dd
  time: string; // e.g. "13:00 UTC-6"
  team1: string;
  team2: string;
  group?: string; // e.g. "Group A" (absent for knockout rounds)
  ground: string;
  score?: Score;
  goals1?: Goal[]; // goals credited to team1 (own goals list the opponent scorer)
  goals2?: Goal[]; // goals credited to team2
}

export interface Team {
  name: string;
  name_normalised?: string;
  continent?: string;
  flag_icon?: string; // emoji
  fifa_code?: string;
  group?: string; // letter, e.g. "A"
  confed?: string;
}

interface WorldCupFile {
  name: string;
  matches: Match[];
}

// Simple in-memory caches so we fetch each file once per page load.
let matchesCache: Promise<Match[]> | null = null;
let teamsCache: Promise<Team[]> | null = null;

export function getMatches(): Promise<Match[]> {
  if (!matchesCache) {
    // Cache-bust in 5-minute buckets so a long-lived tab (and the browser
    // cache) picks up freshly-entered scores on match days without a hard reload.
    matchesCache = fetchJson('worldcup.json', true)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load fixtures (${r.status})`);
        return r.json() as Promise<WorldCupFile>;
      })
      .then((d) => d.matches)
      .catch((e) => {
        matchesCache = null; // allow retry on next call
        throw e;
      });
  }
  return matchesCache;
}

/** Drops the in-memory fixtures cache so the next getMatches() refetches. */
export function refreshMatches(): Promise<Match[]> {
  matchesCache = null;
  return getMatches();
}

export function getTeams(): Promise<Team[]> {
  if (!teamsCache) {
    teamsCache = fetchJson('worldcup.teams.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load teams (${r.status})`);
        return r.json() as Promise<Team[]>;
      })
      .catch((e) => {
        teamsCache = null;
        throw e;
      });
  }
  return teamsCache;
}

export async function getTeam(name: string): Promise<Team | undefined> {
  const teams = await getTeams();
  return teams.find((t) => t.name === name);
}

/** name -> flag emoji map (placeholder slots like "2A" simply won't be found). */
export async function getFlagMap(): Promise<Map<string, string>> {
  const teams = await getTeams();
  return new Map(teams.map((t) => [t.name, t.flag_icon ?? '']));
}

/** The knockout rounds in bracket order. */
export const KNOCKOUT_ROUNDS = [
  'Round of 32',
  'Round of 16',
  'Quarter-final',
  'Semi-final',
  'Match for third place',
  'Final',
] as const;

/** All group labels present in the data, sorted ("Group A" … "Group L"). */
export async function getGroupLabels(): Promise<string[]> {
  const matches = await getMatches();
  return [...new Set(matches.map((m) => m.group).filter(Boolean) as string[])].sort();
}

/** Knockout matches bucketed by round, in bracket order, chronological within. */
export async function getKnockoutRounds(): Promise<{ round: string; matches: Match[] }[]> {
  const matches = await getMatches();
  return KNOCKOUT_ROUNDS.map((round) => ({
    round,
    matches: matches
      .filter((m) => m.round === round)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
  })).filter((r) => r.matches.length > 0);
}

/** Human-friendly stage label for a match. */
export function stageLabel(m: Match): string {
  if (m.group) return `${m.group} · ${m.round}`;
  return m.round;
}

/** European-style round fraction, e.g. "Quarter-final" → "1/4". */
export function roundFraction(round: string): string {
  const map: Record<string, string> = {
    'Round of 32': '1/16',
    'Round of 16': '1/8',
    'Quarter-final': '1/4',
    'Semi-final': '1/2',
    'Match for third place': '3rd',
    Final: 'Final',
  };
  return map[round] ?? round;
}

/**
 * Turns a bracket placeholder into readable text:
 *   "1E" → "Winner E", "2C" → "Runner-up C", "3A/B/C/D/F" → "Best 3rd",
 *   "W91" → "Winner", "L101" → "Loser". Real team names pass through.
 */
export function prettySlot(name: string): string {
  if (/^W\d+$/.test(name)) return 'Winner';
  if (/^L\d+$/.test(name)) return 'Loser';
  const single = /^([123])([A-L])$/.exec(name);
  if (single) {
    const pos = single[1] === '1' ? 'Winner' : single[1] === '2' ? 'Runner-up' : '3rd';
    return `${pos} ${single[2]}`;
  }
  if (/^3[A-L/]+$/.test(name)) return 'Best 3rd';
  return name;
}

/** Short venue name: drops the parenthetical, e.g. "Dallas (Arlington)" → "Dallas". */
export function shortGround(ground: string): string {
  return ground.split(' (')[0].trim();
}

/** Host-country flag for a 2026 venue (USA / Mexico / Canada). */
export function hostFlag(ground: string): string {
  if (/Mexico City|Guadalajara|Monterrey/.test(ground)) return '🇲🇽';
  if (/Toronto|Vancouver/.test(ground)) return '🇨🇦';
  return '🇺🇸';
}

/** "2026-07-04" → "Jul 4". */
export function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// --- Knockout bracket tree --------------------------------------------------
// Each knockout match references its feeder matches via "W<n>" / "L<n>"
// placeholders (e.g. R16 "W74 v W77"). Group stage is 72 matches, so the i-th
// knockout match (file order) has global number 73 + i. We rebuild the tree
// from the Final down so the bracket can be drawn as a two-sided draw sheet.

/** A node in the knockout tree. `children` is empty for Round-of-32 (leaves). */
export interface BNode {
  match: Match;
  children: BNode[];
}

export interface Bracket {
  /** Top half of the draw (one Semi-final and everything feeding it). */
  left?: BNode;
  /** Bottom half of the draw. */
  right?: BNode;
  final?: Match;
  third?: Match;
  /** round name → formatted date range, e.g. "Round of 32" → "Jun 28 – Jul 3". */
  ranges: Record<string, string>;
}

function feederNums(m: Match): number[] {
  return [m.team1, m.team2]
    .map((s) => /^W(\d+)$/.exec(s)?.[1])
    .filter((x): x is string => !!x)
    .map(Number);
}

/**
 * Winning side of a *played* match: 1 = team1, 2 = team2, or 0 while still level
 * (a genuine group-stage draw). Knockout ties are broken the way the tournament
 * breaks them — penalty shootout has the final say, then the after-extra-time
 * aggregate, then the 90-minute score — so a 1-1 settled on penalties resolves to
 * whoever won the shootout rather than reading as a draw.
 */
export function winningSide(m: Match): 0 | 1 | 2 {
  const s = m.score;
  if (!s?.ft) return 0;
  const [a, b] = s.p ?? s.et ?? s.ft;
  return a > b ? 1 : a < b ? 2 : 0;
}

/**
 * Score to show for a finished match, with knockout tie-breaks resolved:
 *   - `ft`   headline pair — the after-extra-time aggregate when a match went to
 *            ET, otherwise the 90-minute score.
 *   - `pens` penalty-shootout score, present only when a shootout decided it.
 *   - `aet`  true when extra time (without penalties) settled it.
 * Returns null if the match has no full-time score yet.
 */
export function displayScore(
  m: Match,
): { ft: [number, number]; pens?: [number, number]; aet: boolean } | null {
  const s = m.score;
  if (!s?.ft) return null;
  if (s.p) return { ft: s.et ?? s.ft, pens: s.p, aet: false };
  if (s.et) return { ft: s.et, aet: true };
  return { ft: s.ft, aet: false };
}

export async function getBracket(): Promise<Bracket> {
  const matches = await getMatches();
  const ko = matches.filter((m) => !m.group);
  const byNum = new Map<number, Match>();
  ko.forEach((m, i) => byNum.set(73 + i, m)); // group stage = matches 1..72

  // Resolve a "W<n>"/"L<n>" feeder slot to the team that won/lost match <n>,
  // so a decided tie advances in our bracket immediately — openfootball only
  // rewrites these placeholders with a lag (and skips ones settled on penalties).
  const resolveSlot = (slot: string): string => {
    const ref = /^([WL])(\d+)$/.exec(slot);
    if (!ref) return slot;
    const feeder = byNum.get(Number(ref[2]));
    if (!feeder) return slot;
    const side = winningSide(feeder);
    if (side === 0) return slot; // not decided yet → keep the placeholder
    const won = side === 1 ? feeder.team1 : feeder.team2;
    const lost = side === 1 ? feeder.team2 : feeder.team1;
    const picked = ref[1] === 'W' ? won : lost;
    // A played match always has real team names, but guard against ever
    // surfacing a still-unresolved placeholder as though it were a team.
    return /^[WL]\d+$|^\d|\//.test(picked) ? slot : picked;
  };
  const resolve = (m: Match): Match => {
    const team1 = resolveSlot(m.team1);
    const team2 = resolveSlot(m.team2);
    return team1 === m.team1 && team2 === m.team2 ? m : { ...m, team1, team2 };
  };

  const build = (m: Match): BNode => ({
    match: resolve(m),
    children: feederNums(m)
      .map((n) => byNum.get(n))
      .filter((x): x is Match => !!x)
      .map(build),
  });

  // Date range per round, e.g. "Round of 32" → "Jun 28 – Jul 3".
  const ranges: Record<string, string> = {};
  for (const round of new Set(ko.map((m) => m.round))) {
    const dates = ko
      .filter((m) => m.round === round)
      .map((m) => m.date)
      .sort();
    const a = dates[0];
    const b = dates[dates.length - 1];
    ranges[round] = a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`;
  }

  const final = ko.find((m) => m.round === 'Final');
  const thirdRaw = ko.find((m) => m.round === 'Match for third place');
  const third = thirdRaw ? resolve(thirdRaw) : undefined; // L101/L102 → the semi-final losers
  if (!final) return { third, ranges };

  const root = build(final);
  return { left: root.children[0], right: root.children[1], final: root.match, third, ranges };
}

/** True once a match has a final-time score. */
export function isPlayed(m: Match): boolean {
  return Array.isArray(m.score?.ft);
}

/**
 * Kick-off time as a UTC epoch (ms). Parses openfootball's "13:00 UTC-6" form.
 * Returns null if the time string can't be parsed.
 */
export function kickoffMs(m: Match): number | null {
  const t = /^(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})?/.exec(m.time);
  if (!t) return null;
  const [, hh, mm, off] = t;
  const offset = off ? Number(off) : 0;
  const [y, mo, d] = m.date.split('-').map(Number);
  // Local kick-off at UTC<offset> → UTC epoch: subtract the offset hours.
  return Date.UTC(y, mo - 1, d, Number(hh) - offset, Number(mm));
}

export type MatchStatus = 'upcoming' | 'live' | 'finished';

/** ~2.5h window covers 90'+ stoppage/half-time (and extra time in knockouts). */
const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;

/**
 * Scheduled status of a match. NOTE: openfootball is community-edited, not a
 * real-time score feed — "live" means the match is *scheduled* to be in progress
 * right now, not that we have a ticking score. Once a final score lands it flips
 * to "finished".
 */
export function matchStatus(m: Match, now: number = Date.now()): MatchStatus {
  if (isPlayed(m)) return 'finished';
  const k = kickoffMs(m);
  if (k == null) return 'upcoming';
  if (now < k) return 'upcoming';
  if (now < k + LIVE_WINDOW_MS) return 'live';
  return 'finished'; // window has passed; score simply not in the feed yet
}

/**
 * 'W' | 'D' | 'L' from the perspective of `team`, or null if not yet played.
 * Knockout ties decided in extra time or on penalties count as a win/loss, not a
 * draw — so a team knocked out on penalties reads 'L' (and is out of the pot).
 */
export function resultFor(m: Match, team: string): 'W' | 'D' | 'L' | null {
  if (!m.score?.ft) return null;
  const side = winningSide(m);
  if (side === 0) return 'D';
  return (side === 1) === (m.team1 === team) ? 'W' : 'L';
}

export interface TeamResult {
  match: Match;
  outcome: 'W' | 'D' | 'L';
}

/**
 * A team's most recent played results, oldest-first, capped at `n`. Pass already
 * live-overlaid matches so freshly-finished games count immediately.
 */
export function recentResults(matches: Match[], team: string, n = 5): TeamResult[] {
  return matches
    .filter((m) => (m.team1 === team || m.team2 === team) && isPlayed(m))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(-n)
    .map((m) => ({ match: m, outcome: resultFor(m, team)! }));
}

/** All matches involving a team, chronologically. */
export async function getTeamMatches(name: string): Promise<Match[]> {
  const matches = await getMatches();
  return matches
    .filter((m) => m.team1 === name || m.team2 === name)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/** Short scorer label, e.g. "Havertz 45+5' (pen)" / "Bobadilla 7' (og)". */
export function goalLabel(g: Goal): string {
  const mark = g.owngoal ? ' (og)' : g.penalty ? ' (pen)' : '';
  return `${g.name} ${g.minute}'${mark}`;
}

export interface ScorerRow {
  name: string;
  team: string;
  goals: number;
  penalties: number;
}

/**
 * Golden-Boot table: goals per player across all played matches, most first.
 * Own goals are excluded (they don't credit the scorer). A player is keyed by
 * name + scoring team, so the rare same-name case across teams stays separate.
 */
export function topScorers(matches: Match[]): ScorerRow[] {
  const table = new Map<string, ScorerRow>();
  for (const m of matches) {
    // An own goal is credited to the opposing team, so the scorer actually plays
    // for the *other* side — and we drop it from the Golden Boot entirely below.
    const credited: { team: string; goal: Goal }[] = [
      ...(m.goals1 ?? []).map((goal) => ({ team: m.team1, goal })),
      ...(m.goals2 ?? []).map((goal) => ({ team: m.team2, goal })),
    ];
    for (const { team, goal } of credited) {
      if (goal.owngoal) continue;
      const key = `${goal.name}|${team}`;
      let r = table.get(key);
      if (!r) {
        r = { name: goal.name, team, goals: 0, penalties: 0 };
        table.set(key, r);
      }
      r.goals++;
      if (goal.penalty) r.penalties++;
    }
  }
  return [...table.values()].sort(
    (a, b) => b.goals - a.goals || a.penalties - b.penalties || a.name.localeCompare(b.name),
  );
}

export interface StandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number; // goals for
  ga: number; // goals against
  gd: number; // goal difference
  points: number;
}

/**
 * Computes a group standings table from completed group matches.
 * `group` is the full label, e.g. "Group A".
 */
export async function getGroupStandings(group: string): Promise<StandingRow[]> {
  const matches = await getMatches();
  return computeStandings(matches, group);
}

/** Pure standings computation from a set of matches (overlay live scores first). */
export function computeStandings(matches: Match[], group: string): StandingRow[] {
  const groupMatches = matches.filter((m) => m.group === group);

  const table = new Map<string, StandingRow>();
  const row = (team: string): StandingRow => {
    let r = table.get(team);
    if (!r) {
      r = { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
      table.set(team, r);
    }
    return r;
  };

  // Seed every team that appears in the group so the table is complete pre-kickoff.
  for (const m of groupMatches) {
    row(m.team1);
    row(m.team2);
  }

  for (const m of groupMatches) {
    if (!isPlayed(m) || !m.score?.ft) continue;
    const [g1, g2] = m.score.ft;
    const r1 = row(m.team1);
    const r2 = row(m.team2);
    r1.played++; r2.played++;
    r1.gf += g1; r1.ga += g2;
    r2.gf += g2; r2.ga += g1;
    if (g1 > g2) {
      r1.won++; r2.lost++; r1.points += 3;
    } else if (g1 < g2) {
      r2.won++; r1.lost++; r2.points += 3;
    } else {
      r1.drawn++; r2.drawn++; r1.points++; r2.points++;
    }
  }

  for (const r of table.values()) r.gd = r.gf - r.ga;

  return [...table.values()].sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team),
  );
}
