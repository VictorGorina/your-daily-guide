-- Ticket 23 de la auditoría (PERF-03): quién tiene un aviso de mañana o de
-- noche en su ventana lo calcula la base de datos, en vez de leer todos los
-- perfiles en el servidor cada 5 minutos (y perder a partir del 1.000).
-- Aplicar a mano en el SQL Editor. Se puede aplicar antes o después de
-- desplegar el código: sin la función, `dispatchPush` recorre la tabla en JS.
-- Rollback: supabase/rollbacks/20261004120000_due_push_profiles.sql.
--
-- Es la MISMA regla que `dueDay` de src/lib/push-dispatch.server.ts; si cambia
-- una, cambia la otra:
--   · la hora se lee con `^\d{2}:\d{2}` (las columnas son `text`), sin `::time`:
--     un valor mal formado se ignora en vez de tumbar la función para todos;
--   · se compara en minutos enteros (hora y minuto del reloj local), sin
--     redondear segundos: el aviso toca si pasaron de 0 a `_window_minutes` − 1;
--   · si la hora objetivo es mayor que la actual, la ventana cruzó la medianoche
--     y el aviso es del día anterior (`pushDayFor`);
--   · una zona que Postgres no conoce cuenta como Europe/Madrid (`clockFor`).

BEGIN;

-- Con el instante como argumento, para poder comparar con el JS en un momento
-- concreto. La que usa el cron es la de abajo.
CREATE OR REPLACE FUNCTION public.due_push_profiles_at(
  _now timestamptz,
  _window_minutes int DEFAULT 30
)
RETURNS TABLE (id uuid, kind text, push_day date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH p AS (
    SELECT pr.id, pr.morning_time, pr.evening_time,
           pr.morning_push_sent_on, pr.evening_push_sent_on,
           (_now AT TIME ZONE COALESCE(tz.name, 'Europe/Madrid')) AS local_now
    FROM public.profiles pr
    LEFT JOIN pg_catalog.pg_timezone_names tz ON tz.name = pr.timezone
    WHERE pr.onboarding_completed
  ), slots AS (
    SELECT p.id, 'morning'::text AS kind, p.morning_time AS hhmm,
           p.morning_push_sent_on AS sent_on, p.local_now
    FROM p
    UNION ALL
    SELECT p.id, 'evening'::text, p.evening_time, p.evening_push_sent_on, p.local_now
    FROM p
  ), minutes AS (
    SELECT s.id, s.kind, s.sent_on,
           s.local_now::date AS local_day,
           EXTRACT(HOUR FROM s.local_now)::int * 60
             + EXTRACT(MINUTE FROM s.local_now)::int AS now_min,
           substring(s.hhmm FROM '^(\d{2}):\d{2}')::int * 60
             + substring(s.hhmm FROM '^\d{2}:(\d{2})')::int AS target_min
    FROM slots s
    WHERE s.hhmm ~ '^\d{2}:\d{2}'
  ), due AS (
    SELECT m.id, m.kind, m.sent_on,
           ((m.now_min - m.target_min) % 1440 + 1440) % 1440 AS since_min,
           CASE WHEN m.target_min > m.now_min THEN m.local_day - 1 ELSE m.local_day END
             AS push_day
    FROM minutes m
  )
  SELECT d.id, d.kind, d.push_day
  FROM due d
  WHERE d.since_min < _window_minutes
    AND d.sent_on IS DISTINCT FROM d.push_day
$$;

CREATE OR REPLACE FUNCTION public.due_push_profiles(_window_minutes int DEFAULT 30)
RETURNS TABLE (id uuid, kind text, push_day date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT * FROM public.due_push_profiles_at(now(), _window_minutes)
$$;

-- Solo el servidor (clave de servicio): devuelven ids de todos los perfiles.
REVOKE ALL ON FUNCTION public.due_push_profiles_at(timestamptz, int) FROM public;
REVOKE ALL ON FUNCTION public.due_push_profiles_at(timestamptz, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.due_push_profiles_at(timestamptz, int) TO service_role;
REVOKE ALL ON FUNCTION public.due_push_profiles(int) FROM public;
REVOKE ALL ON FUNCTION public.due_push_profiles(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.due_push_profiles(int) TO service_role;

-- El recorrido de la última semana del mes (aviso de renovación) y el de
-- respaldo paginan por `id` solo entre quienes acabaron el onboarding.
CREATE INDEX IF NOT EXISTS profiles_onboarded_idx
  ON public.profiles (id) WHERE onboarding_completed;

COMMIT;
