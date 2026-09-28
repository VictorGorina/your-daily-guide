-- Borrar la cuenta de quien creó el hogar borraba el hogar de todos (ticket 36
-- de la auditoría, SEC-DB-08).
--
-- `households.created_by … ON DELETE CASCADE`: si quien lo creó borraba su
-- cuenta, desaparecían el hogar, los huecos, los niños y la configuración para
-- todo el mundo, en contra de D3 (el hogar sigue con el planificador que
-- herede, trigger `household_members_planner_handoff`). Ahora:
--
--   1. `created_by` pasa a `ON DELETE SET NULL` (y deja de ser NOT NULL).
--   2. Sin creador, borra el hogar quien planifica.
--   3. Un hogar sin ninguna persona con cuenta ya no lo ve nadie: al irse la
--      última (o borrar su cuenta, que borra su fila por CASCADE) se borra.
--
-- Deshacer: supabase/rollbacks/20260928130000_households_creator_set_null.sql.

BEGIN;

ALTER TABLE public.households ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.households DROP CONSTRAINT households_created_by_fkey;
ALTER TABLE public.households ADD CONSTRAINT households_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "delete own household" ON public.households;
CREATE POLICY "delete own household" ON public.households FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_household_planner(id, auth.uid()));

CREATE OR REPLACE FUNCTION public.households_gc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = OLD.household_id AND user_id IS NOT NULL
  ) THEN
    DELETE FROM public.households WHERE id = OLD.household_id;
  END IF;
  RETURN OLD;
END;
$$;

-- Solo la usa el trigger: nadie la llama por RPC.
REVOKE ALL ON FUNCTION public.households_gc() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS households_gc ON public.household_members;
CREATE TRIGGER households_gc
  AFTER DELETE ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.households_gc();

COMMIT;
