-- Rollback de 20261011120000_server_only_columns.sql (ticket 39): la sesión de
-- la persona vuelve a poder escribir cualquier columna de sus filas (lo que
-- decide de quién es cada fila sigue siendo RLS, que no se tocó).
GRANT INSERT, UPDATE ON public.daily_logs TO authenticated;
GRANT INSERT, UPDATE ON public.monthly_plans TO authenticated;
