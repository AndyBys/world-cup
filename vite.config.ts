import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only endpoint for live scores. In production the browser hits the Supabase
// Edge Function (supabase/functions/live-scores); during `npm run dev` we serve
// the same passthrough here via Node fetch (worldcup26.ir blocks browser CORS).
// We use a middleware instead of server.proxy because http-proxy was failing the
// upstream TLS handshake, whereas Node's fetch connects fine.
function liveScoreDevProxy(): Plugin {
  let cache: { at: number; body: string } | null = null;
  return {
    name: 'live-score-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/wc-live', async (_req, res) => {
        try {
          if (!cache || Date.now() - cache.at > 30_000) {
            const r = await fetch('https://worldcup26.ir/get/games', {
              headers: { accept: 'application/json' },
            });
            cache = { at: Date.now(), body: await r.text() };
          }
          res.setHeader('content-type', 'application/json');
          res.end(cache.body);
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/world-cup/',
  plugins: [react(), liveScoreDevProxy()],
});
