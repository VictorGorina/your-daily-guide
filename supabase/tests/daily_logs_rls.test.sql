-- RLS de `daily_logs`: cada persona solo ve y toca sus días; se crea un día
-- entre hace 45 y mañana (20260906120000) y se corrige cualquier día propio
-- (20260815130000). Test de pgTAP (ticket 25); lo lanza `supabase test db`.
-- El `log_date` inmutable llega con el ticket 37: su caso se añade entonces.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

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

-- X tiene dos días pasados (uno fuera de la ventana de creación); Y, el de hoy.
INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['bbbbbbbb-0000-4000-a000-00000000000a', 'bbbbbbbb-0000-4000-a000-00000000000b']) AS u;

INSERT INTO public.daily_logs (user_id, log_date)
VALUES ('bbbbbbbb-0000-4000-a000-00000000000a', current_date - 10), ('bbbbbbbb-0000-4000-a000-00000000000a', current_date - 60), ('bbbbbbbb-0000-4000-a000-00000000000b', current_date);

INSERT INTO vs_casos VALUES
('D01', 'X', 'lee su registro', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.daily_logs WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('D02', 'X', 'lee el registro de Y', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.daily_logs WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('D03', 'X', 'crea el día de hoy', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date) VALUES ('bbbbbbbb-0000-4000-a000-00000000000a', current_date)$q$],
   'PERMITIDO'),
('D04', 'X', 'crea el de mañana (su zona va por delante de UTC)', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date) VALUES ('bbbbbbbb-0000-4000-a000-00000000000a', current_date + 1)$q$],
   'PERMITIDO'),
('D05', 'X', 'crea el de pasado mañana', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date) VALUES ('bbbbbbbb-0000-4000-a000-00000000000a', current_date + 2)$q$],
   'bloqueado'),
('D06', 'X', 'rellena un día de hace 45', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date) VALUES ('bbbbbbbb-0000-4000-a000-00000000000a', current_date - 45)$q$],
   'PERMITIDO'),
('D07', 'X', 'rellena un día de hace 46', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date) VALUES ('bbbbbbbb-0000-4000-a000-00000000000a', current_date - 46)$q$],
   'bloqueado'),
('D08', 'X', 'crea un registro a nombre de Y', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.daily_logs (user_id, log_date) VALUES ('bbbbbbbb-0000-4000-a000-00000000000b', current_date - 1)$q$],
   'bloqueado'),
('D09', 'X', 'corrige un día pasado suyo, también uno antiguo', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET weight_kg = 70 WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$,
         $q$UPDATE public.daily_logs SET weight_kg = 70 WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000a' AND log_date = current_date - 60$q$],
   'PERMITIDO'),
('D10', 'X', 'corrige el registro de Y', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET weight_kg = 1 WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('D11', 'X', 'le pasa su registro a Y', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$UPDATE public.daily_logs SET user_id = 'bbbbbbbb-0000-4000-a000-00000000000b' WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'bloqueado'),
('D12', 'X', 'borra un registro suyo', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$DELETE FROM public.daily_logs WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000a' AND log_date = current_date - 10$q$],
   'PERMITIDO'),
('D13', 'X', 'borra el registro de Y', 'bbbbbbbb-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$DELETE FROM public.daily_logs WHERE user_id = 'bbbbbbbb-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('D14', 'anon', 'lee registros sin sesión', NULL, 'anon',
   ARRAY[$q$SELECT count(*) FROM public.daily_logs$q$],
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
