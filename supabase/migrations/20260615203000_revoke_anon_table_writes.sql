-- Defense in depth: revoke direct write privileges from anon/authenticated.
--
-- The app's write authorization lives entirely in SECURITY DEFINER functions
-- (owned by postgres) plus RLS SELECT policies; the browser only ever calls
-- those RPCs and never writes to tables directly. Supabase's default grants,
-- however, hand anon/authenticated full INSERT/UPDATE/DELETE/TRUNCATE on every
-- table, so previously only RLS stood between an accidentally-disabled RLS and
-- anon being able to wipe prod. Remove those grants so the protection no longer
-- hinges on RLS alone.
--
-- SELECT is intentionally kept (RLS still gates reads). EXECUTE on the RPCs is
-- unchanged, and they run as postgres, so writes through them are unaffected.
-- Idempotent and reversible via the symmetric GRANT.

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Keep new tables created by postgres locked down the same way.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;
