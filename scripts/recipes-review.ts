/**
 * Revisión manual de las recetas canónicas (`dish_recipes`, ticket 06 de
 * `precision-nutricional`). Mientras no haya fuentes independientes (ticket 20),
 * esta revisión es la segunda opinión de las recetas más usadas.
 *
 * Lista las recetas con más `hits` que tengan calidad < 0,95 o algún flag de
 * `validateRecipe` (recortes, inventados, fuera de banda…), con sus
 * ingredientes en crudo y las kcal que dan, para revisarlas a mano. Objetivo:
 * las 100 más usadas revisadas en el primer mes.
 *
 * Solo lee, salvo con `--mark <dish_key>`, que marca esa receta como revisada:
 * una receta revisada no se vuelve a descomponer aunque cambie
 * `PIPELINE_VERSION`. Corregir una receta a mano es editar su fila en el panel de
 * Supabase y después marcarla.
 *
 * Uso:
 *   bun run recipes:review               # las 30 más usadas por revisar
 *   bun run recipes:review --limit 100
 *   bun run recipes:review --mark "arroz pollo"
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { macrosOfRecipe, type CanonicalIngredient } from "@/lib/nutrition/recipe";

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: { limit: { type: "string", default: "30" }, mark: { type: "string" } },
});

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (en .env).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

if (args.mark) {
  const { data, error } = await db
    .from("dish_recipes")
    .update({ reviewed: true, updated_at: new Date().toISOString() })
    .eq("dish_key", args.mark)
    .select("dish_key");
  if (error) throw error;
  console.log(data?.length ? `✓ ${args.mark} marcada como revisada` : `No existe «${args.mark}».`);
  process.exit(0);
}

const { data, error } = await db
  .from("dish_recipes")
  .select("dish_key, dish_label, ingredients, methods, serving_kind, quality, flags, hits")
  .eq("reviewed", false)
  .or("quality.lt.0.95,flags.neq.{}")
  .order("hits", { ascending: false })
  .limit(Math.max(1, Number(args.limit) || 30));
if (error) {
  console.error(
    error.code === "PGRST205" ? "La tabla dish_recipes no existe: aplica la migración." : error,
  );
  process.exit(1);
}

for (const row of data ?? []) {
  const ingredients = row.ingredients as CanonicalIngredient[];
  const m = macrosOfRecipe({ ingredients });
  console.log(
    `\n## ${row.dish_label}  ·  ${row.hits} usos  ·  calidad ${Number(row.quality).toFixed(2)}  ·  ` +
      `${(row.methods ?? []).join(" + ") || "sin método"}${row.serving_kind === "unidad" ? " · por pieza" : ""}`,
  );
  if (row.flags?.length) console.log(`   flags: ${row.flags.join(", ")}`);
  for (const ing of ingredients) {
    const how = ing.fallback ? ` (${ing.fallback})` : ing.confidence === "low" ? " (flojo)" : "";
    console.log(`   - ${ing.name}: ${ing.gramsRaw} g ${ing.state} → ${ing.foodKey}${how}`);
  }
  console.log(
    `   = ${m.kcal} kcal · P ${m.protein_g} · H ${m.carbs_g} · G ${m.fat_g}  (clave: ${row.dish_key})`,
  );
}
if (!data?.length) console.log("Nada por revisar.");
