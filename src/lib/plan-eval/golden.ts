/**
 * Recetas de referencia del eval de exactitud (`precision-nutricional`, ticket
 * 02) y su paso a la base de la tabla de composición vigente.
 *
 * Una receta de referencia apunta lo que se PESÓ, y cómo: "70 g de arroz en
 * seco", "130 g de pechuga en crudo". No asume la base de la tabla (que hoy
 * mezcla filas cocinadas y secas, y el ticket 03 pasa a crudo): la conversión la
 * hace `toTableBasis` con la tabla que haya en cada momento. Así el golden set
 * sobrevive a un cambio de tabla sin tocarlo y mide igual antes y después.
 *
 * La referencia se expresa tal como la expresaría una respuesta PERFECTA del
 * pipeline actual (mismas filas, mismas conversiones que `resolveIngredient`):
 * cualquier diferencia que mida `accuracyOf` es error del modelo o del casado,
 * no una incoherencia entre dos filas de la tabla. El error de la propia tabla
 * se mide aparte, con `golden-external.data.ts` y `tableErrorOf`.
 *
 * Puro (sin I/O ni modelo); importa la tabla, así que no entra en el bundle de
 * navegador — igual que el resto de `plan-eval/`.
 */

import {
  FOODS,
  GENERIC_FOOD,
  matchFood,
  RAW_TO_COOKED,
  type Food,
  type ResolvedIngredient,
} from "@/lib/nutrition/nutrition";

import { MACRO_FLOOR_G, OIL_ID, type PortionItem } from "./accuracy";

export type GoldenSlot = "desayuno" | "comida" | "cena" | "merienda" | "distinto";

export type GoldenIngredient = {
  /** Fila de `foods` que mejor describe el ingrediente. */
  foodKey: string;
  /** Gramos de UNA ración base, tal como se pesaron (ver `state`). */
  grams: number;
  /**
   * Cómo se pesó: `crudo` = antes de cocinar (arroz, pasta y legumbre en seco,
   * carne y pescado crudos), `cocinado` = ya hecho, tal como se sirve. Para el
   * aceite, siempre lo que se COME (el absorbido en una fritura, no el de la
   * sartén). Por defecto `crudo`.
   */
  state?: "crudo" | "cocinado";
};

export type GoldenRecipe = {
  dish: string;
  slot: GoldenSlot;
  /** Mismos tres valores que clasifica el pipeline (`resolve-dish.server.ts`). */
  coccion: "cruda" | "frito_rebozado" | "otra";
  /** Ingredientes de UNA ración base. */
  ingredients: GoldenIngredient[];
  /** Recetas publicadas con pesos de las que sale la referencia. */
  sources: string[];
  /** Quién la revisó a mano. `null` = borrador sin revisar. */
  reviewedBy: string | null;
  notes?: string;
};

/** Referencia externa por 100 g, para medir el error de la tabla (no del modelo). */
export type GoldenExternal = {
  /** Cómo lo escribiría una persona; se casa con `matchFood` como en producción. */
  name: string;
  /** Fila que DEBERÍA casar. Si `matchFood` da otra, es un fallo de casado. */
  expectedKey: string;
  per100: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  /** Etiqueta de producto o tabla oficial, con URL o referencia. */
  source: string;
  reviewedBy: string | null;
  notes?: string;
};

const FOOD_BY_KEY = new Map<string, Food>(FOODS.map((food) => [food.key, food]));

/**
 * Filas en seco con su pareja cocida en la tabla (la de `nutrition.ts`). Para
 * comparar, referencia y salida se pasan a la fila COCIDA con el factor que
 * implica la propia tabla (kcal seco / kcal cocido: la cocción añade agua, no
 * energía). Así la densidad (kcal por 100 g) se mide igual aunque el pipeline
 * dé la receta en seco (ticket 05, D8) y la referencia algo en cocido.
 */
export const DRY_TO_COOKED: Readonly<Record<string, string>> = RAW_TO_COOKED;

/**
 * Filas que son el alimento YA COCIDO a partir de uno seco y que no tienen fila
 * en seco. Pesarlas `crudo` es un error: 70 g de quinoa seca no son 70 g de
 * quinoa cocida (la tabla contaría un tercio de la energía).
 */
export const COOKED_ONLY: ReadonlySet<string> = new Set([
  "arroz-blanco",
  "arroz-integral",
  "pasta",
  "pasta-integral",
  "couscous",
  "quinoa",
  "lentejas",
  "garbanzos",
  "alubias-blancas",
  "alubias-negras",
]);

const OIL_KEYS: ReadonlySet<string> = new Set(["aceite-oliva", "aceite-girasol", "aceite-coco"]);
const LIQUID_ID = "liquido";

/**
 * Identidad para comparar presencia de ingredientes: el arroz seco y el cocido
 * son el mismo ingrediente, y los tres aceites también (mismas macros). Un
 * ingrediente sin identificar nunca coincide con nada.
 */
export function foodIdentity(food: Food, name?: string): string {
  if (food === GENERIC_FOOD) return `?${(name ?? "").trim().toLowerCase()}`;
  if (OIL_KEYS.has(food.key)) return OIL_ID;
  // El líquido de un guiso o una crema: la referencia lo apunta como caldo o como
  // agua (fila `sal`, 0 kcal, ver el golden set) y el modelo, igual, a su manera.
  // Es el mismo ingrediente; sin esto contaba como "omite caldo + inventa agua".
  // En la referencia (sin nombre) la fila `sal` siempre es agua.
  if (food.key === "caldo") return LIQUID_ID;
  if (food.key === "sal" && (name === undefined || /agua|hielo/.test(name.toLowerCase()))) {
    return LIQUID_ID;
  }
  return DRY_TO_COOKED[food.key] ?? food.key;
}

const itemOf = (id: string, grams: number, food: Food): PortionItem => ({
  id,
  grams,
  kcal: (food.kcal * grams) / 100,
  protein_g: (food.protein_g * grams) / 100,
  carbs_g: (food.carbs_g * grams) / 100,
  fat_g: (food.fat_g * grams) / 100,
});

/** Problemas de una receta de referencia (vacío = válida). */
export function validateGolden(recipe: GoldenRecipe): string[] {
  const problems: string[] = [];
  if (!recipe.ingredients.length) problems.push("sin ingredientes");
  for (const ing of recipe.ingredients) {
    const food = FOOD_BY_KEY.get(ing.foodKey);
    if (!food) {
      problems.push(`"${ing.foodKey}" no está en la tabla`);
      continue;
    }
    if (!(ing.grams > 0)) problems.push(`${ing.foodKey}: gramos no positivos`);
    const state = ing.state ?? "crudo";
    if (state === "crudo" && COOKED_ONLY.has(ing.foodKey)) {
      const dry = Object.entries(DRY_TO_COOKED).find(([, cooked]) => cooked === ing.foodKey)?.[0];
      problems.push(
        dry
          ? `${ing.foodKey} es la fila cocida: pésalo en seco con "${dry}" o márcalo "cocinado"`
          : `${ing.foodKey} solo existe cocido en la tabla: márcalo "cocinado" con su peso cocido`,
      );
    }
    if (state === "cocinado" && DRY_TO_COOKED[ing.foodKey]) {
      problems.push(`${ing.foodKey} es la fila en seco: no puede ir "cocinado"`);
    }
  }
  if (!recipe.sources.length) problems.push("sin fuentes");
  return problems;
}

/**
 * Pasa una receta de referencia a la base de la tabla vigente, igual que
 * `resolveIngredient` resolvería una respuesta perfecta del modelo:
 *
 * - fila en seco con pareja cocida → la fila cocida, con los gramos que dan las
 *   mismas kcal;
 * - carne o pescado pesado en crudo con `cookedYield` → gramos × rendimiento
 *   (lo mismo que hace `wasRaw` en el pipeline);
 * - todo lo demás, tal cual.
 *
 * Lanza si la receta no es válida: un golden set roto no debe medir nada.
 */
export function toTableBasis(recipe: GoldenRecipe): PortionItem[] {
  const problems = validateGolden(recipe);
  if (problems.length) throw new Error(`${recipe.dish}: ${problems.join("; ")}`);
  return recipe.ingredients.map((ing) => {
    const food = FOOD_BY_KEY.get(ing.foodKey)!;
    const state = ing.state ?? "crudo";
    const cookedKey = DRY_TO_COOKED[food.key];
    if (cookedKey) {
      const cooked = FOOD_BY_KEY.get(cookedKey)!;
      return itemOf(foodIdentity(cooked), (ing.grams * food.kcal) / cooked.kcal, cooked);
    }
    const grams = state === "crudo" && food.cookedYield ? ing.grams * food.cookedYield : ing.grams;
    return itemOf(foodIdentity(food), grams, food);
  });
}

/** La salida del pipeline (`DishBreakdown.ingredients`) en la misma forma y la misma base. */
export function fromResolved(ingredients: ResolvedIngredient[]): PortionItem[] {
  return ingredients.map((ing) => {
    const cookedKey = DRY_TO_COOKED[ing.food.key];
    const cooked = cookedKey ? FOOD_BY_KEY.get(cookedKey) : undefined;
    if (cooked && cooked.kcal > 0) {
      return itemOf(foodIdentity(cooked), (ing.grams * ing.food.kcal) / cooked.kcal, cooked);
    }
    return itemOf(foodIdentity(ing.food, ing.name), ing.grams, ing.food);
  });
}

export type TableError = {
  name: string;
  expectedKey: string;
  matchedKey: string | null;
  /** `false` si `matchFood` lleva el nombre a otra fila (o a ninguna). */
  matchedRight: boolean;
  /** `false` si la fila esperada todavía no existe en la tabla (una fila que falta). */
  expectedExists: boolean;
  /**
   * Error relativo con signo de la fila que se sumaría en producción frente a la
   * referencia externa: la casada o, si no casa nada, `GENERIC_FOOD`.
   */
  kcalErr: number;
  proteinErr: number;
  fatErr: number;
  carbsErr: number;
};

// Mismo suelo que el error de macros por ración (`MACRO_FLOOR_G`): 1,1 g frente a
// 3,2 g de grasa por 100 g no es un +190 % que deba pesar en la media.
const rel = (out: number, ref: number): number => (out - ref) / Math.max(ref, MACRO_FLOOR_G);

/**
 * Error de la tabla frente a una referencia externa por 100 g. Se mide la fila a
 * la que `matchFood` lleva el nombre, como en producción: si casa con la fila
 * equivocada (el salmorejo con el gazpacho), el error lo refleja; si no casa con
 * ninguna, se mide `GENERIC_FOOD`, que es lo que `resolveIngredient` sumaría.
 */
export function tableErrorOf(ext: GoldenExternal): TableError {
  const matched = matchFood(ext.name)?.food ?? null;
  const row = matched ?? GENERIC_FOOD;
  return {
    name: ext.name,
    expectedKey: ext.expectedKey,
    matchedKey: matched?.key ?? null,
    matchedRight: matched?.key === ext.expectedKey,
    expectedExists: FOOD_BY_KEY.has(ext.expectedKey),
    kcalErr: rel(row.kcal, ext.per100.kcal),
    proteinErr: rel(row.protein_g, ext.per100.protein_g),
    fatErr: rel(row.fat_g, ext.per100.fat_g),
    carbsErr: rel(row.carbs_g, ext.per100.carbs_g),
  };
}
