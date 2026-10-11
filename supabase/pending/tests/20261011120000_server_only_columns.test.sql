-- Ticket 39: columnas que solo escribe el servidor. Test de pgTAP de la migración
-- PENDIENTE `supabase/pending/20261011120000_server_only_columns.sql`.
--
-- No está en `supabase/tests/` porque `supabase test db` corre contra lo que hay
-- en `supabase/migrations/`, y esta migración aún no se aplica. Lo lanza
-- `scripts/check-pending-migrations.sh` (job `db` del CI): aplica la migración,
-- corre este archivo en la misma transacción y lo deshace todo. El día que la
-- migración pase a `migrations/`, este archivo pasa a `supabase/tests/` tal cual
-- (y cambian M10 y M11 de `monthly_plans_rls.test.sql`, ver el README de pending).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(29);

SELECT set_config('request.jwt.claims', '', true);

-- Ejecuta sentencias como `_uid` con el rol `_rol` y dice qué ha pasado:
-- 'PERMITIDO' (todas tocan alguna fila), 'sin efecto' (alguna no toca
-- ninguna: la RLS la filtra) o 'DENEGADO (motivo)'. Siempre deshace. Es la
-- misma función de household_rls.test.sql (pgTAP no comparte código entre
-- archivos).
CREATE FUNCTION pg_temp.vs_run(_uid uuid, _rol text, _sqls text[])
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  s text;
  filas bigint;
  menor bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid, 'role', _rol)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', _rol);
    FOREACH s IN ARRAY _sqls LOOP
      EXECUTE s;
      GET DIAGNOSTICS filas = ROW_COUNT;
      menor := LEAST(coalesce(menor, filas), filas);
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'VS001', MESSAGE = menor::text;
  EXCEPTION
    WHEN SQLSTATE 'VS001' THEN
      RETURN CASE WHEN SQLERRM = '0' THEN 'sin efecto' ELSE 'PERMITIDO' END;
    WHEN OTHERS THEN
      RETURN 'DENEGADO (' || SQLERRM || ')';
  END;
END
$f$;

-- `esperado`: 'PERMITIDO'; 'sin permiso' (lo para el GRANT de columnas, que es
-- lo que añade esta migración: tiene que ser un "permission denied", no un
-- filtro de RLS); o 'bloqueado' (DENEGADO o sin efecto, por lo que sea).
CREATE TEMP TABLE vs_casos (
  id text, quien text, que text, uid uuid, rol text, sqls text[], esperado text
);

-- X tiene un día pasado y un plan; Y, un día.
INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['dddddddd-0000-4000-a000-00000000000a', 'dddddddd-0000-4000-a000-00000000000b']) AS u;

INSERT INTO public.daily_logs (user_id, log_date)
VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date - 10), ('dddddddd-0000-4000-a000-00000000000b', current_date - 10);

INSERT INTO public.monthly_plans (user_id, month, plan)
VALUES ('dddddddd-0000-4000-a000-00000000000a', '2000-06', '[]'::jsonb);

INSERT INTO vs_casos VALUES
('S01', 'X', 'apunta lo suyo: comidas, peso, notas, ánimo y cierre del día', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET habits = '[]'::jsonb, weight_kg = 70, notes = 'n', mood = 'bien', evening_done = true WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'PERMITIDO'),
('S02', 'X', 'escribe `guide` de su día', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET guide = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S03', 'X', 'escribe `snacks` de su día', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET snacks = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S04', 'X', 'escribe `exercise` de su día', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET exercise = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S05', 'X', 'escribe `adjustment` de su día', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET adjustment = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S06', 'X', 'mueve su día a otra fecha', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET log_date = current_date - 11 WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S07', 'X', 'le pasa su día a Y', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET user_id = 'dddddddd-0000-4000-a000-00000000000b' WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S08', 'X', 'cuela `guide` junto a una columna suya', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET weight_kg = 70, guide = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'sin permiso'),
('S09', 'X', 'crea el día de hoy como lo hace la app', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date, habits) VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date, '[]'::jsonb)$q$],
   'PERMITIDO'),
('S10', 'X', 'crea el día sin pisar el que ya exista (upsert de la web)', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date, habits) VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date + 1, '[]'::jsonb) ON CONFLICT (user_id, log_date) DO NOTHING$q$],
   'PERMITIDO'),
('S11', 'X', 'rellena un día pasado con su corrección', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date, habits, weight_kg, notes, mood, evening_done) VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date - 3, '[]'::jsonb, 70, 'n', 'bien', false)$q$],
   'PERMITIDO'),
('S12', 'X', 'crea un día con `guide` ya puesta', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date, habits, guide) VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date - 4, '[]'::jsonb, '{}'::jsonb)$q$],
   'sin permiso'),
('S13', 'X', 'crea un día con `snacks` ya puesto', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date, snacks) VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date - 5, '{}'::jsonb)$q$],
   'sin permiso'),
('S14', 'X', 'lee su día entero, también lo que no puede escribir', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT guide, snacks, exercise, adjustment FROM public.daily_logs WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'PERMITIDO'),
('S15', 'X', 'borra un día suyo (no cambia con esta migración)', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$DELETE FROM public.daily_logs WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'PERMITIDO'),
('S16', 'X', 'corrige el día de Y (lo sigue parando RLS)', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET weight_kg = 1 WHERE user_id = 'dddddddd-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('S20', 'X', 'lee su plan', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT plan, shopping FROM public.monthly_plans WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('S21', 'X', 'escribe `plan` de su plan', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET plan = '[]'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'sin permiso'),
('S22', 'X', 'escribe `shopping` de su plan', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET shopping = '[]'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'sin permiso'),
('S23', 'X', 'escribe `pantry_extras` de su plan', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET pantry_extras = '[]'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'sin permiso'),
('S24', 'X', 'escribe `trip_actuals` de su plan', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET trip_actuals = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'sin permiso'),
('S25', 'X', 'escribe `confirmed_at` de su plan', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET confirmed_at = now() WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'sin permiso'),
('S26', 'X', 'crea su plan de otro mes', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.monthly_plans (user_id, month, plan) VALUES ('dddddddd-0000-4000-a000-00000000000a', '2000-01', '[]'::jsonb)$q$],
   'sin permiso'),
('S27', 'X', 'borra su plan (no cambia con esta migración)', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$DELETE FROM public.monthly_plans WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('S30', 'servidor', 'escribe la guía, el picoteo y el ajuste de un día', 'dddddddd-0000-4000-a000-00000000000a', 'service_role',
   ARRAY[$q$UPDATE public.daily_logs SET guide = '{}'::jsonb, snacks = '{}'::jsonb, exercise = '{}'::jsonb, adjustment = '{}'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'PERMITIDO'),
('S31', 'servidor', 'crea un día con picoteo (create: true)', 'dddddddd-0000-4000-a000-00000000000a', 'service_role',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date, snacks) VALUES ('dddddddd-0000-4000-a000-00000000000a', current_date - 6, '{}'::jsonb)$q$],
   'PERMITIDO'),
('S32', 'servidor', 'escribe el plan y la compra', 'dddddddd-0000-4000-a000-00000000000a', 'service_role',
   ARRAY[$q$UPDATE public.monthly_plans SET plan = '[]'::jsonb, shopping = '[]'::jsonb WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('S33', 'servidor', 'crea el plan de un mes', 'dddddddd-0000-4000-a000-00000000000a', 'service_role',
   ARRAY[$q$INSERT INTO public.monthly_plans (user_id, month, plan) VALUES ('dddddddd-0000-4000-a000-00000000000a', '2000-02', '[]'::jsonb)$q$],
   'PERMITIDO'),
('S40', 'anon', 'escribe un día sin sesión', NULL, 'anon',
   ARRAY[$q$UPDATE public.daily_logs SET weight_kg = 1 WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'bloqueado');

CREATE TEMP TABLE vs_res AS
SELECT c.id, c.quien, c.que, c.esperado, pg_temp.vs_run(c.uid, c.rol, c.sqls) AS res
FROM vs_casos c
ORDER BY c.id;

SELECT ok(
  CASE r.esperado
    WHEN 'PERMITIDO' THEN r.res = 'PERMITIDO'
    WHEN 'sin permiso' THEN r.res LIKE 'DENEGADO (permission denied%'
    ELSE r.res = 'sin efecto' OR r.res LIKE 'DENEGADO%'
  END,
  r.id || ' · ' || r.quien || ': ' || r.que || ' → ' || r.res
)
FROM vs_res r;

-- Con `true`, un caso que falla lanza: así un `psql` a secas sale con error.
SELECT * FROM finish(true);
ROLLBACK;
