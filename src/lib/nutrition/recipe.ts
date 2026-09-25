/**
 * Receta canónica de un plato (tickets 05 y 06 de `precision-nutricional`):
 * UNA ración base (AESAN, punto medio) en gramos CRUDOS (D8), con su método de
 * cocción y su tipo de ración, ya validada en código (`validate-recipe.ts`).
 *
 * Es lo que se guarda (una vez para toda la app, `dish_recipes`) y lo que se
 * vuelve a sumar al leer: las macros NUNCA se guardan (invariante 4). Si se
 * corrige una fila de la tabla, se corrigen todos los platos sin migrar nada.
 *
 * Puro: sin I/O ni modelo.
 */

import type { CookingMethod } from "./cooking";
import { FOODS } from "./foods.data";
import {
  foodByKey,
  gramsInRowBasis,
  macrosOf,
  priceOf,
  ZERO,
  type IngredientState,
  type Macros,
  type ResolvedIngredient,
} from "./nutrition";

/**
 * Versión del pipeline que produce la receta. Una receta guardada con una
 * versión anterior y sin revisar a mano se vuelve a descomponer (ticket 06).
 * 2 = receta canónica en crudo, salida estructurada y `validateRecipe` (05).
 */
export const PIPELINE_VERSION = 2;

/** Huella de la tabla de composición: cambia con cualquier fila. Solo informativa. */
export const FOODS_VERSION: string = (() => {
  let hash = 5381;
  const text = JSON.stringify(FOODS);
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
})();

export type ServingKind = "plato" | "unidad";

export type CanonicalIngredient = {
  foodKey: string;
  name: string;
  /** Gramos tal como se pesan (`state`): en crudo, o tal cual si es un producto hecho. */
  gramsRaw: number;
  state: IngredientState;
  confidence: "high" | "low";
  fallback?: ResolvedIngredient["fallback"];
};

export type CanonicalRecipe = {
  dishKey: string;
  dishLabel: string;
  ingredients: CanonicalIngredient[];
  methods: CookingMethod[];
  servingKind: ServingKind;
  /** "pizza individual", "bocadillo". */
  unitLabel?: string | null;
  /** 0-1, ponderada por kcal (`resolutionQuality`). */
  quality: number;
  flags: string[];
  pipelineVersion: number;
  foodsVersion: string;
};

/** De los ingredientes resueltos del pipeline a la forma que se guarda. */
export function canonicalIngredients(
  ingredients: readonly ResolvedIngredient[],
): CanonicalIngredient[] {
  return ingredients.map((ing) => ({
    foodKey: ing.food.key,
    name: ing.name,
    gramsRaw: ing.gramsRaw ?? ing.grams,
    state: ing.state ?? "listo",
    confidence: ing.confidence,
    ...(ing.fallback ? { fallback: ing.fallback } : {}),
  }));
}

/**
 * De una receta guardada a ingredientes que se pueden sumar, escalados por
 * `factor` (la ración personal, ticket 21). `null` si alguna fila ya no existe
 * (una fila de USDA que no se ha cargado): la receta no se usa a medias.
 */
export function resolvedFromRecipe(
  recipe: Pick<CanonicalRecipe, "ingredients">,
  factor = 1,
): ResolvedIngredient[] | null {
  const out: ResolvedIngredient[] = [];
  for (const ing of recipe.ingredients) {
    const food = foodByKey(ing.foodKey);
    if (!food) return null;
    const gramsRaw = ing.gramsRaw * factor;
    out.push({
      name: ing.name,
      grams: gramsInRowBasis(gramsRaw, food, ing.state),
      gramsRaw,
      state: ing.state,
      food,
      confidence: ing.confidence,
      ...(ing.fallback ? { fallback: ing.fallback } : {}),
    });
  }
  return out;
}

/** Macros de la receta × `factor`. `ZERO` si no se puede resolver. */
export function macrosOfRecipe(recipe: Pick<CanonicalRecipe, "ingredients">, factor = 1): Macros {
  const resolved = resolvedFromRecipe(recipe, factor);
  return resolved ? macrosOf(resolved) : { ...ZERO };
}

/** Precio orientativo (€) de la receta × `factor`. */
export function priceOfRecipe(recipe: Pick<CanonicalRecipe, "ingredients">, factor = 1): number {
  const resolved = resolvedFromRecipe(recipe, factor);
  return resolved ? priceOf(resolved) : 0;
}
