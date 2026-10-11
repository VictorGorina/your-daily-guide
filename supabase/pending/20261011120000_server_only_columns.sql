-- Ticket 39 de la auditoría (SEC-DB-07): columnas que solo escribe el servidor.
-- Rollback: supabase/rollbacks/20261011120000_server_only_columns.sql.
-- Tests: supabase/pending/tests/20261011120000_server_only_columns.test.sql.
--
-- Hasta ahora la sesión de una persona podía escribir por PostgREST cualquier
-- columna de sus filas de `daily_logs` y `monthly_plans`, saltándose los
-- validadores del servidor (`assertCleanFood`, topes, coherencia del plan); y lo
-- que el planificador metiera a mano en `plan` llegaba al resto del hogar con
-- `syncSharedMeals`. RLS decide de QUIÉN es la fila; esto decide QUÉ columnas.
--
-- El servidor escribe con `service_role` (`supabaseAdmin`) y no se ve afectado.
-- Las políticas RLS no cambian. `DELETE` tampoco: borrar una fila propia sigue
-- permitido (ningún cliente lo usa hoy; queda fuera de este ticket).
--
-- NO APLICAR mientras haya en uso una build del móvil anterior a `85a4b13`:
-- esas builds escriben `daily_logs.guide` con la sesión y dejarían de guardar la
-- guía del día. Ver supabase/pending/README.md.

-- daily_logs: el cliente crea el día y escribe solo lo que la persona apunta.
-- La lista de UPDATE es `CLIENT_DAY_COLUMNS` (src/lib/day-row.ts): si cambia una,
-- cambia la otra. `guide`, `snacks`, `exercise` y `adjustment` van por el
-- servidor; `user_id` y `log_date` dejan de poder cambiarse en una fila que ya
-- existe.
REVOKE INSERT, UPDATE ON public.daily_logs FROM authenticated, anon;
GRANT INSERT (user_id, log_date, habits, weight_kg, notes, mood, evening_done)
  ON public.daily_logs TO authenticated;
GRANT UPDATE (habits, weight_kg, notes, mood, evening_done)
  ON public.daily_logs TO authenticated;

-- monthly_plans: ningún cliente escribe aquí. El plan, la compra y su estado
-- van por server functions (`updatePlanRowCas`, `updateShoppingState`,
-- `generateMonthlyPlan`).
REVOKE INSERT, UPDATE ON public.monthly_plans FROM authenticated, anon;
