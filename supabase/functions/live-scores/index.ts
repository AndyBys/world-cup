// Supabase Edge Function: live-scores
// ---------------------------------------------------------------------------
// worldcup26.ir has real, minute-by-minute live scores but sends NO
// Access-Control-Allow-Origin header, so a browser on GitHub Pages can't call
// it directly. This function fetches it server-side and re-serves it WITH CORS
// enabled, cached for ~10s so we never hammer the upstream (which is rate-limited
// to ~100 req/window) while still surfacing live scores quickly. The in-memory
// cache caps upstream fetches at ~1 per TTL no matter how many clients poll, so
// the frontend can poll aggressively. The frontend hits this instead of the .ir host.
//
// Deploy (public, no JWT required — it only proxies public data):
//   supabase functions deploy live-scores --no-verify-jwt
//
// The browser then fetches:  <SUPABASE_URL>/functions/v1/live-scores

const SRC = 'https://worldcup26.ir/get/games';
const TTL_MS = 10_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

let cache: { at: number; body: string } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const r = await fetch(SRC, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      // Passthrough the upstream body unchanged (the client parses the raw shape,
      // which is identical to the dev Vite proxy). We only add CORS + caching.
      cache = { at: Date.now(), body: await r.text() };
    }
    return new Response(cache.body, {
      headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'public, max-age=10' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }
});
