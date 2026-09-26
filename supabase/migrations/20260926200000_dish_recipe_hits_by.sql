-- Contador de usos de recetas por muestreo (ticket 22 de la auditoría, PERF-13).
--
-- `getRecipes` sumaba un uso en CADA lectura de la caché: una escritura por
-- petición sobre las filas más leídas de la app. Ahora llama con probabilidad
-- 1/10 y suma 10. El recuento queda aproximado, que es para lo que se usa
-- (qué platos revisar primero).
--
-- `_by` con DEFAULT 1: el código anterior (solo `_keys`) sigue funcionando, así
-- que esta migración se puede aplicar ANTES de desplegar el código nuevo.
-- CREATE OR REPLACE no puede cambiar la firma: hay que borrar la anterior.

BEGIN;

DROP FUNCTION IF EXISTS public.increment_dish_recipe_hits(text[]);

CREATE FUNCTION public.increment_dish_recipe_hits(_keys text[], _by int DEFAULT 1)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.dish_recipes
  SET hits = hits + GREATEST(1, LEAST(_by, 100))
  WHERE dish_key = ANY (_keys);
$$;

-- `FROM PUBLIC` no basta: Supabase da EXECUTE a anon y authenticated por su
-- nombre (ver `20260906140000_rate_limits_revoke_anon.sql`).
REVOKE ALL ON FUNCTION public.increment_dish_recipe_hits(text[], int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[], int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[], int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[], int) TO service_role;

COMMIT;
