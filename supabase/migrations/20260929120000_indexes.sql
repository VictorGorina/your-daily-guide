-- Índices que faltaban en columnas que se filtran o que son clave foránea
-- (ticket 17 de la auditoría, PERF-14).
--
-- Postgres no indexa solo el lado que referencia de una clave foránea: sin
-- índice, cada consulta por esa columna y cada borrado de la fila referenciada
-- (ON DELETE CASCADE / SET NULL) recorren la tabla entera.
--
--   1. household_children.household_id — Familia y el plan leen los niños de un
--      hogar (`.eq("household_id")`); borrar un hogar los borra en cascada.
--   2. push_subscriptions.user_id — el dispatch del cron pide las suscripciones
--      con `.in("user_id", …)` cada 15 min; borrar la cuenta las borra en cascada.
--   3. households.created_by — las políticas de `household_members` y
--      `household_children` comprueban `h.created_by = auth.uid()`; borrar una
--      cuenta lo pone a NULL (20260928130000_households_creator_set_null).
--   4. households (upper(invite_code)) — `join_household`,
--      `household_open_slots` y `claim_household_slot` buscan con
--      `upper(invite_code) = upper(trim(_invite_code))`, y el índice único de
--      `invite_code` a secas no sirve para una expresión.
--
-- Las tablas son pequeñas: CREATE INDEX normal (el SQL Editor ejecuta dentro de
-- una transacción, donde CONCURRENTLY no se puede usar; el bloqueo dura
-- milisegundos).
--
-- Deshacer: supabase/rollbacks/20260929120000_indexes.sql.

BEGIN;

CREATE INDEX IF NOT EXISTS household_children_household_id_idx
  ON public.household_children (household_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS households_created_by_idx
  ON public.households (created_by);

CREATE INDEX IF NOT EXISTS households_invite_code_upper_idx
  ON public.households (upper(invite_code));

COMMIT;
