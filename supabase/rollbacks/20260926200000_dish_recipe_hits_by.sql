-- Deshace supabase/migrations/20260926200000_dish_recipe_hits_by.sql.
-- Aplicar a mano en el SQL Editor. Con el código del ticket 22 desplegado, las
-- llamadas con `_by` fallarán (`recipe_hits_failed` en el log, sin más efecto):
-- revertir antes el commit del contador o aceptar que no se cuenten usos.

BEGIN;

DROP FUNCTION IF EXISTS public.increment_dish_recipe_hits(text[], int);

CREATE FUNCTION public.increment_dish_recipe_hits(_keys text[])
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.dish_recipes SET hits = hits + 1 WHERE dish_key = ANY (_keys);
$$;

REVOKE ALL ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) TO service_role;

COMMIT;
