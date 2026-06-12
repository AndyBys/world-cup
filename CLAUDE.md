# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Production database safety

The Supabase project `lmjanuwzvihbffhayxws` is the **live production database** for
the World Cup lottery. Real users and real data live there. Treat every operation
against it as production.

**Prime directive: NEVER lose user data.** Every other rule below serves this one. If an
action could destroy or overwrite data and you are not 100% certain it is safe and intended,
**stop, take a snapshot, and confirm** before proceeding.

**Snapshot-first rule (mandatory):**

- **NEVER drop, truncate, or bulk-delete anything in production without first creating a
  snapshot/backup.** No exceptions. A snapshot must exist and be verified *before* the
  destructive command runs — not after.
- **When unsure whether an action is destructive or reversible, assume it is.** Create a
  snapshot first, then proceed. A snapshot is cheap; lost user data is unrecoverable.
- How to snapshot before destructive work:
  - Preferred: trigger a backup in the Supabase Dashboard (Database → Backups) or via PITR,
    and confirm it completed.
  - CLI fallback: `supabase db dump --db-url "$PROD_DB_URL" -f backups/pre-change-<UTC-timestamp>.sql`
    (data + schema). Verify the file is non-empty and contains the target tables before continuing.
  - Record what was snapshotted and when, so the change is reversible.

**Hard rules — never violate without an explicit, in-the-moment request from the user
AND a verified snapshot in hand:**

- **NEVER drop production tables or databases.** No `DROP TABLE`, `DROP TABLE ... CASCADE`,
  or `DROP DATABASE`/`DROP SCHEMA` against production unless the user explicitly asks for that
  specific object to be dropped **and** a verified snapshot exists.
- **NEVER run destructive DDL/DML on production without explicit approval + snapshot** — this
  includes `TRUNCATE`, `DELETE` without a `WHERE`, `UPDATE` without a `WHERE`, `DROP FUNCTION`,
  `ALTER TABLE ... DROP COLUMN`, `ALTER COLUMN ... TYPE` (lossy casts), or disabling RLS on a live table.
- **NEVER push unreviewed migrations to production.** Do not `supabase db push` until the
  migration has been reviewed, the user has approved applying it to prod, and a snapshot exists
  if it touches existing data.
- **Migrations must be forward-only and additive by default.** Prefer adding columns/tables over
  renaming or dropping. Deprecate before you delete.
- **NEVER expose or commit secrets.** The `service_role` key and DB password must never be
  written to files tracked by git. `.env` is gitignored — keep it that way.

**If a destructive action is ever requested, follow this exact sequence:**
1. Confirm the user explicitly asked for *this specific* destructive action.
2. Create a snapshot/backup (see above) and **verify it succeeded**.
3. State plainly what will be destroyed and that the snapshot exists.
4. Only then run the command. If any step fails or is uncertain — **stop and ask**.

**Required practice:**

- Prefer **`supabase db pull`** (read) over speculative writes when inspecting prod.
- For schema changes, write a migration in `supabase/migrations/`, review it, then apply.
- These migrations were reconstructed from SQL hand-run in the dashboard; production already
  has this schema. Before any first push, baseline with **`supabase migration repair`** to mark
  them applied — do **not** raw-push and risk double-applying.
- When in doubt about a destructive or irreversible action, **stop and ask** rather than proceed.

## Project layout

- `src/` — Vite + TypeScript frontend (browser client uses the public anon key + RLS).
- `supabase/migrations/` — versioned schema (converted from the historical loose `*.sql` files).
- `supabase/functions/` — Edge Functions (e.g. `sync-fixtures`).
- `.mcp.json` — Supabase MCP server, scoped to project `lmjanuwzvihbffhayxws`.

## Access

- Read-only browser access: anon key in `.env` (RLS-gated).
- Full access (SQL, schema, advisors): Supabase MCP server (OAuth) or CLI link + DB password.
- Game rules are enforced server-side via RLS + `SECURITY DEFINER` functions — preserve that
  boundary; do not move authorization logic into the client.
