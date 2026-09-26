-- Comprobación de 20260926200000_dish_recipe_hits_by.sql (ticket 22).
-- Se pega en el SQL Editor; todo va dentro de una transacción que se deshace.
-- Cada fila del resultado debe decir ✓.

BEGIN;

INSERT INTO public.dish_recipes (dish_key, dish_label, ingredients, quality, pipeline_version, foods_version)
VALUES ('__test_hits__', 'Prueba', '[]'::jsonb, 1, 0, 'test');

SELECT public.increment_dish_recipe_hits(ARRAY['__test_hits__']);      -- como el código anterior
SELECT public.increment_dish_recipe_hits(ARRAY['__test_hits__'], 10);  -- muestreo
SELECT public.increment_dish_recipe_hits(ARRAY['__test_hits__'], 5000); -- se recorta a 100

SELECT CASE WHEN hits = 111 THEN '✓' ELSE '✗' END || ' H01 suma 1 + 10 + 100 (hits=' || hits || ')'
FROM public.dish_recipes WHERE dish_key = '__test_hits__'
UNION ALL
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.increment_dish_recipe_hits(text[], int)', 'EXECUTE')
  THEN '✓' ELSE '✗' END || ' H02 anon no la ejecuta'
UNION ALL
SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.increment_dish_recipe_hits(text[], int)', 'EXECUTE')
  THEN '✓' ELSE '✗' END || ' H03 authenticated no la ejecuta'
UNION ALL
SELECT CASE WHEN has_function_privilege('service_role', 'public.increment_dish_recipe_hits(text[], int)', 'EXECUTE')
  THEN '✓' ELSE '✗' END || ' H04 service_role sí'
UNION ALL
SELECT CASE WHEN to_regprocedure('public.increment_dish_recipe_hits(text[])') IS NULL
  THEN '✓' ELSE '✗' END || ' H05 no queda la firma antigua (ambigua con el DEFAULT)';

ROLLBACK;
