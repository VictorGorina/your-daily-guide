-- Deshace supabase/migrations/20260926120000_household_permissions.sql.
-- Aplicar a mano en el SQL Editor. Los clientes funcionan con los dos estados.
--
-- Devuelve todo lo que la app usa: UPDATE de tabla completa, la policy
-- "join household", los cuerpos anteriores de las cuatro funciones y la lectura
-- de dish_recipes/foods_extra. NO vuelve a abrir lo que nadie usa y era un
-- agujero (tablas y funciones para anon, TRUNCATE, EXECUTE por PUBLIC): eso está
-- comentado al final, por si algo de fuera de la app resultara depender de ello.
-- Por eso, después de deshacer, supabase/tests/household_rls.sql marca con ✗
-- A09, P01-P04, P08, P12 y P14: son esos privilegios, que se quedan cerrados.

BEGIN;

-- 1-2. UPDATE de tabla completa (el REVOKE de tabla quita también los de columna)
REVOKE UPDATE ON public.household_members, public.households FROM authenticated;
GRANT UPDATE ON public.household_members, public.households TO authenticated;

DROP TRIGGER IF EXISTS households_guard_shared_slots ON public.households;
DROP FUNCTION IF EXISTS public.households_guard_shared_slots();

-- 3. Altas como estaban (20260813154831 y 20260907120000)
DROP POLICY IF EXISTS "creator seeds own household" ON public.household_members;
DROP POLICY IF EXISTS "join household" ON public.household_members;
CREATE POLICY "join household" ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "creator or planner inserts household slots" ON public.household_members;
CREATE POLICY "creator or planner inserts household slots"
  ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
      OR public.is_household_planner(household_id, auth.uid())
    )
  );

DROP FUNCTION IF EXISTS public.household_is_empty(uuid);

-- 4. Funciones: EXECUTE para authenticated y cuerpos de 20260901190000 --------
GRANT EXECUTE ON FUNCTION
  public.household_of(uuid),
  public.household_assign_oldest_planner(uuid),
  public.join_household(text)
TO authenticated;

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
  LIMIT 1
$$;

-- 5-6. Cuerpos de 20260901160000 --------------------------------------------------
CREATE OR REPLACE FUNCTION public.household_open_slots(_invite_code text)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.display_name
  FROM public.household_members m
  JOIN public.households h ON h.id = m.household_id
  WHERE upper(h.invite_code) = upper(trim(_invite_code))
    AND m.user_id IS NULL
    AND m.uses_app
  ORDER BY m.created_at;
$$;

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

  -- Rate-limit compartido con join_household (H-02).
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
  IF target_household IS NULL THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Código no válido';
  END IF;

  SELECT household_id, user_id, uses_app
    INTO slot_household, slot_user, slot_uses_app
    FROM public.household_members WHERE id = _member_id FOR UPDATE;

  IF slot_household IS DISTINCT FROM target_household
     OR slot_user IS NOT NULL
     OR NOT COALESCE(slot_uses_app, false) THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Ese sitio ya no está disponible';
  END IF;

  UPDATE public.join_attempts SET attempts = 0 WHERE user_id = auth.uid();
  -- Deja cualquier hogar anterior (dispara el traspaso de planificador allí).
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  UPDATE public.household_members SET user_id = auth.uid() WHERE id = _member_id;
  RETURN target_household;
END;
$$;

-- 7. Lectura de dish_recipes y foods_extra (20260925140000, 20260925150000) ------
GRANT SELECT ON public.dish_recipes, public.foods_extra TO authenticated;
DROP POLICY IF EXISTS "dish_recipes_read" ON public.dish_recipes;
CREATE POLICY "dish_recipes_read" ON public.dish_recipes
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "foods_extra_read" ON public.foods_extra;
CREATE POLICY "foods_extra_read" ON public.foods_extra
  FOR SELECT TO authenticated USING (true);

COMMIT;

-- 8. Solo si algo de fuera de la app dependía de anon, TRUNCATE o PUBLIC ---------
-- (reabre agujeros; no forma parte del deshacer normal)
--
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
-- REVOKE ALL ON public.ai_spend FROM anon;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
-- GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO authenticated;
-- REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.ai_spend FROM authenticated;
-- GRANT EXECUTE ON FUNCTION
--   public.is_household_member(uuid, uuid), public.is_household_planner(uuid, uuid),
--   public.household_of(uuid), public.household_planner_of(uuid),
--   public.household_plan_context(uuid), public.household_member_list(),
--   public.household_assign_oldest_planner(uuid), public.set_household_planner(uuid, uuid),
--   public.household_open_slots(text), public.claim_household_slot(text, uuid),
--   public.join_household(text)
-- TO anon;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLES TO authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
