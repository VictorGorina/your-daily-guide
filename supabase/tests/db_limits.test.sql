-- Ticket 37, punto 4 (20261024130000_db_limits.sql): topes de nombres y de
-- jsonb, y la fecha de un registro del día que no cambia con la sesión. Test de
-- pgTAP; lo lanza `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

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
VALUES ('d0000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now());
INSERT INTO public.profiles (id) VALUES ('d0000000-0000-4000-a000-000000000001')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.households (id, name, invite_code, created_by)
VALUES ('d0000000-0000-4000-b000-000000000001', 'Casa', 'LIMITS01',
        'd0000000-0000-4000-a000-000000000001');
INSERT INTO public.daily_logs (user_id, log_date)
VALUES ('d0000000-0000-4000-a000-000000000001', current_date - 1);

-- ── Nombres ─────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ UPDATE public.households SET name = repeat('a', 61)
     WHERE id = 'd0000000-0000-4000-b000-000000000001' $$,
  '23514', NULL, 'L01 un hogar no se llama con 61 caracteres');
SELECT lives_ok(
  $$ UPDATE public.households SET name = repeat('a', 60)
     WHERE id = 'd0000000-0000-4000-b000-000000000001' $$,
  'L02 con 60 sí');
SELECT throws_ok(
  $$ UPDATE public.profiles SET display_name = repeat('é', 61)
     WHERE id = 'd0000000-0000-4000-a000-000000000001' $$,
  '23514', NULL, 'L03 el perfil tampoco (cuenta caracteres, no bytes)');
SELECT throws_ok(
  $$ INSERT INTO public.household_members (household_id, display_name)
     VALUES ('d0000000-0000-4000-b000-000000000001', repeat('a', 61)) $$,
  '23514', NULL, 'L04 ni una persona de la mesa');
SELECT throws_ok(
  $$ INSERT INTO public.household_children (household_id, name)
     VALUES ('d0000000-0000-4000-b000-000000000001', repeat('a', 61)) $$,
  '23514', NULL, 'L05 ni un niño');

-- ── jsonb (el CHECK mide el valor sin comprimir) ────────────────────────────
SELECT throws_ok(
  $$ UPDATE public.daily_logs SET habits = jsonb_build_object('x', repeat('a', 70000))
     WHERE user_id = 'd0000000-0000-4000-a000-000000000001' $$,
  '23514', NULL, 'L06 unos hábitos de más de 64 KB no entran');
SELECT throws_ok(
  $$ INSERT INTO public.monthly_plans (user_id, month, plan)
     VALUES ('d0000000-0000-4000-a000-000000000001', to_char(current_date, 'YYYY-MM'),
             jsonb_build_object('x', repeat('a', 600000))) $$,
  '23514', NULL, 'L07 ni un plan de más de 512 KB');
SELECT lives_ok(
  $$ UPDATE public.daily_logs SET habits = jsonb_build_object('x', repeat('a', 3000))
     WHERE user_id = 'd0000000-0000-4000-a000-000000000001' $$,
  'L08 unos hábitos normales sí');

-- ── La fecha de un registro ─────────────────────────────────────────────────
SELECT is(pg_temp.vs_as('d0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.daily_logs SET log_date = current_date
     WHERE user_id = 'd0000000-0000-4000-a000-000000000001' RETURNING log_date::text $$),
  'ERR 42501', 'L09 con la sesión no se mueve un día a otra fecha');
SELECT is(pg_temp.vs_as('d0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.daily_logs SET notes = 'ok'
     WHERE user_id = 'd0000000-0000-4000-a000-000000000001' RETURNING notes $$),
  'ok', 'L10 el resto de su día sí lo cambia');
SELECT lives_ok(
  $$ UPDATE public.daily_logs SET log_date = current_date - 2
     WHERE user_id = 'd0000000-0000-4000-a000-000000000001' $$,
  'L11 el servidor (sin sesión) sí puede');

SELECT * FROM finish();
ROLLBACK;
