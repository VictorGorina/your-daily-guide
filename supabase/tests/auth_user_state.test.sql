-- Ticket 37, punto 2 (20261024140000_auth_user_state.sql): el estado de la
-- cuenta de un correo, solo para el servidor. Test de pgTAP; lo lanza
-- `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, is_anonymous,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c0000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'previa@example.com', NULL, false,
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c0000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'duena@example.com', now(), false,
   '{}'::jsonb, '{}'::jsonb, now(), now());

SELECT is((SELECT confirmed FROM public.auth_user_state('previa@example.com')), false,
          'A01 una cuenta sin confirmar sale como no confirmada');
SELECT is((SELECT id FROM public.auth_user_state('previa@example.com')),
          'c0000000-0000-4000-a000-000000000001'::uuid, 'A02 con su id');
SELECT is((SELECT confirmed FROM public.auth_user_state('  DUENA@example.com ')), true,
          'A03 una confirmada, también con mayúsculas y espacios');
SELECT is((SELECT count(*)::int FROM public.auth_user_state('nadie@example.com')), 0,
          'A04 un correo sin cuenta no devuelve nada');

SELECT ok(NOT has_function_privilege('anon', 'public.auth_user_state(text)', 'EXECUTE'),
          'A05 anon no la ejecuta');
SELECT ok(NOT has_function_privilege('authenticated', 'public.auth_user_state(text)', 'EXECUTE'),
          'A06 authenticated no la ejecuta (sería un buscador de cuentas)');
SELECT ok(has_function_privilege('service_role', 'public.auth_user_state(text)', 'EXECUTE'),
          'A07 service_role sí');

SELECT * FROM finish();
ROLLBACK;
