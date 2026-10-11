-- Ticket 40 de la auditoría (ARQ-03): cola de trabajos largos. Generar el plan
-- tarda ~100 s dentro de una función de 300 s y el cliente esperaba con la
-- conexión abierta; con la cola, la petición deja un trabajo y responde, y un
-- trabajador (`POST /api/jobs/run`) lo ejecuta. La persona lee su fila para
-- ver el progreso; solo el servidor (clave de servicio) la crea y la cambia.
-- Rollback: supabase/rollbacks/20261011130000_jobs.sql.
--
-- Usa los secretos de Vault `app_url` y `cron_secret`, que ya existen desde
-- 20261003120000_push_cron.sql.

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan_generate', 'plan_reflow', 'plan_fit')),
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed')),
  progress jsonb,
  result jsonb,
  error text,
  attempts int NOT NULL DEFAULT 0,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON public.jobs (status, created_at)
  WHERE status IN ('queued', 'running');

-- Un trabajo activo por persona y tipo: la guarda contra el doble toque (y
-- contra web y móvil a la vez) vive en la base de datos, como la restricción
-- única de `monthly_plans`. Quien encola y choca aquí devuelve el que ya hay.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_idx ON public.jobs (user_id, kind)
  WHERE status IN ('queued', 'running');

-- Para leer "mi último trabajo de este tipo" sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS jobs_user_idx ON public.jobs (user_id, created_at DESC);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Supabase concede ALL por defecto a anon y authenticated en las tablas
-- nuevas de `public`: se quita y se deja solo leer la fila propia.
REVOKE ALL ON public.jobs FROM anon, authenticated;
GRANT SELECT ON public.jobs TO authenticated;

DROP POLICY IF EXISTS "read own jobs" ON public.jobs;
CREATE POLICY "read own jobs" ON public.jobs
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Reclama el trabajo más antiguo que se pueda ejecutar: uno en cola, o uno
-- "en marcha" cuyo cerrojo ha caducado (la función que lo llevaba murió: en
-- Vercel no pasa de 300 s). `FOR UPDATE SKIP LOCKED` hace que dos
-- trabajadores a la vez no se lleven el mismo.
--
-- Solo se reintenta un intento MUERTO, nunca uno que terminó con error (ese
-- lo deja el trabajador en 'failed' y ahí se queda): cada intento de generar
-- un plan son ~100 s de IA. Con `_max_attempts` intentos muertos, el trabajo
-- pasa a 'failed' en vez de reclamarse otra vez.
--
-- SECURITY INVOKER a propósito: si el permiso de ejecutar reapareciera para
-- `authenticated`, la función seguiría sin poder escribir (no tiene UPDATE).
CREATE OR REPLACE FUNCTION public.claim_job(
  _stale_seconds int DEFAULT 300,
  _max_attempts int DEFAULT 3
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.jobs j
  SET status = 'failed', error = 'attempts_exhausted', locked_at = NULL, updated_at = now()
  WHERE j.status = 'running'
    AND j.locked_at < now() - make_interval(secs => _stale_seconds)
    AND j.attempts >= _max_attempts;

  RETURN QUERY
  UPDATE public.jobs j
  SET status = 'running', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
  WHERE j.id = (
    SELECT q.id
    FROM public.jobs q
    WHERE q.status = 'queued'
       OR (q.status = 'running'
           AND q.locked_at < now() - make_interval(secs => _stale_seconds))
    ORDER BY q.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_job(int, int) FROM public;
REVOKE EXECUTE ON FUNCTION public.claim_job(int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_job(int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job(int, int) TO service_role;

-- Disparo del trabajador: cada minuto, y SOLO si hay algo que hacer (sin el
-- `WHERE EXISTS` serían 1440 invocaciones al día para nada). Quien encola
-- llama además al trabajador nada más responder, así que esto es la red para
-- cuando esa llamada se pierde y para los intentos muertos.
SELECT cron.schedule(
  'jobs-run',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_url')
           || '/api/jobs/run',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.jobs
    WHERE status = 'queued'
       OR (status = 'running' AND locked_at < now() - interval '5 minutes')
  );
  $$
);

-- Un trabajo terminado solo sirve para que la pantalla lea el resultado: a la
-- semana sobra (y `input`/`result` son datos de la persona).
SELECT cron.schedule(
  'jobs-prune',
  '17 3 * * *',
  $$
  DELETE FROM public.jobs
  WHERE status IN ('done', 'failed') AND updated_at < now() - interval '7 days';
  $$
);
