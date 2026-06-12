-- ===========================================================================
-- Remove the old pg_cron job for sync-fixtures.
-- We schedule sync-fixtures via GitHub Actions now (.github/workflows/
-- sync-fixtures.yml), so the in-database cron job is no longer used. It never
-- ran (the pg_cron worker wasn't ticking), so this is just cleanup.
-- Run this WHOLE file in the Supabase SQL editor.
-- ===========================================================================

select cron.unschedule('sync-fixtures')
where exists (select 1 from cron.job where jobname = 'sync-fixtures');

-- Verify it's gone (should return no rows):
select jobname from cron.job where jobname = 'sync-fixtures';
