-- `push_subscriptions` tras el ticket 06 (20261001120000_push_hardening.sql):
-- solo el servidor inserta, el endpoint es https y una zona horaria inválida
-- se guarda como la de por defecto. Test de pgTAP (ticket 25).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

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

INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['dddddddd-0000-4000-a000-00000000000a', 'dddddddd-0000-4000-a000-00000000000b']) AS u;

INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES ('dddddddd-0000-4000-a000-00000000000a', 'https://push.example/x', 'k', 'a'), ('dddddddd-0000-4000-a000-00000000000b', 'https://push.example/y', 'k', 'a');

INSERT INTO vs_casos VALUES
('S01', 'X', 'lee su suscripción', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.push_subscriptions WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('S02', 'X', 'lee la suscripción de Y', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$SELECT 1 FROM public.push_subscriptions WHERE user_id = 'dddddddd-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('S03', 'X', 'inserta una suscripción sin pasar por el servidor', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ('dddddddd-0000-4000-a000-00000000000a', 'https://push.example/x2', 'k', 'a')$q$],
   'bloqueado'),
('S04', 'X', 'borra su suscripción', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$DELETE FROM public.push_subscriptions WHERE user_id = 'dddddddd-0000-4000-a000-00000000000a'$q$],
   'PERMITIDO'),
('S05', 'X', 'borra la suscripción de Y', 'dddddddd-0000-4000-a000-00000000000a', 'authenticated',
   ARRAY[$q$DELETE FROM public.push_subscriptions WHERE user_id = 'dddddddd-0000-4000-a000-00000000000b'$q$],
   'bloqueado'),
('S06', 'anon', 'lee suscripciones sin sesión', NULL, 'anon',
   ARRAY[$q$SELECT count(*) FROM public.push_subscriptions$q$],
   'bloqueado'),
('S07', 'servidor', 'guarda una suscripción https', NULL, 'service_role',
   ARRAY[$q$INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ('dddddddd-0000-4000-a000-00000000000a', 'https://push.example/x3', 'k', 'a')$q$],
   'PERMITIDO'),
('S08', 'servidor', 'guarda un endpoint que no es https', NULL, 'service_role',
   ARRAY[$q$INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ('dddddddd-0000-4000-a000-00000000000a', 'http://169.254.169.254/latest', 'k', 'a')$q$],
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

UPDATE public.profiles SET timezone = 'Marte/Olimpo' WHERE id = 'dddddddd-0000-4000-a000-00000000000a';
SELECT is(
  (SELECT timezone FROM public.profiles WHERE id = 'dddddddd-0000-4000-a000-00000000000a'),
  'Europe/Madrid',
  'S09 · una zona horaria que Postgres no conoce se guarda como Europe/Madrid'
);

SELECT * FROM finish();
ROLLBACK;
