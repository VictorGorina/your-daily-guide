-- RLS de `monthly_plans`: cada persona escribe solo su fila; un miembro del
-- hogar LEE además la de quien planifica (20260901190000), y nadie la de otro
-- hogar. Test de pgTAP (ticket 25); lo lanza `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

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

-- `esperado`: 'PERMITIDO' o 'bloqueado' (DENEGADO o sin efecto).
CREATE TEMP TABLE vs_casos (
  id text, quien text, que text, uid uuid, rol text, sqls text[], esperado text
);

-- A planifica y M es miembro de su casa; O planifica en otro hogar. Cada uno
-- tiene su fila del mes.
INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['cccccccc-0000-4000-a000-00000000000a', 'cccccccc-0000-4000-a000-00000000000b', 'cccccccc-0000-4000-a000-00000000000c']) AS u;

INSERT INTO public.households (id, name, invite_code, created_by)
VALUES ('cccccccc-0000-4000-a000-0000000000a1', 'VS hogar A', 'VSPLANA1', 'cccccccc-0000-4000-a000-00000000000a'),
       ('cccccccc-0000-4000-a000-0000000000a2', 'VS hogar O', 'VSPLANO1', 'cccccccc-0000-4000-a000-00000000000c');
INSERT INTO public.household_members (household_id, user_id, role, display_name, is_planner)
VALUES ('cccccccc-0000-4000-a000-0000000000a1', 'cccccccc-0000-4000-a000-00000000000a', 'adulto', 'VS A', true),
       ('cccccccc-0000-4000-a000-0000000000a1', 'cccccccc-0000-4000-a000-00000000000b', 'adulto', 'VS M', false),
       ('cccccccc-0000-4000-a000-0000000000a2', 'cccccccc-0000-4000-a000-00000000000c', 'adulto', 'VS O', true);
INSERT INTO public.monthly_plans (user_id, month, plan)
SELECT u::uuid, to_char(current_date, 'YYYY-MM'), '[]'::jsonb
FROM unnest(ARRAY['cccccccc-0000-4000-a000-00000000000a', 'cccccccc-0000-4000-a000-00000000000b', 'cccccccc-0000-4000-a000-00000000000c']) AS u;

INSERT INTO vs_casos VALUES
('M01', 'A', 'lee su plan', 'cccccccc-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('M02', 'M', 'lee el plan de quien planifica en su casa', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('M03', 'A', 'lee el plan de M, que no planifica', 'cccccccc-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('M04', 'M', 'lee el plan de otro hogar', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000c'$q$],
   'bloqueado'),
('M05', 'O', 'lee el plan del planificador de otro hogar', 'cccccccc-0000-4000-a000-00000000000c', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000a'$q$],
   'bloqueado'),
('M06', 'M', 'escribe en la fila del planificador', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET plan = '[]'::jsonb WHERE user_id = 'cccccccc-0000-4000-a000-00000000000a'$q$],
   'bloqueado'),
('M07', 'M', 'borra la fila del planificador', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$DELETE FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000a'$q$],
   'bloqueado'),
('M08', 'M', 'crea una fila a nombre del planificador', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$INSERT INTO public.monthly_plans (user_id, month, plan) VALUES ('cccccccc-0000-4000-a000-00000000000a', '2000-01', '[]'::jsonb)$q$],
   'bloqueado'),
('M09', 'M', 'se queda la fila del planificador', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET user_id = 'cccccccc-0000-4000-a000-00000000000b' WHERE user_id = 'cccccccc-0000-4000-a000-00000000000a'$q$],
   'bloqueado'),
('M10', 'M', 'escribe y borra su propia fila', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$UPDATE public.monthly_plans SET plan = '[]'::jsonb WHERE user_id = 'cccccccc-0000-4000-a000-00000000000b'$q$,
         $q$DELETE FROM public.monthly_plans WHERE user_id = 'cccccccc-0000-4000-a000-00000000000b'$q$],
   'PERMITIDO'),
('M11', 'M', 'crea su fila de otro mes', 'cccccccc-0000-4000-a000-00000000000b', 'authenticated',
   ARRAY[$q$INSERT INTO public.monthly_plans (user_id, month, plan) VALUES ('cccccccc-0000-4000-a000-00000000000b', '2000-01', '[]'::jsonb)$q$],
   'PERMITIDO'),
('M12', 'anon', 'lee planes sin sesión', NULL, 'anon',
   ARRAY[$q$SELECT count(*) FROM public.monthly_plans$q$],
   'bloqueado');

CREATE TEMP TABLE vs_res AS
SELECT c.id, c.quien, c.que, c.esperado, pg_temp.vs_run(c.uid, c.rol, c.sqls) AS res
FROM vs_casos c
ORDER BY c.id;

SELECT ok(
  CASE r.esperado
    WHEN 'PERMITIDO' THEN r.res = 'PERMITIDO'
    ELSE r.res = 'sin efecto' OR r.res LIKE 'DENEGADO%'
  END,
  r.id || ' · ' || r.quien || ': ' || r.que || ' → ' || r.res
)
FROM vs_res r;

SELECT * FROM finish();
ROLLBACK;
