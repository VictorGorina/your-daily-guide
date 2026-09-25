-- Recetas canónicas de los platos, UNA vez para toda la app (ticket 06 de
-- `precision-nutricional`).
--
-- Cada fila es la receta validada de un plato (ticket 05): una ración base de
-- AESAN en gramos CRUDOS, con su método de cocción y su tipo de ración. Es lo
-- que garantiza "mismo plato → mismas cifras" (antes el modelo lo descomponía
-- otra vez cada día y para cada persona, con cifras distintas) y lo que hace
-- asequible el pipeline: un plato se paga una vez, no una vez por persona y día.
--
-- Las macros NO se guardan: se calculan al leer contra la tabla de composición
-- (`macrosOfRecipe`). Si se corrige el valor de un alimento, se corrigen todos
-- los platos sin migrar nada.
--
-- Global y de solo lectura para las personas: nadie escribe con su sesión, solo
-- el servidor con la clave de servicio (invariante 5). Una receta no lleva datos
-- de nadie: la clave es el nombre del plato normalizado (`dishKey`).

CREATE TABLE IF NOT EXISTS public.dish_recipes (
  dish_key          text PRIMARY KEY,
  dish_label        text NOT NULL,
  -- [{foodKey, name, gramsRaw, state, confidence, fallback?}]
  ingredients       jsonb NOT NULL,
  -- Métodos de cocción (enum de `cooking.ts`): deciden la grasa de cocinar.
  methods           text[] NOT NULL DEFAULT '{}',
  -- 'plato' | 'unidad' (ticket 17: una pizza pesa lo que pesa).
  serving_kind      text NOT NULL DEFAULT 'plato',
  unit_label        text,
  -- Cuánto dice el TEXTO respecto a una ración ("media pizza" = 0,5). Va con la
  -- clave, que es el texto: "media pizza" y "pizza" son dos filas.
  text_quantity     numeric,
  -- 0-1, parte de las kcal que sale de ingredientes identificados.
  quality           numeric NOT NULL,
  -- Reservado para el ticket 20 (fuentes independientes): null con una lectura.
  agreement         numeric,
  judged            boolean NOT NULL DEFAULT false,
  sources           text[] NOT NULL DEFAULT '{}',
  -- Flags de `validateRecipe` (recortes, inventados, fuera de banda…).
  flags             text[] NOT NULL DEFAULT '{}',
  pipeline_version  int NOT NULL,
  foods_version     text NOT NULL,
  -- Revisada a mano (`bun run recipes:review`): no se vuelve a descomponer
  -- aunque cambie `PIPELINE_VERSION`.
  reviewed          boolean NOT NULL DEFAULT false,
  -- Veces que se ha usado: prioriza la revisión manual.
  hits              int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dish_recipes_serving_kind_check CHECK (serving_kind IN ('plato', 'unidad'))
);

ALTER TABLE public.dish_recipes ENABLE ROW LEVEL SECURITY;

-- Leer, cualquiera con sesión. Sin políticas de INSERT/UPDATE/DELETE: con RLS
-- activada, la clave publishable no puede escribir; solo el servidor, con la
-- clave de servicio.
DROP POLICY IF EXISTS "dish_recipes_read" ON public.dish_recipes;
CREATE POLICY "dish_recipes_read" ON public.dish_recipes
  FOR SELECT TO authenticated USING (true);

-- Para `recipes:review`: las más usadas primero.
CREATE INDEX IF NOT EXISTS dish_recipes_hits_idx ON public.dish_recipes (hits DESC);

-- Suma un uso a cada receta. SECURITY DEFINER para no tener que dar permiso de
-- UPDATE sobre la tabla; solo toca `hits`. La llama el servidor sin esperar la
-- respuesta: si falla, no pasa nada.
CREATE OR REPLACE FUNCTION public.increment_dish_recipe_hits(_keys text[])
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.dish_recipes SET hits = hits + 1 WHERE dish_key = ANY (_keys);
$$;

-- `FROM PUBLIC` no basta: Supabase da EXECUTE a anon y authenticated por su
-- nombre (ver `20260906140000_rate_limits_revoke_anon.sql`).
REVOKE ALL ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) TO service_role;
