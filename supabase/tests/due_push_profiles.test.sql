-- `due_push_profiles_at` (20261004120000, ticket 23): a quién le toca un aviso
-- en un instante dado. Es la misma regla que `dueDay` de
-- src/lib/push-dispatch.server.ts, que tiene sus casos en
-- push-dispatch.server.test.ts: si cambia una, cambian los dos tests.
-- Test de pgTAP (ticket 25); lo lanza `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

-- El perfil lo crea el trigger de alta; aquí solo se le pone la hora.
INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['eeeeeeee-0000-4000-a000-000000000001', 'eeeeeeee-0000-4000-a000-000000000002', 'eeeeeeee-0000-4000-a000-000000000003', 'eeeeeeee-0000-4000-a000-000000000004', 'eeeeeeee-0000-4000-a000-000000000005', 'eeeeeeee-0000-4000-a000-000000000006', 'eeeeeeee-0000-4000-a000-000000000007']) AS u;

-- El 2026-03-10 a las 07:10 UTC son las 08:10 en Madrid y la 01:10 en Ciudad
-- de México. Todos tienen la noche a las 22:00 salvo el 4.
UPDATE public.profiles SET onboarding_completed = true, evening_time = '22:00'
WHERE id IN ('eeeeeeee-0000-4000-a000-000000000001', 'eeeeeeee-0000-4000-a000-000000000002', 'eeeeeeee-0000-4000-a000-000000000003', 'eeeeeeee-0000-4000-a000-000000000004', 'eeeeeeee-0000-4000-a000-000000000005', 'eeeeeeee-0000-4000-a000-000000000006', 'eeeeeeee-0000-4000-a000-000000000007');
-- 1: mañana a las 08:00, hace 10 min → le toca.
UPDATE public.profiles SET morning_time = '08:00' WHERE id = 'eeeeeeee-0000-4000-a000-000000000001';
-- 2: igual, pero ya se le envió hoy.
UPDATE public.profiles SET morning_time = '08:00', morning_push_sent_on = '2026-03-10'
WHERE id = 'eeeeeeee-0000-4000-a000-000000000002';
-- 3: a las 07:30, hace 40 min: fuera de la ventana de 30.
UPDATE public.profiles SET morning_time = '07:30' WHERE id = 'eeeeeeee-0000-4000-a000-000000000003';
-- 4: noche a las 23:50; la mañana, lejos.
UPDATE public.profiles SET morning_time = '12:00', evening_time = '23:50' WHERE id = 'eeeeeeee-0000-4000-a000-000000000004';
-- 5: no acabó el onboarding.
UPDATE public.profiles SET morning_time = '08:00', onboarding_completed = false
WHERE id = 'eeeeeeee-0000-4000-a000-000000000005';
-- 6: otra zona; su 01:10 es este mismo instante.
UPDATE public.profiles SET morning_time = '01:10', timezone = 'America/Mexico_City'
WHERE id = 'eeeeeeee-0000-4000-a000-000000000006';
-- 7: una hora mal formada se ignora en vez de tumbar la función para todos.
UPDATE public.profiles SET morning_time = 'ocho' WHERE id = 'eeeeeeee-0000-4000-a000-000000000007';

SELECT set_eq(
  $$ SELECT id, kind, push_day
     FROM public.due_push_profiles_at('2026-03-10 07:10:00+00', 30)
     WHERE id IN ('eeeeeeee-0000-4000-a000-000000000001', 'eeeeeeee-0000-4000-a000-000000000002', 'eeeeeeee-0000-4000-a000-000000000003', 'eeeeeeee-0000-4000-a000-000000000004', 'eeeeeeee-0000-4000-a000-000000000005', 'eeeeeeee-0000-4000-a000-000000000006', 'eeeeeeee-0000-4000-a000-000000000007') $$,
  $$ VALUES ('eeeeeeee-0000-4000-a000-000000000001'::uuid, 'morning'::text, '2026-03-10'::date),
            ('eeeeeeee-0000-4000-a000-000000000006'::uuid, 'morning'::text, '2026-03-10'::date) $$,
  'N01 · a las 08:10 de Madrid: el de las 08:00 y el de la 01:10 de México; no el ya enviado, el de hace 40 min, el que no acabó el onboarding ni la hora mal formada'
);

SELECT set_eq(
  $$ SELECT id, kind, push_day
     FROM public.due_push_profiles_at('2026-03-10 07:10:00+00', 10)
     WHERE id IN ('eeeeeeee-0000-4000-a000-000000000001', 'eeeeeeee-0000-4000-a000-000000000002', 'eeeeeeee-0000-4000-a000-000000000003', 'eeeeeeee-0000-4000-a000-000000000004', 'eeeeeeee-0000-4000-a000-000000000005', 'eeeeeeee-0000-4000-a000-000000000006', 'eeeeeeee-0000-4000-a000-000000000007') $$,
  $$ VALUES ('eeeeeeee-0000-4000-a000-000000000006'::uuid, 'morning'::text, '2026-03-10'::date) $$,
  'N02 · con ventana de 10 min, quien lleva justo 10 ya no entra (de 0 a ventana − 1)'
);

-- A las 23:05 UTC son las 00:05 del día 11 en Madrid: el aviso de las 23:50
-- cruzó la medianoche y es del día 10.
SELECT set_eq(
  $$ SELECT id, kind, push_day
     FROM public.due_push_profiles_at('2026-03-10 23:05:00+00', 30)
     WHERE id IN ('eeeeeeee-0000-4000-a000-000000000001', 'eeeeeeee-0000-4000-a000-000000000002', 'eeeeeeee-0000-4000-a000-000000000003', 'eeeeeeee-0000-4000-a000-000000000004', 'eeeeeeee-0000-4000-a000-000000000005', 'eeeeeeee-0000-4000-a000-000000000006', 'eeeeeeee-0000-4000-a000-000000000007') $$,
  $$ VALUES ('eeeeeeee-0000-4000-a000-000000000004'::uuid, 'evening'::text, '2026-03-10'::date) $$,
  'N03 · un aviso de noche que cruza la medianoche pertenece al día anterior'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.due_push_profiles_at(timestamptz, int)', 'EXECUTE'),
  'N04 · anon no ejecuta due_push_profiles_at'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.due_push_profiles_at(timestamptz, int)', 'EXECUTE'),
  'N05 · authenticated no ejecuta due_push_profiles_at'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.due_push_profiles(int)', 'EXECUTE'),
  'N06 · authenticated no ejecuta due_push_profiles'
);
SELECT ok(
  has_function_privilege('service_role', 'public.due_push_profiles(int)', 'EXECUTE'),
  'N07 · service_role sí'
);

SELECT * FROM finish();
ROLLBACK;
