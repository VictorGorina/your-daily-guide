-- Feature "editar qué comí" (F1): permitir rellenar un día pasado que la persona
-- no llegó a abrir en la app. Hasta ahora la policy de INSERT solo cubría
-- current_date ± 1 día (migración 20260901150000), así que el detalle de un día
-- pasado sin registro mostraba "No registraste ninguna comida este día" sin
-- forma de corregirlo: `updateLogByDate` hacía UPDATE de 0 filas.
--
-- Se amplía la ventana de INSERT a los últimos ~45 días naturales. Eso cubre los
-- días pasados del mes en curso (el calendario de Plan no navega más atrás del
-- mes actual para editar) y la tira de 7 días de Hoy, sin abrir la puerta a
-- reescribir histórico arbitrario. Sigue en pie:
--   - `updateLogByDate` rechaza `log_date >= hoy` (solo se corrige el pasado).
--   - habits / weight_kg NUNCA alimentan monthly_plans ni la lista de la compra.
--   - la corrección de días con registro previo va por la policy de UPDATE
--     "update own logs" (20260815130000), que no cambia.
DROP POLICY IF EXISTS "insert recent own log" ON public.daily_logs;
CREATE POLICY "insert recent own log" ON public.daily_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND log_date BETWEEN current_date - 45 AND current_date + 1
  );
