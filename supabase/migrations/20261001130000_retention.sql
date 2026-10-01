-- Ticket 30 de la auditoría (RGPD, plazos aprobados en P5): borrado periódico
-- de lo que no hace falta guardar para siempre. Aplicar a mano en el SQL Editor.
-- Rollback: supabase/rollbacks/20261001130000_retention.sql.
--
-- Se conservan mientras exista la cuenta `daily_logs` y `monthly_plans`: son el
-- historial que la persona ve. Al borrar la cuenta, todo cae en cascada (y
-- `deleteAccount` borra además sus filas de `rate_limits`).

-- En Supabase, pg_cron va en pg_catalog (ver su documentación).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Conversaciones con el coach: 180 días.
SELECT cron.schedule(
  'retention-chat',
  '30 3 * * *',
  $$DELETE FROM public.chat_messages WHERE created_at < now() - interval '180 days'$$
);

-- Cuotas por hora (persona o correo con sal): una semana sobra para cualquier ventana.
SELECT cron.schedule(
  'retention-rate-limits',
  '35 3 * * *',
  $$DELETE FROM public.rate_limits WHERE window_start < now() - interval '7 days'$$
);

-- Intentos de unirse a un hogar: misma idea que rate_limits.
SELECT cron.schedule(
  'retention-join-attempts',
  '37 3 * * *',
  $$DELETE FROM public.join_attempts WHERE window_start < now() - interval '7 days'$$
);

-- Gasto en IA por día: algo más de un año, para comparar el mismo mes del año anterior.
SELECT cron.schedule(
  'retention-ai-spend',
  '40 3 * * *',
  $$DELETE FROM public.ai_spend WHERE day < current_date - 400$$
);
