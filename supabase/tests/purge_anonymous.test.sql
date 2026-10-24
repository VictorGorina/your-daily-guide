-- Ticket 29, punto 5 (20261024160000_purge_anonymous.sql): el cron borra las
-- cuentas anónimas que llevan 30 días sin usarse, y ninguna otra. Test de
-- pgTAP; lo lanza `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

-- p1 anónima de hace 60 días, sin sesión             → se borra (la primera)
-- p2 anónima vieja con una sesión renovada anteayer  → se queda
-- p3 anónima vieja con una sesión tocada hace 3 días → se queda
-- p4 anónima de hace 5 días                          → se queda
-- p5 cuenta con correo de hace 60 días               → se queda
-- p6 anónima vieja con una sesión también vieja      → se borra
-- p7 anónima vieja que planifica un hogar con p8     → se borra; el hogar sigue
-- p8 cuenta con correo, del hogar de p7              → se queda y planifica
-- p9 anónima reciente que nunca inició sesión        → se queda
INSERT INTO auth.users (id, instance_id, aud, role, email, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at, last_sign_in_at)
SELECT id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       email, anon, '{}'::jsonb, '{}'::jsonb, now() - age, now() - age, now() - signed
FROM (VALUES
  ('d0000000-0000-4000-a000-000000000001', NULL, true, interval '60 days', interval '60 days'),
  ('d0000000-0000-4000-a000-000000000002', NULL, true, interval '45 days', interval '45 days'),
  ('d0000000-0000-4000-a000-000000000003', NULL, true, interval '45 days', interval '45 days'),
  ('d0000000-0000-4000-a000-000000000004', NULL, true, interval '5 days', interval '5 days'),
  ('d0000000-0000-4000-a000-000000000005', 'p5@example.com', false, interval '60 days',
   interval '60 days'),
  ('d0000000-0000-4000-a000-000000000006', NULL, true, interval '50 days', interval '50 days'),
  ('d0000000-0000-4000-a000-000000000007', NULL, true, interval '40 days', interval '40 days'),
  ('d0000000-0000-4000-a000-000000000008', 'p8@example.com', false, interval '2 days',
   interval '1 day'),
  ('d0000000-0000-4000-a000-000000000009', NULL, true, interval '3 days', NULL)
) AS v(id, email, anon, age, signed);

-- `refreshed_at` es `timestamp` sin zona, en UTC (como lo escribe GoTrue).
INSERT INTO auth.sessions (id, user_id, created_at, updated_at, refreshed_at) VALUES
  (gen_random_uuid(), 'd0000000-0000-4000-a000-000000000002', now() - interval '45 days',
   now() - interval '45 days', (now() - interval '2 days') AT TIME ZONE 'UTC'),
  (gen_random_uuid(), 'd0000000-0000-4000-a000-000000000003', now() - interval '45 days',
   now() - interval '3 days', NULL),
  (gen_random_uuid(), 'd0000000-0000-4000-a000-000000000006', now() - interval '50 days',
   now() - interval '40 days', (now() - interval '40 days') AT TIME ZONE 'UTC');

INSERT INTO public.profiles (id) VALUES ('d0000000-0000-4000-a000-000000000001')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rate_limits (subject, bucket, attempts, window_start) VALUES
  ('user:d0000000-0000-4000-a000-000000000001', 'chat', 1, now()),
  ('user:d0000000-0000-4000-a000-000000000004', 'chat', 1, now());

INSERT INTO public.households (id, name, invite_code, created_by) VALUES
  ('e0000000-0000-4000-a000-000000000001', 'Purga', 'PURGEA01',
   'd0000000-0000-4000-a000-000000000007');
INSERT INTO public.household_members (household_id, user_id, role, display_name, is_planner)
VALUES
  ('e0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000007', 'adulto',
   'P7', true),
  ('e0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-000000000008', 'adulto',
   'P8', false);

-- Con tope de 1, la más antigua primero.
SELECT is(public.purge_inactive_anonymous_users(1), 1, 'P01 con _max = 1 borra una');
SELECT ok(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000001')
          AND EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000006'),
          'P02 la que lleva más tiempo sin usarse va primero');
SELECT is(public.purge_inactive_anonymous_users(), 2, 'P03 la siguiente pasada borra las otras dos');
SELECT ok(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000006'),
          'P04 una sesión vieja no la salva');
SELECT ok(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000007'),
          'P05 planificar un hogar no la salva');

SELECT ok(EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000002'),
          'P06 un demo con el token renovado hace poco se queda, aunque entrara hace 45 días');
SELECT ok(EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000003'),
          'P07 también si solo cambió updated_at de su sesión');
SELECT ok(EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000004'),
          'P08 una anónima reciente se queda');
SELECT ok(EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000005'),
          'P09 una cuenta con correo NUNCA se borra, por vieja que sea');
SELECT ok(EXISTS (SELECT 1 FROM auth.users WHERE id = 'd0000000-0000-4000-a000-000000000009'),
          'P10 sin last_sign_in_at cuenta el alta');

SELECT ok(EXISTS (SELECT 1 FROM public.households WHERE id = 'e0000000-0000-4000-a000-000000000001'),
          'P11 el hogar sigue: queda alguien con cuenta');
SELECT ok((SELECT is_planner FROM public.household_members
           WHERE user_id = 'd0000000-0000-4000-a000-000000000008'),
          'P12 y planifica quien queda');
SELECT ok((SELECT created_by IS NULL FROM public.households
           WHERE id = 'e0000000-0000-4000-a000-000000000001'),
          'P13 sin creador (ON DELETE SET NULL)');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.profiles
                      WHERE id = 'd0000000-0000-4000-a000-000000000001'),
          'P14 su perfil cae en cascada');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.rate_limits
                      WHERE subject = 'user:d0000000-0000-4000-a000-000000000001')
          AND EXISTS (SELECT 1 FROM public.rate_limits
                      WHERE subject = 'user:d0000000-0000-4000-a000-000000000004'),
          'P15 sus cuotas también, y solo las suyas');
SELECT is(public.purge_inactive_anonymous_users(), 0, 'P16 sin nada más que borrar, 0');

SELECT ok(NOT has_function_privilege('anon', 'public.purge_inactive_anonymous_users(integer)',
                                     'EXECUTE'), 'P17 anon no la ejecuta');
SELECT ok(NOT has_function_privilege('authenticated',
                                     'public.purge_inactive_anonymous_users(integer)', 'EXECUTE'),
          'P18 authenticated no la ejecuta');
SELECT ok(NOT has_function_privilege('service_role',
                                     'public.purge_inactive_anonymous_users(integer)', 'EXECUTE'),
          'P19 ni el servidor: solo el cron');
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'purge-anon-users'), '15 3 * * *',
          'P20 el cron la lanza cada noche a las 03:15 UTC');

SELECT * FROM finish();
ROLLBACK;
