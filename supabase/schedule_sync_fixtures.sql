-- ===========================================================================
-- Schedule sync-fixtures to run every 3 minutes (kickoff times + results).
-- Run this WHOLE file ONCE in the Supabase SQL editor (Dashboard → SQL).
--
-- Uses pg_cron to fire a job and pg_net to make the HTTP call to the Edge
-- Function. The function is deployed with --no-verify-jwt, so no key/secret is
-- needed in the request. Re-running this file is safe: it unschedules any
-- existing job of the same name first.
-- ===========================================================================

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- Drop a previous job of this name so re-running doesn't create duplicates.
select cron.unschedule('sync-fixtures')
where exists (select 1 from cron.job where jobname = 'sync-fixtures');

select cron.schedule(
  'sync-fixtures',
  '*/3 * * * *',  -- every 3 minutes
  $$
  select net.http_post(
    url     := 'https://lmjanuwzvihbffhayxws.supabase.co/functions/v1/sync-fixtures',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect:    select * from cron.job;
-- Recent runs select * from cron.job_run_details order by start_time desc limit 10;
-- Stop it:    select cron.unschedule('sync-fixtures');
