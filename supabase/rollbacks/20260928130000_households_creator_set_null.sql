-- Deshace supabase/migrations/20260928130000_households_creator_set_null.sql.
-- Aplicar a mano en el SQL Editor.
--
-- `created_by` NO vuelve a ser NOT NULL: si algún creador ya borró su cuenta,
-- su hogar tiene `created_by` nulo y la restricción fallaría. Para eso habría
-- que borrar esos hogares (y sus huecos y niños), que es justo el fallo que la
-- migración arregla: se deja nulable a propósito.

BEGIN;

DROP TRIGGER IF EXISTS households_gc ON public.household_members;
DROP FUNCTION IF EXISTS public.households_gc();

DROP POLICY IF EXISTS "delete own household" ON public.households;
CREATE POLICY "delete own household" ON public.households FOR DELETE TO authenticated
  USING (created_by = auth.uid());

ALTER TABLE public.households DROP CONSTRAINT households_created_by_fkey;
ALTER TABLE public.households ADD CONSTRAINT households_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;
