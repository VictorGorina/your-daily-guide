-- Rollback de 20261011130000_jobs.sql (ticket 40). Antes, quitar `JOBS_ENABLED`
-- en Vercel: sin la variable las server functions hacen el trabajo como antes
-- y nada lee ni escribe `jobs`. Se pierden los trabajos en cola o en marcha.

BEGIN;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('jobs-run', 'jobs-prune');
DROP FUNCTION IF EXISTS public.claim_job(int, int);
DROP TABLE IF EXISTS public.jobs;

COMMIT;
