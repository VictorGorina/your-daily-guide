-- Familia — issue 03: las comidas compartidas dejan de ser "la intersección de lo
-- que marca cada miembro" y pasan a ser UNA configuración del hogar, propiedad
-- del planificador. Esos días, el mismo plato para todos.
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

-- 1. Columna nueva a nivel de hogar ---------------------------------------------
-- Días 0=lunes … 6=domingo. Por defecto se comparten comida y cena toda la
-- semana; el desayuno se activa a mano (mucha gente desayuna por su cuenta).
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS shared_slots jsonb NOT NULL
  DEFAULT '{"desayuno": [], "comida": [0,1,2,3,4,5,6], "cena": [0,1,2,3,4,5,6]}'::jsonb;

-- 2. Backfill: la config del hogar = la del planificador (o la del creador) -----
-- Se lee el shared_meals del miembro antes de borrar la columna en el paso 4.
UPDATE public.households h
  SET shared_slots = COALESCE(m.shared_meals, h.shared_slots)
  FROM public.household_members m
  WHERE m.household_id = h.id
    AND m.is_planner;

-- Hogares sin planificador marcado (datos raros): cae en el miembro del creador.
UPDATE public.households h
  SET shared_slots = COALESCE(m.shared_meals, h.shared_slots)
  FROM public.household_members m
  WHERE m.household_id = h.id
    AND m.user_id = h.created_by
    AND NOT EXISTS (
      SELECT 1 FROM public.household_members p
      WHERE p.household_id = h.id AND p.is_planner
    );

-- 3. household_member_list() sin shared_meals ----------------------------------
DROP FUNCTION IF EXISTS public.household_member_list();
CREATE FUNCTION public.household_member_list()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  role text,
  uses_app boolean,
  is_planner boolean,
  portion numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.user_id, m.display_name, m.role,
         m.uses_app, m.is_planner, m.portion
  FROM public.household_members m
  WHERE m.household_id = public.household_of(auth.uid())
    AND public.household_of(auth.uid()) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.household_member_list() FROM public;
GRANT EXECUTE ON FUNCTION public.household_member_list() TO authenticated;

-- 4. Fuera la columna por miembro --------------------------------------------
ALTER TABLE public.household_members DROP COLUMN IF EXISTS shared_meals;
