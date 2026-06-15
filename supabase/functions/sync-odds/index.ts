// Supabase Edge Function: sync-odds
// ---------------------------------------------------------------------------
// Once a day (driven by .github/workflows/sync-odds.yml), pulls 1X2 (h2h)
// bookmaker odds for the World Cup from The Odds API and writes per-match win
// probabilities into the `fixtures` table (p1/px/p2 + odds_updated_at).
//
// Maths: implied prob of an outcome = 1 / decimal-odds. The three implied probs
// sum to >1 (the bookmaker margin / overround). We remove it by PROPORTIONAL
// normalisation — p_i = (1/odds_i) / Σ(1/odds_j) — so p1+px+p2 = 1 and none can
// go negative. Across the ~20 books returned we take the MEDIAN decimal odds per
// outcome first, so one book's outlier line can't skew the result.
//
// Matching: The Odds API gives English team names + a "Draw" outcome. We key by
// the unordered canon(team) pair (each WC pairing is unique) to find the fixture
// row, then orient the two team outcomes to that row's team1/team2.
//
// Needs ODDS_API_KEY (function secret) + the auto-injected service-role key.
// Deploy:  supabase functions deploy sync-odds --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SPORT = 'soccer_fifa_world_cup';
const ODDS_URL = (key: string) =>
  `https://api.the-odds-api.com/v4/sports/${SPORT}/odds` +
  `?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Canonical team token — MUST mirror canon() in sync-fixtures / src/lib/live.ts. */
function canon(name: string): string {
  const k = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
  // Bridge naming differences between The Odds API and openfootball.
  const alias: Record<string, string> = {
    unitedstates: 'usa',
    southkorea: 'korearepublic',
    korea: 'korearepublic',
    ivorycoast: 'cotedivoire',
    drcongo: 'democraticrepublicofthecongo',
  };
  return alias[k] ?? k;
}

const pairKey = (a: string, b: string) => [canon(a), canon(b)].sort().join('|');

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface Outcome { name: string; price: number }
interface Market { key: string; outcomes: Outcome[] }
interface Bookmaker { key: string; markets: Market[] }
interface OddsEvent {
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

interface FixtureRow {
  match_key: string;
  team1: string;
  team2: string;
}

/**
 * Median decimal odds per outcome name (canon) across all books for one event,
 * then proportionally-normalised probabilities. Returns null if any of the three
 * 1X2 outcomes is missing.
 */
function probsFor(ev: OddsEvent): Map<string, number> | null {
  const prices = new Map<string, number[]>(); // canon(name) -> decimal odds samples
  for (const bk of ev.bookmakers ?? []) {
    const h2h = bk.markets?.find((m) => m.key === 'h2h');
    if (!h2h) continue;
    for (const o of h2h.outcomes ?? []) {
      if (!(o.price > 1)) continue;
      const key = o.name === 'Draw' ? 'draw' : canon(o.name);
      const arr = prices.get(key) ?? [];
      arr.push(o.price);
      prices.set(key, arr);
    }
  }
  const home = canon(ev.home_team);
  const away = canon(ev.away_team);
  if (!prices.has(home) || !prices.has(away) || !prices.has('draw')) return null;

  const implied = (k: string) => 1 / median(prices.get(k)!);
  const raw = new Map<string, number>([
    [home, implied(home)],
    [away, implied(away)],
    ['draw', implied('draw')],
  ]);
  const total = [...raw.values()].reduce((a, b) => a + b, 0);
  const byName = new Map<string, number>();
  for (const [k, v] of raw) byName.set(k, v / total); // proportional normalisation
  return byName;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const apiKey = Deno.env.get('ODDS_API_KEY');
    if (!apiKey) throw new Error('ODDS_API_KEY not configured');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [oddsRes, fxRes] = await Promise.all([
      fetch(ODDS_URL(apiKey), { headers: { accept: 'application/json' } }),
      supabase.from('fixtures').select('match_key,team1,team2'),
    ]);
    if (!oddsRes.ok) throw new Error(`odds-api ${oddsRes.status}`);
    if (fxRes.error) throw fxRes.error;

    const events = (await oddsRes.json()) as OddsEvent[];
    const fixtures = (fxRes.data ?? []) as FixtureRow[];

    // Index fixtures by unordered canon pair (each WC pairing is unique).
    const byPair = new Map<string, FixtureRow>();
    for (const f of fixtures) byPair.set(pairKey(f.team1, f.team2), f);

    const now = new Date().toISOString();
    const updates: { match_key: string; p1: number; px: number; p2: number }[] = [];
    const unmatched: string[] = [];

    for (const ev of events) {
      const fx = byPair.get(pairKey(ev.home_team, ev.away_team));
      if (!fx) {
        unmatched.push(`${ev.home_team} v ${ev.away_team}`);
        continue;
      }
      const p = probsFor(ev);
      if (!p) continue;
      const p1 = p.get(canon(fx.team1));
      const p2 = p.get(canon(fx.team2));
      const px = p.get('draw');
      if (p1 == null || p2 == null || px == null) {
        unmatched.push(`orient-fail ${ev.home_team} v ${ev.away_team}`);
        continue;
      }
      updates.push({ match_key: fx.match_key, p1, px, p2 });
    }

    // Rows always pre-exist (matched from fixtures), and the table has NOT NULL
    // columns we don't want to touch — so UPDATE in place rather than upsert.
    const results = await Promise.all(
      updates.map((u) =>
        supabase
          .from('fixtures')
          .update({ p1: u.p1, px: u.px, p2: u.p2, odds_updated_at: now })
          .eq('match_key', u.match_key),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;

    return new Response(
      JSON.stringify({
        ok: true,
        events: events.length,
        updated: updates.length,
        unmatched,
      }),
      { headers: { ...cors, 'content-type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }
});
