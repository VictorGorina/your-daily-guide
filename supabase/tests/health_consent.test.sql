-- Ticket 30 (20261024170000_health_consent.sql): la fecha y la versión del
-- consentimiento para los datos de salud. Test de pgTAP; lo lanza `supabase test db`.
--
-- Dentro de una transacción `now()` no cambia: para ver si la fecha se mueve,
-- se pone antes una del pasado con el trigger apagado.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SELECT set_config('request.jwt.claims', '', true);

-- Ejecuta `_sql` como `_uid` con el rol `_rol` y devuelve su primer valor
-- como texto, 'NULL' si no devuelve nada o 'ERR <sqlstate>' si falla.
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

INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
VALUES ('c3000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now());
INSERT INTO public.profiles (id) VALUES ('c3000000-0000-4000-a000-000000000001')
  ON CONFLICT (id) DO NOTHING;

-- Como lo manda `saveProfile`: upsert con las columnas del parche.
SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.profiles (id, health_consent_at, health_consent_version)
     VALUES ('c3000000-0000-4000-a000-000000000001', '2000-01-01', '2026-10')
     ON CONFLICT (id) DO UPDATE SET health_consent_at = EXCLUDED.health_consent_at,
       health_consent_version = EXCLUDED.health_consent_version
     RETURNING (health_consent_at = now())::text $$),
  'true', 'H01 la fecha la pone la base de datos, no el dispositivo');

ALTER TABLE public.profiles DISABLE TRIGGER profiles_stamp_health_consent;
UPDATE public.profiles SET health_consent_at = '2020-05-05 10:00+00'
  WHERE id = 'c3000000-0000-4000-a000-000000000001';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_stamp_health_consent;

SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET health_consent_at = '2030-01-01', health_consent_version = '2026-10'
     WHERE id = 'c3000000-0000-4000-a000-000000000001'
     RETURNING to_char(health_consent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') $$),
  '2020-05-05', 'H02 volver a aceptar la misma versión no mueve la fecha');
SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET timezone = 'Europe/Madrid'
     WHERE id = 'c3000000-0000-4000-a000-000000000001'
     RETURNING to_char(health_consent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') $$),
  '2020-05-05', 'H03 ni otra escritura del perfil');
SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET health_consent_at = '2030-01-01', health_consent_version = '2027-01'
     WHERE id = 'c3000000-0000-4000-a000-000000000001'
     RETURNING (health_consent_at = now())::text $$),
  'true', 'H04 aceptar una versión nueva del texto la pone al día');

SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET health_consent_at = NULL
     WHERE id = 'c3000000-0000-4000-a000-000000000001'
     RETURNING coalesce(health_consent_version, 'sin versión') $$),
  'sin versión', 'H05 retirarlo quita también la versión');
SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET health_consent_at = now()
     WHERE id = 'c3000000-0000-4000-a000-000000000001' RETURNING 'ok' $$),
  'ERR 23514', 'H06 no hay consentimiento sin la versión del texto aceptado');
SELECT is(pg_temp.vs_as('c3000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.profiles SET health_consent_at = now(), health_consent_version = repeat('v', 21)
     WHERE id = 'c3000000-0000-4000-a000-000000000001' RETURNING 'ok' $$),
  'ERR 23514', 'H07 ni con una versión de más de 20 caracteres');
SELECT has_column('public', 'profiles', 'health_consent_version', 'H08 la columna existe');

SELECT * FROM finish();
ROLLBACK;
