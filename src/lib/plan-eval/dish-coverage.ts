/**
 * Banco de pruebas — cobertura de la tabla de composición.
 *
 * Descompone ~50 platos representativos con el modelo (`decomposeDishes`) y los
 * suma contra la tabla (`src/lib/nutrition/`), y mide:
 *
 * - % de platos que se descomponen (source: "model" con ingredientes)
 * - calidad media (proporción de gramos identificados con confianza alta)
 * - platos con kcal/ración fuera de su rango razonable
 * - ingredientes que cayeron en GENERIC_FOOD → candidatos a entrar en la tabla
 * - alias sospechosos: una `key` a la que caen nombres de ingrediente muy
 *   distintos entre sí (candidato a partirse en varias filas, como pasó con
 *   "chorizo" absorbiendo "salchicha"/"morcilla"/"butifarra" — resolvía con
 *   confianza alta y kcal plausible, así que ni la calidad ni el rango lo
 *   habrían pillado; solo la diversidad de nombres reales lo delata)
 *
 * No es un test unitario: gasta llamadas al modelo. Se corre a mano:
 *
 *     bun run eval:dishes
 *
 * Necesita `OPENROUTER_API_KEY` en el entorno (lee `.env`).
 */

import { writeFileSync } from "node:fs";

import { GENERIC_FOOD } from "@/lib/nutrition";
import {
  decomposeDishes,
  _clearDishMemo,
  type DishBreakdown,
} from "@/lib/nutrition/resolve-dish.server";

import { EVAL_DISHES } from "./dishes.data";

const PER_SLOT_SERVINGS = 1;

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Falta OPENROUTER_API_KEY en el entorno.");
    process.exit(1);
  }
  _clearDishMemo();

  const dishes = EVAL_DISHES.map((d) => d.dish);
  console.log(`Descomponiendo ${dishes.length} platos (lotes de 8)…\n`);

  const breakdowns = new Map<string, DishBreakdown>();
  for (let i = 0; i < dishes.length; i += 8) {
    const batch = dishes.slice(i, i + 8);
    // Sin persona detrás: el gasto del eval no cuenta contra ningún tope.
    const map = await decomposeDishes(batch, { servings: PER_SLOT_SERVINGS, userId: null });
    for (const [k, v] of map) breakdowns.set(k, v);
    process.stdout.write(`  ${Math.min(i + 8, dishes.length)}/${dishes.length}\r`);
  }
  console.log("\n");

  let resolved = 0;
  let qualitySum = 0;
  const kcalOut: string[] = [];
  const lowQuality: string[] = [];
  const genericIngredients = new Map<string, number>();
  // Nombre normalizado de ingrediente → key de la tabla a la que casó, sin
  // duplicados, para detectar una key que absorbe demasiada variedad real.
  const namesByKey = new Map<string, Set<string>>();

  for (const spec of EVAL_DISHES) {
    const b = breakdowns.get(spec.dish);
    if (!b || b.source !== "model" || !b.ingredients.length) {
      lowQuality.push(`  ✗ SIN DESCOMPONER  ${spec.dish}`);
      continue;
    }
    resolved += 1;
    qualitySum += b.quality;

    const kcal = b.perServing.kcal;
    if (kcal < spec.kcalMin || kcal > spec.kcalMax) {
      kcalOut.push(`  ⚠ ${kcal} kcal (esperado ${spec.kcalMin}-${spec.kcalMax})  ${spec.dish}`);
    }
    if (b.quality < 0.7) {
      lowQuality.push(`  ~ calidad ${(b.quality * 100).toFixed(0)}%  ${spec.dish}`);
    }
    for (const ing of b.ingredients) {
      if (ing.food === GENERIC_FOOD) {
        genericIngredients.set(ing.name, (genericIngredients.get(ing.name) ?? 0) + 1);
      }
      const names = namesByKey.get(ing.food.key) ?? new Set<string>();
      names.add(ing.name.trim().toLowerCase());
      namesByKey.set(ing.food.key, names);
    }
  }

  const total = EVAL_DISHES.length;
  console.log("═".repeat(60));
  console.log(
    `Platos descompuestos:  ${resolved}/${total}  (${((resolved / total) * 100).toFixed(0)}%)`,
  );
  console.log(`Calidad media:         ${((qualitySum / Math.max(1, resolved)) * 100).toFixed(0)}%`);
  console.log(`kcal fuera de rango:   ${kcalOut.length}/${total}`);
  console.log("═".repeat(60));

  if (kcalOut.length) {
    console.log("\nkcal/ración fuera del rango razonable:");
    kcalOut.forEach((l) => console.log(l));
  }
  if (lowQuality.length) {
    console.log("\nPlatos flojos (sin descomponer o <70% identificado):");
    lowQuality.forEach((l) => console.log(l));
  }
  if (genericIngredients.size) {
    console.log("\nIngredientes sin identificar (candidatos a la tabla):");
    [...genericIngredients.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, n]) => console.log(`  ${n}×  ${name}`));
  }

  // Una key con muchos nombres de ingrediente distintos detrás es candidata a
  // partirse en varias filas: revisar a mano si de verdad comparten macros
  // (no lo decide el script — solo señala dónde mirar).
  const broadAliasKeys = [...namesByKey.entries()]
    .filter(([, names]) => names.size >= 3)
    .sort((a, b) => b[1].size - a[1].size);
  if (broadAliasKeys.length) {
    console.log("\nKeys con más variedad de nombres detrás (revisar si de verdad son lo mismo):");
    broadAliasKeys.forEach(([key, names]) => console.log(`  ${key} ← ${[...names].join(", ")}`));
  }
  console.log("");

  const summary = {
    ranAt: new Date().toISOString(),
    dishes: total,
    resolved,
    resolvedPct: Math.round((resolved / total) * 100),
    meanQualityPct: Math.round((qualitySum / Math.max(1, resolved)) * 100),
    kcalOutOfRange: kcalOut.length,
    unidentifiedIngredients: Object.fromEntries(genericIngredients),
    broadAliasKeys: Object.fromEntries(broadAliasKeys.map(([key, names]) => [key, [...names]])),
  };
  writeFileSync(
    new URL("./baseline.json", import.meta.url),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log("→ baseline.json actualizado\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
