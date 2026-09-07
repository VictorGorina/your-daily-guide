-- Familia — issue 02: quien planifica también gestiona la mesa, no solo quien
-- creó el hogar.
--
-- Hasta ahora INSERT/UPDATE/DELETE en household_members solo los dejaba pasar
-- la policy si `households.created_by = auth.uid()`. En una casa donde el
-- planificador es otra persona (el creador cedió el rol, o directamente no
-- planifica), esa persona no podía añadir ni quitar a nadie de la mesa: el
-- formulario de la UI está oculto detrás de `isCreator` porque la base de
-- datos ya lo rechazaba. Aquí se amplía la policy a "creador O planificador
-- de ESE hogar", y la UI se alinea en el mismo cambio (hogar.tsx).
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

-- Helper sin recursión de RLS, igual que is_household_member: una policy sobre
-- household_members no puede subconsultar la misma tabla directamente sin
-- entrar en un ciclo de RLS.
CREATE OR REPLACE FUNCTION public.is_household_planner(_household_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = _household_id AND user_id = _user_id AND is_planner
  )
$$;

DROP POLICY IF EXISTS "creator inserts household slots" ON public.household_members;
CREATE POLICY "creator or planner inserts household slots"
  ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
      OR public.is_household_planner(household_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "creator updates household slots" ON public.household_members;
CREATE POLICY "creator or planner updates household slots"
  ON public.household_members FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
    OR public.is_household_planner(household_id, auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
    OR public.is_household_planner(household_id, auth.uid())
  );

DROP POLICY IF EXISTS "creator removes household slots" ON public.household_members;
CREATE POLICY "creator or planner removes household slots"
  ON public.household_members FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
    OR public.is_household_planner(household_id, auth.uid())
  );
