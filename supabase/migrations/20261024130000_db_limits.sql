-- Ticket 37 de la auditoría, punto 4 (SEC-DB-13): límites en la base de datos.
-- Rollback: supabase/rollbacks/20261024130000_db_limits.sql.
-- Tests: supabase/tests/db_limits.test.sql.
--
-- Los nombres y los jsonb no tenían tope: con la sesión de una persona se podía
-- guardar un nombre de un megabyte (que luego ve el resto del hogar) o un plan
-- enorme que cada pantalla vuelve a leer. Los topes van muy por encima de lo
-- real (2026-10-24, sin comprimir: nombres ≤ 7 caracteres, `habits` 2,4 KB,
-- `plan` 12,6 KB, `shopping` 13,6 KB). Un `CHECK` mide el valor antes de
-- comprimirlo, de ahí que se comparen tamaños sin comprimir. Los campos de la
-- app cortan los nombres en `NAME_MAX_LENGTH` (content-guard.ts) antes de que
-- se vea este error.
--
-- NOT VALID + VALIDATE: el ADD no recorre la tabla con el cerrojo fuerte; el
-- VALIDATE comprueba las filas que ya hay con uno más ligero.

ALTER TABLE public.households
  ADD CONSTRAINT households_name_len CHECK (length(name) <= 60) NOT VALID;
ALTER TABLE public.household_members
  ADD CONSTRAINT members_name_len CHECK (length(display_name) <= 60) NOT VALID;
ALTER TABLE public.household_children
  ADD CONSTRAINT children_name_len CHECK (length(name) <= 60) NOT VALID;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_name_len CHECK (length(display_name) <= 60) NOT VALID;
ALTER TABLE public.daily_logs
  ADD CONSTRAINT daily_logs_json_size CHECK (
    coalesce(pg_column_size(habits), 0) <= 65536
    AND coalesce(pg_column_size(snacks), 0) <= 65536
    AND coalesce(pg_column_size(exercise), 0) <= 65536
  ) NOT VALID;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_json_size CHECK (
    coalesce(pg_column_size(plan), 0) <= 524288
    AND coalesce(pg_column_size(shopping), 0) <= 262144
  ) NOT VALID;

ALTER TABLE public.households VALIDATE CONSTRAINT households_name_len;
ALTER TABLE public.household_members VALIDATE CONSTRAINT members_name_len;
ALTER TABLE public.household_children VALIDATE CONSTRAINT children_name_len;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_name_len;
ALTER TABLE public.daily_logs VALIDATE CONSTRAINT daily_logs_json_size;
ALTER TABLE public.monthly_plans VALIDATE CONSTRAINT monthly_plans_json_size;

-- La fecha de un registro del día no cambia una vez creado: con la sesión se
-- podía mover un día pasado a hoy (o al revés) y saltarse la ventana de
-- creación (`DAILY_INSERT_WINDOW`) y lo que el servidor da por hecho del
-- pasado. `auth.uid()` es NULL con la clave de servicio: el servidor sí puede.
-- El ticket 39 (supabase/pending/) quitará además el permiso de columna; esto
-- vale ya, con las builds del móvil que hay instaladas.
CREATE OR REPLACE FUNCTION public.daily_logs_date_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.log_date IS DISTINCT FROM OLD.log_date AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'La fecha de un registro no se puede cambiar' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_logs_date_immutable ON public.daily_logs;
CREATE TRIGGER daily_logs_date_immutable
  BEFORE UPDATE OF log_date ON public.daily_logs
  FOR EACH ROW EXECUTE FUNCTION public.daily_logs_date_immutable();
