-- Alimentos traídos de USDA FoodData Central para los ingredientes que la tabla
-- de composición no tiene (ticket 22 de `precision-nutricional`, D13: un
-- ingrediente que pesa en kcal nunca cae en un genérico).
--
-- Cuando un ingrediente sin fila aporta ≥ 5 % de las kcal de un plato, se busca
-- en USDA (tipos Foundation y SR Legacy: genéricos, no marcas), se guarda aquí
-- UNA vez para toda la app y a partir de ahí es una fila más de la tabla
-- (`registerExtraFoods`). Por 100 g, con su fuente trazable (`source_id` = fdcId).
--
-- Global, sin datos de nadie. Solo lee quien tiene sesión y solo escribe el
-- servidor con la clave de servicio, igual que `dish_recipes`.

CREATE TABLE IF NOT EXISTS public.foods_extra (
  -- "usda-<fdcId>": el mismo alimento de USDA no se guarda dos veces.
  key          text PRIMARY KEY,
  -- Nombre en español con el que llegó (el del plato).
  label        text NOT NULL,
  aliases      text[] NOT NULL DEFAULT '{}',
  category     text NOT NULL,
  kcal         numeric NOT NULL,
  protein_g    numeric NOT NULL,
  carbs_g      numeric NOT NULL,
  fat_g        numeric NOT NULL,
  fiber_g      numeric NOT NULL DEFAULT 0,
  source       text NOT NULL DEFAULT 'usda',
  source_id    text NOT NULL,
  -- Descripción de USDA, para revisar a mano (`bun run foods:review`).
  source_label text,
  reviewed     boolean NOT NULL DEFAULT false,
  hits         int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.foods_extra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "foods_extra_read" ON public.foods_extra;
CREATE POLICY "foods_extra_read" ON public.foods_extra
  FOR SELECT TO authenticated USING (true);
