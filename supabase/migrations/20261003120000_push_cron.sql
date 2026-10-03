-- Ticket 07 de la auditoría: el disparo de los avisos push pasa de GitHub
-- Actions (que aplaza y descarta las ejecuciones programadas: 6 al día en vez
-- de 96) a pg_cron + pg_net, cada 5 minutos. Aplicar a mano en el SQL Editor.
-- Rollback: supabase/rollbacks/20261003120000_push_cron.sql.
--
-- ANTES de aplicar, una sola vez y a mano (el secreto NO va al repositorio):
--
--   SELECT vault.create_secret('<el CRON_SECRET de Vercel>', 'cron_secret');
--   SELECT vault.create_secret('https://www.peppersfam.es', 'app_url');
--
-- Sin esos dos secretos la URL sale NULL y cada ejecución falla (se ve en
-- cron.job_run_details); no se envía nada a ningún sitio.

-- En Supabase, pg_cron va en pg_catalog y pg_net en extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- `cron.schedule` con nombre reemplaza el trabajo si ya existe: se puede
-- volver a aplicar. El servidor reclama cada aviso antes de enviarlo
-- (`dispatchPush`), así que dos disparos solapados no envían dos veces.
SELECT cron.schedule(
  'push-dispatch',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_url')
           || '/api/cron/dispatch',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Comprobación, pasados 15 minutos (una fila cada 5 min, status_code 200):
--
--   SELECT status, start_time, return_message FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'push-dispatch')
--   ORDER BY start_time DESC LIMIT 5;
--   SELECT status_code, error_msg, created FROM net._http_response
--   ORDER BY created DESC LIMIT 5;
