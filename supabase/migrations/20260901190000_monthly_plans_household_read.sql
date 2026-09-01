-- Familia — issue 05: un miembro del hogar necesita LEER la fila
-- `monthly_plans` del planificador para componer su menú (las comidas
-- compartidas salen de ahí). Sin esto, `household_plan_context` seguiría
-- devolviendo quién planifica, pero el cliente no podría leer su plan.
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

-- 1. Helper: user_id del planificador del hogar de _user_id (o NULL) --------
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
REVOKE ALL ON FUNCTION public.household_planner_of(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.household_planner_of(uuid) TO authenticated;

-- 2. Combo para el cliente: quién planifica + qué comidas se comparten, en una
-- sola consulta (evita encadenar 2-3 idas y vueltas antes de saber si hace
-- falta leer la fila del planificador).
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
REVOKE ALL ON FUNCTION public.household_plan_context(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.household_plan_context(uuid) TO authenticated;

-- 3. RLS: un miembro del hogar puede LEER (no escribir) la fila del
-- planificador. Se suma a "own monthly plans" (FOR ALL): varias policies
-- permisivas del mismo comando se combinan con OR, así que esto no afloja el
-- resto de operaciones (insert/update/delete siguen siendo estrictamente
-- propias).
DROP POLICY IF EXISTS "read household planner monthly plan" ON public.monthly_plans;
CREATE POLICY "read household planner monthly plan" ON public.monthly_plans FOR SELECT TO authenticated
  USING (user_id = public.household_planner_of(auth.uid()));
