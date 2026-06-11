# 🏆 World Cup 2026 — Friends Lottery

A tiny static site where friends sign up, get **randomly assigned a national team**, and follow
their team through the World Cup. Everyone chips $10 into an offline community pot — whoever's team
wins it all takes the pot. Built to run **for free on GitHub Pages** with **Supabase** holding the
shared state.

- **Page 1 (`/`)** — sign-up lobby → after the draw, the **friend → team** results table + pot.
- **Page 2 (`/team/:team`)** — that team's group standings, fixtures and results (live from
  [openfootball](https://github.com/openfootball/worldcup.json), no API key).

## Stack
Vite + React + TypeScript (static SPA, hash routing) · Supabase (Postgres) · GitHub Pages.
Game rules (dedupe, capacity, the draw) live in Postgres `SECURITY DEFINER` functions, so they
can't be bypassed from the browser. The Supabase **anon key is public by design** — Row Level
Security plus those functions protect the data.

## One-time setup

### 1. Supabase
1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), run it.
3. **Edit the seed `config` row** (bottom of that file, or via Table editor) with:
   - `teams` — your national-team pool, spelled exactly as in openfootball
     (e.g. `Mexico`, `Canada`, `South Korea`, `Czech Republic`). Provide **≥ as many teams as
     `max_players`**; extras go unassigned.
   - `max_players` — sign-up cap (default `9`).
   - `passcode` — a secret only you know; required to run the draw. **Change it from `change-me`.**
4. Copy **Settings → API → Project URL** and **anon public key**.

### 2. Run locally
```bash
cp .env.example .env     # paste your URL + anon key
npm install
npm run dev              # http://localhost:5173
```

### 3. Deploy to GitHub Pages
1. In the GitHub repo: **Settings → Secrets and variables → Actions** → add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Settings → Pages → Source: GitHub Actions**.
3. Push to `main`. The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   builds and publishes the site to `https://<you>.github.io/world-cup/`.

> The Vite `base` is `/world-cup/` to match this repo name. If you rename the repo, update
> `base` in [`vite.config.ts`](vite.config.ts).

## How to play
1. Share the Pages URL. Friends open it and enter their name (one per browser; duplicate names are
   rejected).
2. When everyone's in, open the site yourself → **"organiser? run the draw"** → enter your passcode
   → **Run draw**. Teams are shuffled and assigned; sign-ups close.
3. The results table appears for everyone. Tap a team to follow their matches.
4. Settle the $10 pot in real life once a champion is crowned. 🍻
