-- Permisos del hogar: ticket 04 de la auditoría 2026-09-26 (B1: SEC-DB-01 a
-- 04, SEC-DB-11, SEC-DB-15, NUEVO-07), como test de pgTAP (ticket 25).
--
-- Qué hace: dentro de una transacción que se deshace crea cuatro usuarios de
-- prueba y un hogar con su mesa, y prueba, suplantando la sesión de cada uno
-- igual que PostgREST (rol `authenticated` o `anon` + `request.jwt.claims`),
-- los ataques que describe la auditoría (tienen que quedar bloqueados) y los
-- flujos que la app tiene que seguir pudiendo hacer. Cada caso va en su propia
-- subtransacción y se deshace al acabar.
--
-- Cómo se usa: `supabase test db` contra el Supabase local; el job `db` del CI
-- lo lanza en cada push (docs/agents/testing.md). Las aserciones de pgTAP se
-- llaman siempre como `postgres`: solo las sentencias de cada caso corren con
-- el rol suplantado.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(50);

SELECT set_config('request.jwt.claims', '', true);

-- Ejecuta sentencias como `_uid` con el rol `_rol` y dice qué ha pasado:
-- 'PERMITIDO' (todas tocan alguna fila), 'sin efecto' (alguna no toca
-- ninguna: la RLS la filtra) o 'DENEGADO (motivo)'. Siempre deshace.
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

DO $vs$
DECLARE
  -- A crea el hogar y planifica; M es miembro con cuenta y no planifica;
  -- O no tiene hogar (creó uno vacío, el B); F no tiene nada y crea un hogar.
  u_a uuid := 'aaaaaaaa-0000-4000-a000-00000000000a';
  u_m uuid := 'aaaaaaaa-0000-4000-a000-00000000000b';
  u_o uuid := 'aaaaaaaa-0000-4000-a000-00000000000c';
  u_f uuid := 'aaaaaaaa-0000-4000-a000-00000000000f';
  h_a uuid := gen_random_uuid();
  h_b uuid := gen_random_uuid();
  h_f uuid := gen_random_uuid();
  m_m uuid;  -- fila de M
  s_1 uuid;  -- hueco sin reclamar de A
  k_1 uuid;  -- peque de A
  code_a text := 'VSCODEA1';
  code_b text := 'VSCODEB1';
  code_f text := 'VSCODEF1';
  slots_json text := '{"desayuno":[],"comida":[0],"cena":[0,1]}';
BEGIN
  -- Datos de prueba ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
         '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
  FROM unnest(ARRAY[u_a, u_m, u_o, u_f]) AS u;

  INSERT INTO public.households (id, name, invite_code, created_by)
  VALUES (h_a, 'VS hogar A', code_a, u_a), (h_b, 'VS hogar B', code_b, u_o);

  INSERT INTO public.household_members (household_id, user_id, role, display_name, is_planner)
  VALUES (h_a, u_a, 'adulto', 'VS A', true);
  INSERT INTO public.household_members (household_id, user_id, role, display_name)
  VALUES (h_a, u_m, 'adulto', 'VS M') RETURNING id INTO m_m;
  INSERT INTO public.household_members (household_id, user_id, role, display_name, uses_app)
  VALUES (h_a, NULL, 'adulto', 'VS hueco', true) RETURNING id INTO s_1;
  INSERT INTO public.household_children (household_id, name)
  VALUES (h_a, 'VS peque') RETURNING id INTO k_1;
  INSERT INTO public.monthly_plans (user_id, month, plan)
  VALUES (u_a, to_char(current_date, 'YYYY-MM'), '[]'::jsonb);

  -- Casos ----------------------------------------------------------------------
  INSERT INTO vs_casos VALUES
  -- Ataques (SEC-DB-01, 02, 03, 04, 11, 15)
  ('A01', 'M', 'se nombra planificador', u_m, 'authenticated',
   ARRAY[format('UPDATE public.household_members SET is_planner = true WHERE user_id = %L', u_m)],
   'bloqueado'),
  ('A02', 'M', 'se cambia a otro hogar', u_m, 'authenticated',
   ARRAY[format('UPDATE public.household_members SET household_id = %L WHERE user_id = %L', h_b, u_m)],
   'bloqueado'),
  ('A03', 'O', 'entra en el hogar A sin código, como planificador', u_o, 'authenticated',
   ARRAY[format('INSERT INTO public.household_members (household_id, user_id, display_name, is_planner) VALUES (%L, %L, %L, true)', h_a, u_o, 'VS intruso')],
   'bloqueado'),
  ('A04', 'M', 'se hace creador del hogar', u_m, 'authenticated',
   ARRAY[format('UPDATE public.households SET created_by = %L WHERE id = %L', u_m, h_a)],
   'bloqueado'),
  ('A05', 'M', 'cambia el código de invitación', u_m, 'authenticated',
   ARRAY[format('UPDATE public.households SET invite_code = %L WHERE id = %L', code_a || 'X', h_a)],
   'bloqueado'),
  ('A06', 'M', 'cambia las comidas compartidas sin planificar', u_m, 'authenticated',
   ARRAY[format('UPDATE public.households SET shared_slots = %L WHERE id = %L', slots_json, h_a)],
   'bloqueado'),
  ('A07', 'A', 'pone a otra persona (O) en un hueco', u_a, 'authenticated',
   ARRAY[format('UPDATE public.household_members SET user_id = %L WHERE id = %L', u_o, s_1)],
   'bloqueado'),
  ('A08', 'A', 'crea un hueco sin cuenta que planifica', u_a, 'authenticated',
   ARRAY[format('INSERT INTO public.household_members (household_id, user_id, display_name, is_planner) VALUES (%L, NULL, %L, true)', h_a, 'VS hueco planificador')],
   'bloqueado'),
  ('A09', 'anon', 've los huecos de un código sin sesión', NULL, 'anon',
   ARRAY[format('SELECT * FROM public.household_open_slots(%L)', code_a)],
   'bloqueado'),
  ('A10', 'O', 'lee el contexto del plan de A', u_o, 'authenticated',
   ARRAY[format('SELECT * FROM public.household_plan_context(%L)', u_a)],
   'bloqueado'),
  ('A11', 'O', 'pregunta quién planifica en casa de A', u_o, 'authenticated',
   ARRAY[format('SELECT 1 WHERE public.household_planner_of(%L) IS NOT NULL', u_a)],
   'bloqueado'),
  ('A12', 'O', 'saca el id del hogar de A', u_o, 'authenticated',
   ARRAY[format('SELECT 1 WHERE public.household_of(%L) IS NOT NULL', u_a)],
   'bloqueado'),
  ('A13', 'O', 'reasigna el planificador de un hogar ajeno', u_o, 'authenticated',
   ARRAY[format('SELECT public.household_assign_oldest_planner(%L)', h_a)],
   'bloqueado'),
  ('A14', 'O', 'lee las recetas de todos (dish_recipes)', u_o, 'authenticated',
   ARRAY['SELECT count(*) FROM public.dish_recipes'],
   'bloqueado'),
  ('A15', 'O', 'lee foods_extra', u_o, 'authenticated',
   ARRAY['SELECT count(*) FROM public.foods_extra'],
   'bloqueado'),
  -- Flujos legítimos: siguen pasando
  ('L01', 'F', 'crea un hogar y entra como planificador', u_f, 'authenticated',
   ARRAY[format('INSERT INTO public.households (id, name, invite_code, created_by) VALUES (%L, %L, %L, %L) RETURNING id', h_f, 'VS hogar F', code_f, u_f),
         format('INSERT INTO public.household_members (household_id, user_id, role, display_name, is_planner) VALUES (%L, %L, %L, %L, true)', h_f, u_f, 'adulto', 'VS F')],
   'PERMITIDO'),
  ('L02', 'A', 'añade un hueco a la mesa', u_a, 'authenticated',
   ARRAY[format('INSERT INTO public.household_members (household_id, user_id, role, display_name, uses_app, portion) VALUES (%L, NULL, %L, %L, true, 1)', h_a, 'adulto', 'VS nuevo')],
   'PERMITIDO'),
  ('L03', 'A', 'edita un hueco (nombre, app, ración)', u_a, 'authenticated',
   ARRAY[format('UPDATE public.household_members SET display_name = %L, uses_app = false, portion = 1.5 WHERE id = %L', 'VS editado', s_1)],
   'PERMITIDO'),
  ('L04', 'A', 'quita un hueco', u_a, 'authenticated',
   ARRAY[format('DELETE FROM public.household_members WHERE id = %L', s_1)],
   'PERMITIDO'),
  ('L05', 'A', 'renombra el hogar', u_a, 'authenticated',
   ARRAY[format('UPDATE public.households SET name = %L WHERE id = %L', 'VS renombrado', h_a)],
   'PERMITIDO'),
  ('L06', 'A', 'guarda y borra el objetivo del hogar', u_a, 'authenticated',
   ARRAY[format('UPDATE public.households SET goal_type = %L, goal_text = NULL, goal_budget_eur = 400 WHERE id = %L', 'presupuesto', h_a),
         format('UPDATE public.households SET goal_type = NULL, goal_text = NULL, goal_budget_eur = NULL WHERE id = %L', h_a)],
   'PERMITIDO'),
  ('L07', 'A', 'cambia las comidas compartidas (planifica)', u_a, 'authenticated',
   ARRAY[format('UPDATE public.households SET shared_slots = %L WHERE id = %L', slots_json, h_a)],
   'PERMITIDO'),
  ('L08', 'M', 'cambia su horario en casa', u_m, 'authenticated',
   ARRAY[format('UPDATE public.household_members SET home_schedule = %L WHERE user_id = %L', slots_json, u_m)],
   'PERMITIDO'),
  ('L09', 'M', 'cambia su nombre y su ración', u_m, 'authenticated',
   ARRAY[format('UPDATE public.household_members SET display_name = %L, portion = 1.2 WHERE user_id = %L', 'VS M2', u_m)],
   'PERMITIDO'),
  ('L10', 'A', 'cede la planificación a M', u_a, 'authenticated',
   ARRAY[format('SELECT public.set_household_planner(%L, %L)', h_a, m_m)],
   'PERMITIDO'),
  ('L11', 'O', 'busca los huecos con el código bueno', u_o, 'authenticated',
   ARRAY[format('SELECT * FROM public.household_open_slots(%L)', code_a)],
   'PERMITIDO'),
  ('L12', 'O', 'reclama el hueco con el código bueno', u_o, 'authenticated',
   ARRAY[format('SELECT 1 WHERE public.claim_household_slot(%L, %L) IS NOT NULL', code_a, s_1)],
   'PERMITIDO'),
  ('L13', 'A', 'lista la mesa (household_member_list)', u_a, 'authenticated',
   ARRAY['SELECT * FROM public.household_member_list()'],
   'PERMITIDO'),
  ('L14', 'M', 'lee su contexto del plan', u_m, 'authenticated',
   ARRAY[format('SELECT 1 FROM public.household_plan_context(%L) WHERE planner_id = %L', u_m, u_a)],
   'PERMITIDO'),
  ('L15', 'M', 'lee el plan del planificador (monthly_plans)', u_m, 'authenticated',
   ARRAY[format('SELECT 1 FROM public.monthly_plans WHERE user_id = %L', u_a)],
   'PERMITIDO'),
  ('L16', 'M', 'añade, edita y quita un peque', u_m, 'authenticated',
   ARRAY[format('INSERT INTO public.household_children (household_id, name) VALUES (%L, %L)', h_a, 'VS peque 2'),
         format('UPDATE public.household_children SET portion = 0.75 WHERE id = %L', k_1),
         format('DELETE FROM public.household_children WHERE id = %L', k_1)],
   'PERMITIDO'),
  ('L17', 'M', 'sale del hogar', u_m, 'authenticated',
   ARRAY[format('DELETE FROM public.household_members WHERE user_id = %L', u_m)],
   'PERMITIDO'),
  ('L18', 'servidor', 'lee dish_recipes con la clave de servicio', NULL, 'service_role',
   ARRAY['SELECT count(*) FROM public.dish_recipes'],
   'PERMITIDO'),
  ('L19', 'servidor', 'cambia comidas compartidas con la clave de servicio', NULL, 'service_role',
   ARRAY[format('UPDATE public.households SET shared_slots = %L WHERE id = %L', slots_json, h_a)],
   'PERMITIDO');

END
$vs$;

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

-- A16 (NUEVO-07): tres códigos malos, cada uno en su propia petición, cuentan
-- en el límite de intentos. Una excepción desharía también el +1, así que una
-- función que lanzara con el código malo dejaría el contador en 0.
DO $a16$
BEGIN
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object(
        'sub', 'aaaaaaaa-0000-4000-a000-00000000000c', 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      PERFORM public.claim_household_slot('VS-NO-EXISTE', gen_random_uuid());
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', '', true);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END
$a16$;

SELECT is(
  coalesce((SELECT attempts FROM public.join_attempts
            WHERE user_id = 'aaaaaaaa-0000-4000-a000-00000000000c'), 0),
  3,
  'A16 · O: tres códigos malos seguidos cuentan en el límite'
);

-- Permisos (P): `has_*_privilege` cuenta también lo que llega por PUBLIC.
-- Una tabla y una función nuevas comprueban los privilegios por defecto.
CREATE TABLE public._vs_probe (id int);
CREATE FUNCTION public._vs_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';

SELECT is(p.tiene, p.esperado, p.id || ' · ' || p.que)
FROM (VALUES
  ('P01', 'anon lee households',
    has_table_privilege('anon', 'public.households', 'SELECT'), false),
  ('P02', 'anon lee daily_logs',
    has_table_privilege('anon', 'public.daily_logs', 'SELECT'), false),
  ('P03', 'authenticated hace TRUNCATE de profiles',
    has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'), false),
  ('P04', 'authenticated lee join_attempts',
    has_table_privilege('authenticated', 'public.join_attempts', 'SELECT'), false),
  ('P05', 'authenticated escribe household_members.is_planner',
    has_column_privilege('authenticated', 'public.household_members', 'is_planner', 'UPDATE'), false),
  ('P06', 'authenticated escribe households.created_by',
    has_column_privilege('authenticated', 'public.households', 'created_by', 'UPDATE'), false),
  ('P07', 'authenticated escribe household_members.portion',
    has_column_privilege('authenticated', 'public.household_members', 'portion', 'UPDATE'), true),
  ('P08', 'anon ejecuta household_open_slots',
    has_function_privilege('anon', 'public.household_open_slots(text)', 'EXECUTE'), false),
  ('P09', 'authenticated ejecuta household_of',
    has_function_privilege('authenticated', 'public.household_of(uuid)', 'EXECUTE'), false),
  ('P10', 'authenticated ejecuta is_household_member (políticas)',
    has_function_privilege('authenticated', 'public.is_household_member(uuid, uuid)', 'EXECUTE'), true),
  ('P11', 'authenticated ejecuta household_planner_of (política de monthly_plans)',
    has_function_privilege('authenticated', 'public.household_planner_of(uuid)', 'EXECUTE'), true),
  ('P12', 'tabla nueva: anon la lee',
    has_table_privilege('anon', 'public._vs_probe', 'SELECT'), false),
  ('P13', 'tabla nueva: authenticated la lee',
    has_table_privilege('authenticated', 'public._vs_probe', 'SELECT'), true),
  ('P14', 'función nueva: anon la ejecuta',
    has_function_privilege('anon', 'public._vs_probe_fn()', 'EXECUTE'), false),
  ('P15', 'función nueva: authenticated la ejecuta',
    has_function_privilege('authenticated', 'public._vs_probe_fn()', 'EXECUTE'), true)
) AS p(id, que, tiene, esperado);

SELECT * FROM finish();
ROLLBACK;
