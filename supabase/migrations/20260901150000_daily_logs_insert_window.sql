-- La policy de INSERT de daily_logs exigía log_date = current_date, y
-- current_date es la fecha de Postgres en UTC. El "hoy" de la app es
-- Europe/Madrid (madridTodayISO en web, fecha local del dispositivo en móvil),
-- que va hasta un día por delante de UTC. Resultado: cada noche, entre la
-- medianoche de Madrid y la de UTC (~1-2 h), no se podía crear el registro del
-- día nuevo — se bloqueaban ensureTodayLog, la carga de comidas de Hoy, el
-- coach y el botón de anotar el peso.
--
-- Se amplía la ventana a current_date ± 1 día. Eso solo permite crear el
-- registro de "hoy" según el reloj del cliente (y como mucho el de mañana); no
-- abre la puerta a rellenar histórico arbitrario. Las correcciones de días
-- pasados siguen yendo por la policy "update own logs" (migración
-- 20260815130000) con su guardia en updateLogByDate, y habits/weight_kg nunca
-- alimentan monthly_plans ni shopping.
DROP POLICY IF EXISTS "insert today log" ON public.daily_logs;
CREATE POLICY "insert recent own log" ON public.daily_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND log_date BETWEEN current_date - 1 AND current_date + 1
  );
