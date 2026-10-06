-- `increment_dish_recipe_hits` (20260926200000_dish_recipe_hits_by.sql,
-- ticket 22): suma con muestreo, recorta a 100 y solo la ejecuta el servidor.
-- Test de pgTAP; lo lanza `supabase test db` (docs/agents/testing.md).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

INSERT INTO public.dish_recipes (dish_key, dish_label, ingredients, quality, pipeline_version, foods_version)
VALUES ('__test_hits__', 'Prueba', '[]'::jsonb, 1, 0, 'test');

SELECT public.increment_dish_recipe_hits(ARRAY['__test_hits__']);       -- como el código anterior
SELECT public.increment_dish_recipe_hits(ARRAY['__test_hits__'], 10);   -- muestreo
SELECT public.increment_dish_recipe_hits(ARRAY['__test_hits__'], 5000); -- se recorta a 100

SELECT is(
  (SELECT hits::int FROM public.dish_recipes WHERE dish_key = '__test_hits__'),
  111,
  'H01 suma 1 + 10 + 100'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.increment_dish_recipe_hits(text[], int)', 'EXECUTE'),
  'H02 anon no la ejecuta'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.increment_dish_recipe_hits(text[], int)', 'EXECUTE'),
  'H03 authenticated no la ejecuta'
);
SELECT ok(
  has_function_privilege('service_role', 'public.increment_dish_recipe_hits(text[], int)', 'EXECUTE'),
  'H04 service_role sí'
);
SELECT ok(
  to_regprocedure('public.increment_dish_recipe_hits(text[])') IS NULL,
  'H05 no queda la firma antigua (ambigua con el DEFAULT)'
);

SELECT * FROM finish();
ROLLBACK;
