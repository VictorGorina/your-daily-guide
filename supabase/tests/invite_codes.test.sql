-- Ticket 37, punto 5 (20261024150000_invite_codes.sql): el servidor genera el
-- código, solo quien creó el hogar o quien planifica lo cambia, y a los 30 días
-- deja de valer para unirse. Test de pgTAP; lo lanza `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

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

-- A crea el hogar; B no tiene nada que ver; C quiere unirse.
INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['a1000000-0000-4000-a000-00000000000a',
                  'a1000000-0000-4000-a000-00000000000b',
                  'a1000000-0000-4000-a000-00000000000c']) AS u;

-- ── Crear ───────────────────────────────────────────────────────────────────
SELECT matches(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000a', 'authenticated',
  $$ SELECT public.create_household('Casa VS')::text $$),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'I01 crea el hogar');
SELECT matches((SELECT invite_code FROM public.households
                WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'),
               '^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$', 'I02 con un código de 8 sin ambiguos');
SELECT is((SELECT is_planner FROM public.household_members
           WHERE user_id = 'a1000000-0000-4000-a000-00000000000a'), true,
          'I03 y quien lo crea es su miembro planificador');
SELECT is(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000a', 'authenticated',
  $$ SELECT public.create_household('Otra')::text $$), 'ERR 23505',
  'I04 quien ya tiene hogar no crea otro');
SELECT is((SELECT count(*)::int FROM public.households
           WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'), 1,
          'I05 y no queda un hogar huérfano');
SELECT ok(NOT has_function_privilege('anon', 'public.create_household(text)', 'EXECUTE'),
          'I06 anon no crea hogares');

-- Un sitio libre en la mesa, para unirse.
INSERT INTO public.household_members (household_id, display_name, uses_app)
SELECT id, 'Sitio libre', true FROM public.households
WHERE created_by = 'a1000000-0000-4000-a000-00000000000a';

-- ── Cambiar el código ───────────────────────────────────────────────────────
SELECT is(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000b', 'authenticated',
  format($$ SELECT public.rotate_invite_code(%L) $$,
    (SELECT id FROM public.households WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'))),
  'ERR 42501', 'I07 alguien de fuera no cambia el código');

CREATE TEMP TABLE vs_old AS
  SELECT invite_code FROM public.households
  WHERE created_by = 'a1000000-0000-4000-a000-00000000000a';
UPDATE public.households SET invite_code_created_at = now() - interval '10 days'
  WHERE created_by = 'a1000000-0000-4000-a000-00000000000a';
SELECT isnt(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000a', 'authenticated',
  format($$ SELECT public.rotate_invite_code(%L) $$,
    (SELECT id FROM public.households WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'))),
  (SELECT invite_code FROM vs_old), 'I08 quien lo creó lo cambia por otro');
SELECT ok((SELECT invite_code_created_at > now() - interval '1 minute' FROM public.households
           WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'),
          'I09 y vuelve a contar desde hoy');

-- ── Unirse ──────────────────────────────────────────────────────────────────
SELECT is(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000c', 'authenticated',
  format($$ SELECT count(*)::text FROM public.household_open_slots(%L) $$,
    (SELECT lower(invite_code) FROM public.households
     WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'))),
  '1', 'I10 con un código vigente (en minúsculas también) se ven los sitios libres');
SELECT is(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000c', 'authenticated',
  format($$ SELECT count(*)::text FROM public.household_open_slots(%L) $$,
    (SELECT invite_code FROM vs_old))),
  '0', 'I11 el código de antes ya no vale');

UPDATE public.households SET invite_code_created_at = now() - interval '31 days'
  WHERE created_by = 'a1000000-0000-4000-a000-00000000000a';
SELECT is(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000c', 'authenticated',
  format($$ SELECT count(*)::text FROM public.household_open_slots(%L) $$,
    (SELECT invite_code FROM public.households
     WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'))),
  '0', 'I12 a los 31 días tampoco');
SELECT is(pg_temp.vs_as('a1000000-0000-4000-a000-00000000000c', 'authenticated',
  format($$ SELECT public.claim_household_slot(%L, %L)::text $$,
    (SELECT invite_code FROM public.households
     WHERE created_by = 'a1000000-0000-4000-a000-00000000000a'),
    (SELECT id FROM public.household_members WHERE display_name = 'Sitio libre'))),
  'NULL', 'I13 ni para quedarse un sitio');

-- ── Único sin distinguir mayúsculas ─────────────────────────────────────────
SELECT throws_ok(
  format($$ INSERT INTO public.households (name, invite_code) VALUES ('X', %L) $$,
    (SELECT lower(invite_code) FROM public.households
     WHERE created_by = 'a1000000-0000-4000-a000-00000000000a')),
  '23505', NULL, 'I14 dos códigos que solo cambian en mayúsculas no caben');

SELECT * FROM finish();
ROLLBACK;
