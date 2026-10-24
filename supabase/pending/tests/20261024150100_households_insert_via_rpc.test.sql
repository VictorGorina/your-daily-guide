-- Ticket 37, punto 5 (segunda parte): test de pgTAP de la migración PENDIENTE
-- `supabase/pending/20261024150100_households_insert_via_rpc.sql`. Lo lanza
-- `scripts/check-pending-migrations.sh` (job `db` del CI): aplica la migración,
-- corre este archivo en la misma transacción y lo deshace todo. El día que la
-- migración pase a `migrations/`, este archivo pasa a `supabase/tests/` tal cual
-- (y L01 de household_rls.test.sql cambia, ver el README de pending).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

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

INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
VALUES ('a2000000-0000-4000-a000-00000000000a', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now());

SELECT is(pg_temp.vs_as('a2000000-0000-4000-a000-00000000000a', 'authenticated',
  $$ INSERT INTO public.households (name, invite_code, created_by)
     VALUES ('VS', 'ELEGIDO1', 'a2000000-0000-4000-a000-00000000000a') RETURNING id::text $$),
  'ERR 42501', 'P01 la sesión ya no inserta un hogar con el código que quiera');
SELECT ok(NOT has_table_privilege('authenticated', 'public.households', 'INSERT'),
          'P02 sin el privilegio de tabla');
SELECT matches(pg_temp.vs_as('a2000000-0000-4000-a000-00000000000a', 'authenticated',
  $$ SELECT public.create_household('VS')::text $$),
  '^[0-9a-f]{8}-', 'P03 create_household sigue creando el hogar');
SELECT is((SELECT is_planner FROM public.household_members
           WHERE user_id = 'a2000000-0000-4000-a000-00000000000a'), true,
          'P04 con su fila de planificador, sin la policy de siembra');

SELECT * FROM finish();
ROLLBACK;
