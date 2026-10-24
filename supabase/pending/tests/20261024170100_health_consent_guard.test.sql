-- Ticket 30, segunda parte: test de pgTAP de la migración PENDIENTE
-- `supabase/pending/20261024170100_health_consent_guard.sql`. Lo lanza
-- `scripts/check-pending-migrations.sh` (job `db` del CI): aplica la migración,
-- corre este archivo en la misma transacción y lo deshace todo. El día que la
-- migración pase a `migrations/`, este archivo pasa a `supabase/tests/` tal cual.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

SELECT set_config('request.jwt.claims', '', true);

CREATE FUNCTION pg_temp.vs_as(_uid uuid, _rol text, _sql text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  r text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', _rol)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', _rol);
  BEGIN
    EXECUTE _sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    r := 'ERR ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN coalesce(r, 'NULL');
END;
$f$;

-- 1: sin consentimiento. 2: con datos de salud de antes del consentimiento.
INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
VALUES ('c4000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now()),
       ('c4000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now());
INSERT INTO public.profiles (id) VALUES ('c4000000-0000-4000-a000-000000000001'),
  ('c4000000-0000-4000-a000-000000000002') ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles DISABLE TRIGGER profiles_require_health_consent;
UPDATE public.profiles SET medications = 'metformina', ed_history = 'pasada'
  WHERE id = 'c4000000-0000-4000-a000-000000000002';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_require_health_consent;

-- ── Sin consentimiento ──────────────────────────────────────────────────────
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET medications = 'x'
     WHERE id = 'c4000000-0000-4000-a000-000000000001' RETURNING 'ok' $$),
  'ERR 23514', 'G01 sin consentimiento no se guarda la medicación');
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.profiles (id, smoking) VALUES ('c4000000-0000-4000-a000-000000000001', 'sí')
     ON CONFLICT (id) DO UPDATE SET smoking = EXCLUDED.smoking RETURNING 'ok' $$),
  'ERR 23514', 'G02 ni por el upsert de saveProfile');
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.profiles (id, display_name) VALUES ('c4000000-0000-4000-a000-000000000001', 'Ana')
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING display_name $$),
  'Ana', 'G03 el resto del perfil se guarda como siempre');

-- ── Con consentimiento ──────────────────────────────────────────────────────
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.profiles (id, health_consent_at, health_consent_version, pregnancy_status)
     VALUES ('c4000000-0000-4000-a000-000000000001', now(), '2026-10', 'embarazada')
     ON CONFLICT (id) DO UPDATE SET health_consent_at = EXCLUDED.health_consent_at,
       health_consent_version = EXCLUDED.health_consent_version,
       pregnancy_status = EXCLUDED.pregnancy_status
     RETURNING pregnancy_status $$),
  'embarazada', 'G04 el consentimiento y el dato en la misma escritura (onboarding)');
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.profiles (id, medications) VALUES ('c4000000-0000-4000-a000-000000000001', 'x')
     ON CONFLICT (id) DO UPDATE SET medications = EXCLUDED.medications RETURNING medications $$),
  'x', 'G05 después, cualquier dato de salud (el upsert no trae el consentimiento)');
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET health_consent_at = NULL
     WHERE id = 'c4000000-0000-4000-a000-000000000001'
     RETURNING concat_ws(',', medications, pregnancy_status, 'vacío') $$),
  'vacío', 'G06 retirarlo borra los datos de salud aunque el cliente no los mande');

-- ── Cuentas de antes ────────────────────────────────────────────────────────
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000002', 'authenticated',
  $$ UPDATE public.profiles SET timezone = 'Europe/Madrid'
     WHERE id = 'c4000000-0000-4000-a000-000000000002' RETURNING medications $$),
  'metformina', 'G07 sus datos de antes no rompen otras escrituras del perfil');
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000002', 'authenticated',
  $$ UPDATE public.profiles SET medications = 'otra'
     WHERE id = 'c4000000-0000-4000-a000-000000000002' RETURNING 'ok' $$),
  'ERR 23514', 'G08 pero no se cambian sin consentimiento');
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000002', 'authenticated',
  $$ UPDATE public.profiles SET medications = NULL, ed_history = NULL
     WHERE id = 'c4000000-0000-4000-a000-000000000002' RETURNING coalesce(medications, 'vacío') $$),
  'vacío', 'G09 «No acepto» los borra');

-- ── Fila nueva ──────────────────────────────────────────────────────────────
DELETE FROM public.profiles WHERE id = 'c4000000-0000-4000-a000-000000000001';
SELECT is(pg_temp.vs_as('c4000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.profiles (id, alcohol) VALUES ('c4000000-0000-4000-a000-000000000001', 'frecuente')
     RETURNING 'ok' $$),
  'ERR 23514', 'G10 un perfil nuevo tampoco nace con datos de salud sin consentimiento');

SELECT * FROM finish();
ROLLBACK;
