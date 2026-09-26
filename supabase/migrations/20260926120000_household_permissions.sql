-- Permisos del hogar por columna, altas y funciones (B1 de la auditoría del
-- 2026-09-26: SEC-DB-01 a 04, SEC-DB-11, SEC-DB-15, NUEVO-07).
--
-- La regla "solo quien planifica puede…" vivía en el servidor, pero las tablas
-- dejaban hacer lo mismo a cualquiera que llamara a PostgREST con su propio
-- token: nombrarse planificador, cambiarse de hogar, entrar en uno ajeno sin
-- código, hacerse creador, cambiar el código o las comidas compartidas. Aquí la
-- base de datos pasa a decir lo mismo que el servidor.
--
-- Aplicar a mano en el SQL Editor. Verificar con supabase/tests/household_rls.sql
-- antes y después. Deshacer: supabase/rollbacks/20260926120000_household_permissions.sql
-- (los clientes funcionan con los dos estados).

BEGIN;

-- 1. household_members: UPDATE solo de las columnas que escribe la app ---------
-- Sin permiso sobre is_planner, household_id ni user_id, "update own membership"
-- y "creator or planner updates household slots" ya no sirven para nombrarse
-- planificador, cambiarse de hogar o meter a otra persona en un hueco. Esas
-- columnas las escriben solo las funciones SECURITY DEFINER
-- (claim_household_slot, set_household_planner) y los triggers, que no pasan
-- por estos permisos.
REVOKE UPDATE ON public.household_members FROM authenticated;
GRANT UPDATE (display_name, uses_app, portion, home_schedule)
  ON public.household_members TO authenticated;

-- 2. households: sin created_by ni invite_code; shared_slots solo quien planifica
REVOKE UPDATE ON public.households FROM authenticated;
GRANT UPDATE (name, goal_type, goal_text, goal_budget_eur, shared_slots)
  ON public.households TO authenticated;

-- La regla D2 (solo el planificador edita las comidas compartidas) la comprobaba
-- únicamente `saveSharedSlots`. La policy de UPDATE deja pasar a cualquier
-- miembro (renombrar y el objetivo son de todos), así que la de esta columna va
-- en un trigger.
CREATE OR REPLACE FUNCTION public.households_guard_shared_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() es NULL con la clave de servicio: el servidor puede escribir.
  IF NEW.shared_slots IS DISTINCT FROM OLD.shared_slots
     AND auth.uid() IS NOT NULL
     AND NOT public.is_household_planner(NEW.id, auth.uid()) THEN
    RAISE EXCEPTION 'Solo quien planifica puede cambiar las comidas compartidas'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS households_guard_shared_slots ON public.households;
CREATE TRIGGER households_guard_shared_slots
  BEFORE UPDATE OF shared_slots ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.households_guard_shared_slots();

-- 3. Altas: solo el creador siembra su hogar vacío; un hueco nunca planifica ----
-- "join household" dejaba insertar tu fila en CUALQUIER hogar del que supieras
-- el id, incluso como planificador. El único alta propia que hace la app es la
-- de quien acaba de crear el hogar (createHousehold); unirse a uno existente va
-- siempre por claim_household_slot, con código.
CREATE OR REPLACE FUNCTION public.household_is_empty(_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.household_members WHERE household_id = _household_id)
$$;

DROP POLICY IF EXISTS "join household" ON public.household_members;
DROP POLICY IF EXISTS "creator seeds own household" ON public.household_members;
CREATE POLICY "creator seeds own household" ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.households h
                WHERE h.id = household_id AND h.created_by = auth.uid())
    AND public.household_is_empty(household_id)
  );

-- Un hueco sin cuenta marcado como planificador apagaría al de verdad (trigger
-- single_planner) y dejaría el hogar sin nadie que planifique.
DROP POLICY IF EXISTS "creator or planner inserts household slots" ON public.household_members;
CREATE POLICY "creator or planner inserts household slots" ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id IS NULL
    AND NOT is_planner
    AND (
      EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
      OR public.is_household_planner(household_id, auth.uid())
    )
  );

-- 4. Funciones: nada para anon; las que aceptan un id ajeno, solo con el tuyo ---
-- Hay que quitar el EXECUTE de PUBLIC además del de anon: toda función nace
-- ejecutable por PUBLIC y varias de estas nunca lo perdieron (household_of,
-- is_household_member…). Revocar solo a anon o a authenticated no les quita el
-- que les llega por PUBLIC. Supabase concede además EXECUTE a anon y
-- authenticated por su nombre (ver 20260906140000_rate_limits_revoke_anon.sql).
REVOKE EXECUTE ON FUNCTION
  public.is_household_member(uuid, uuid),
  public.is_household_planner(uuid, uuid),
  public.household_of(uuid),
  public.household_planner_of(uuid),
  public.household_plan_context(uuid),
  public.household_member_list(),
  public.household_assign_oldest_planner(uuid),
  public.set_household_planner(uuid, uuid),
  public.household_open_slots(text),
  public.claim_household_slot(text, uuid),
  public.join_household(text),
  public.household_is_empty(uuid),
  public.household_members_single_planner(),
  public.household_members_planner_handoff(),
  public.households_guard_shared_slots()
FROM PUBLIC, anon;

-- Solo las llaman otras funciones SECURITY DEFINER o triggers (que se ejecutan
-- con los permisos del propietario), o nadie: join_household no tiene
-- llamadores desde el alta en dos pasos.
REVOKE EXECUTE ON FUNCTION
  public.household_of(uuid),
  public.household_assign_oldest_planner(uuid),
  public.join_household(text)
FROM authenticated;

-- Lo que sí necesita quien tiene sesión. Las cuatro primeras se evalúan DENTRO
-- de políticas, con los permisos de quien consulta: sin EXECUTE, la policy
-- falla y la tabla deja de verse.
GRANT EXECUTE ON FUNCTION
  public.is_household_member(uuid, uuid),
  public.is_household_planner(uuid, uuid),
  public.household_planner_of(uuid),
  public.household_is_empty(uuid),
  public.household_plan_context(uuid),
  public.household_member_list(),
  public.set_household_planner(uuid, uuid),
  public.household_open_slots(text),
  public.claim_household_slot(text, uuid)
TO authenticated;

-- Con el id de otra persona devolvían quién planifica en su casa y qué comidas
-- comparte. `auth.uid() IS NULL` es la clave de servicio. La policy
-- "read household planner monthly plan" la llama con auth.uid(): no cambia.
CREATE OR REPLACE FUNCTION public.household_planner_of(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id
  FROM public.household_members m
  JOIN public.household_members p ON p.household_id = m.household_id AND p.is_planner
  WHERE m.user_id = _user_id
    AND (_user_id = auth.uid() OR auth.uid() IS NULL)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.household_plan_context(_user_id uuid)
RETURNS TABLE (planner_id uuid, shared_slots jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.household_planner_of(_user_id), h.shared_slots
  FROM public.household_members m
  JOIN public.households h ON h.id = m.household_id
  WHERE m.user_id = _user_id
    AND (_user_id = auth.uid() OR auth.uid() IS NULL)
  LIMIT 1
$$;

-- 5. household_open_slots: con sesión y contando los códigos malos --------------
-- Era un oráculo de códigos de invitación sin límite (y sin sesión). Comparte
-- el contador de join_attempts con claim_household_slot.
CREATE OR REPLACE FUNCTION public.household_open_slots(_invite_code text)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  att public.join_attempts%ROWTYPE;
  target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  INSERT INTO public.join_attempts (user_id) VALUES (auth.uid())
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO att FROM public.join_attempts WHERE user_id = auth.uid() FOR UPDATE;
  IF att.window_start < now() - interval '1 hour' THEN
    UPDATE public.join_attempts SET attempts = 0, window_start = now()
      WHERE user_id = auth.uid() RETURNING * INTO att;
  END IF;
  IF att.attempts >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos, prueba más tarde';
  END IF;

  SELECT h.id INTO target FROM public.households h
    WHERE upper(h.invite_code) = upper(trim(_invite_code));
  IF target IS NULL THEN
    -- Sin RAISE: una excepción desharía también este +1 (NUEVO-07).
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, m.display_name
    FROM public.household_members m
    WHERE m.household_id = target AND m.user_id IS NULL AND m.uses_app
    ORDER BY m.created_at;
END;
$$;

-- 6. claim_household_slot: devuelve NULL en vez de lanzar, para que cuente el fallo
-- Antes sumaba el intento y justo después hacía RAISE EXCEPTION: Postgres
-- deshace la transacción entera, +1 incluido, y el límite de 10 intentos por
-- hora nunca contaba un fallo (NUEVO-07). Los clientes tratan el NULL como
-- "código no válido o sitio ocupado".
CREATE OR REPLACE FUNCTION public.claim_household_slot(_invite_code text, _member_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_household uuid;
  slot_household uuid;
  slot_user uuid;
  slot_uses_app boolean;
  att public.join_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  INSERT INTO public.join_attempts (user_id) VALUES (auth.uid())
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO att FROM public.join_attempts WHERE user_id = auth.uid() FOR UPDATE;
  IF att.window_start < now() - interval '1 hour' THEN
    UPDATE public.join_attempts SET attempts = 0, window_start = now()
      WHERE user_id = auth.uid() RETURNING * INTO att;
  END IF;
  IF att.attempts >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos, prueba más tarde';
  END IF;

  SELECT id INTO target_household FROM public.households
    WHERE upper(invite_code) = upper(trim(_invite_code));
  SELECT household_id, user_id, uses_app
    INTO slot_household, slot_user, slot_uses_app
    FROM public.household_members WHERE id = _member_id FOR UPDATE;

  IF target_household IS NULL
     OR slot_household IS DISTINCT FROM target_household
     OR slot_user IS NOT NULL
     OR NOT COALESCE(slot_uses_app, false) THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RETURN NULL;
  END IF;

  UPDATE public.join_attempts SET attempts = 0 WHERE user_id = auth.uid();
  -- Deja cualquier hogar anterior (dispara el traspaso de planificador allí).
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  UPDATE public.household_members SET user_id = auth.uid() WHERE id = _member_id;
  RETURN target_household;
END;
$$;

-- 7. Tablas internas: solo el servidor ------------------------------------------
-- dish_recipes y foods_extra las lee y escribe el servidor con la clave de
-- servicio (recipes.server.ts, usda.server.ts); ningún cliente las lee con su
-- sesión. La lectura abierta exponía el texto libre de los platos de todos.
REVOKE ALL ON public.join_attempts, public.rate_limits, public.dish_recipes, public.foods_extra
  FROM anon, authenticated;
DROP POLICY IF EXISTS "dish_recipes_read" ON public.dish_recipes;
DROP POLICY IF EXISTS "foods_extra_read" ON public.foods_extra;

-- 8. El rol anon y los privilegios que sobran, en todas las tablas ---------------
-- anon y authenticated tenían DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
-- TRUNCATE y UPDATE en todas las tablas (lo que concede Supabase por defecto);
-- la RLS era la única barrera, y TRUNCATE se la salta. La app nunca consulta
-- tablas sin sesión, y la cuenta demo anónima usa el rol `authenticated` (con
-- is_anonymous = true), no `anon`.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Que lo que se cree a partir de ahora no nazca abierto: tres migraciones han
-- tenido que revocar a mano lo que se concede por defecto. Lo de anon se
-- concede por esquema (Supabase) y se quita por esquema. El EXECUTE de PUBLIC es
-- un valor por defecto global: por esquema no se puede quitar, así que se quita
-- para todo lo que cree `postgres` (el SQL Editor). authenticated y service_role
-- conservan su EXECUTE por nombre en `public`; una función en otro esquema que
-- tenga que ejecutar alguien más necesitará su GRANT explícito.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
