-- Permite corregir un día pasado desde Historial (área 6 del roadmap UX,
-- "casos límite"). Antes solo se podía hacer UPDATE del log de hoy
-- (log_date = current_date), lo que bloqueaba a nivel de base de datos la
-- corrección retroactiva de una comida aunque la UI la ofreciera. No afecta
-- a la compra: habits/status nunca alimenta monthly_plans/shopping, así que
-- corregir un día pasado es puramente un ajuste del propio historial.
DROP POLICY IF EXISTS "update today log" ON public.daily_logs;
CREATE POLICY "update own logs" ON public.daily_logs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
