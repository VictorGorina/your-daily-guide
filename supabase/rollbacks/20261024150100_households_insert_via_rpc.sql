-- Deshace supabase/pending/20261024150100_households_insert_via_rpc.sql (si se
-- llegó a aplicar). Aplicar a mano (`supabase db query --linked -f …`) y después
-- `supabase migration repair --status reverted 20261024150100`.
--
-- Devuelve el alta directa de antes: el privilegio y las dos policies, tal como
-- quedaron en 20260813154831 y 20260926120000_household_permissions.sql.

GRANT INSERT ON public.households TO authenticated;

DROP POLICY IF EXISTS "create household" ON public.households;
CREATE POLICY "create household" ON public.households FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "creator seeds own household" ON public.household_members;
CREATE POLICY "creator seeds own household" ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.households h
                WHERE h.id = household_id AND h.created_by = auth.uid())
    AND public.household_is_empty(household_id)
  );
