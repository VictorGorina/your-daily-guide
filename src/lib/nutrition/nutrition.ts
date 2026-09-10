/**
 * Núcleo puro de la nutrición: casar un nombre de ingrediente con la tabla de
 * composición y sumar macros/precio de una lista de ingredientes. Sin I/O, sin
 * `*.server`, sin `ai` — se puede testear con el runner de Bun y usar desde
 * cualquier lado.
 *
 * El flujo completo (plato → ingredientes → números) vive en
 * `resolve-dish.server.ts`, que llama al modelo para la descomposición y luego
 * usa estas funciones para el cálculo.
 */

import { normName } from "@/lib/plan-shared";

import { FOODS, FOOD_KEYS, GENERIC_FOOD, type Food, type FoodCategory } from "./foods.data";

export { FOODS, FOOD_KEYS, GENERIC_FOOD };
export type { Food, FoodCategory };

/** Macros de un conjunto de ingredientes. Misma forma que `MacroEstimate` de la guía. */
export type Macros = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

export const ZERO: Macros = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

/** Un ingrediente ya resuelto contra la tabla, listo para sumar. */
export type ResolvedIngredient = {
  /** Nombre tal como lo dio el modelo (para mostrarlo / depurar). */
  name: string;
  /** Gramos tal como se comen. */
  grams: number;
  /** Fila de la tabla, o `GENERIC_FOOD` si no se pudo identificar. */
  food: Food;
  /** `high` = alias/clave exacta o solape fuerte; `low` = solape flojo o genérico. */
  confidence: "high" | "low";
};

// ---------------------------------------------------------------------------
// Índice de búsqueda (se construye una vez al cargar el módulo)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "con",
  "sin",
  "y",
  "o",
  "a",
  "al",
  "en",
  "para",
  "por",
  "su",
  "mi",
  "tipo",
  "estilo",
  "casero",
  "casera",
  "fresco",
  "fresca",
  "natural",
  "hecho",
  "hecha",
]);

/** Quita el plural simple para que "lentejas" case con el alias "lenteja". */
const singular = (token: string): string => {
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
};

const significantTokens = (raw: string): string[] =>
  normName(raw)
    .split(/[\s,./]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(singular);

const FOOD_BY_KEY = new Map<string, Food>(FOODS.map((food) => [food.key, food]));

/** Frase normalizada exacta → alimento (label, aliases y la key con espacios). */
const EXACT = new Map<string, Food>();
/** alimento → todos sus tokens significativos (label + key + aliases). */
const FOOD_TOKENS = new Map<Food, Set<string>>();
/** alimento → su token "cabecera" (primer token significativo del label). */
const FOOD_HEAD = new Map<Food, string>();

for (const food of FOODS) {
  const phrases = [food.label, food.key.replace(/-/g, " "), ...food.aliases];
  const tokens = new Set<string>();
  for (const phrase of phrases) {
    const norm = normName(phrase);
    if (norm && !EXACT.has(norm)) EXACT.set(norm, food);
    const normSingular = phrase
      .split(/\s+/)
      .map((w) => singular(normName(w)))
      .join(" ")
      .trim();
    if (normSingular && !EXACT.has(normSingular)) EXACT.set(normSingular, food);
    for (const token of significantTokens(phrase)) tokens.add(token);
  }
  FOOD_TOKENS.set(food, tokens);
  FOOD_HEAD.set(food, significantTokens(food.label)[0] ?? significantTokens(food.key)[0] ?? "");
}

// ---------------------------------------------------------------------------
// matchFood
// ---------------------------------------------------------------------------

/**
 * Casa un nombre libre de ingrediente con la tabla de composición.
 *
 * 1. Coincidencia exacta con un label o alias (también en singular).
 * 2. El label entero aparece contenido en el nombre ("arroz basmati integral").
 * 3. Solape de tokens significativos: gana el alimento con más tokens en común
 *    (a igualdad, el primero de la tabla — las formas principales van antes que
 *    las secundarias, "arroz" antes que "arroz crudo"). Un solape de un solo
 *    token solo vale si ese token es la cabecera del alimento ("lenteja" para
 *    las lentejas), no una palabra incidental de un alias ("salsa" para el pesto).
 * 4. `null` si nada de lo anterior encaja.
 *
 * `confidence` es `high` con coincidencia exacta, contención de label o ≥2
 * tokens en común; `low` con un solo token (que además debe ser la cabecera).
 */
export function matchFood(name: string): { food: Food; confidence: "high" | "low" } | null {
  const norm = normName(name);
  if (!norm) return null;

  const exact = EXACT.get(norm) ?? EXACT.get(significantTokens(name).join(" "));
  if (exact) return { food: exact, confidence: "high" };

  for (const food of FOODS) {
    if (food.label.length >= 4 && norm.includes(normName(food.label))) {
      return { food, confidence: "high" };
    }
  }

  const want = significantTokens(name);
  if (!want.length) return null;

  let best: Food | null = null;
  let bestScore = 0;
  for (const food of FOODS) {
    const foodTokens = FOOD_TOKENS.get(food);
    if (!foodTokens) continue;
    let score = 0;
    for (const token of want) if (foodTokens.has(token)) score += 1;
    if (score > bestScore) {
      best = food;
      bestScore = score;
    }
  }

  if (!best || bestScore < 1) return null;
  if (bestScore === 1) {
    // Un único token en común: solo cuenta si es la cabecera del alimento.
    const head = FOOD_HEAD.get(best);
    if (!head || !want.includes(head)) return null;
    return { food: best, confidence: "low" };
  }
  return { food: best, confidence: "high" };
}

// ---------------------------------------------------------------------------
// Resolución y suma
// ---------------------------------------------------------------------------

/** Gramos saneados: número finito, 0-2000, entero. */
export const clampGrams = (g: unknown): number => {
  const n = Number(g);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(2000, Math.round(n));
};

/**
 * Resuelve un ingrediente crudo (lo que devuelve el modelo) contra la tabla:
 * primero por `key` explícita, luego por nombre, y si nada casa cae en
 * `GENERIC_FOOD` con `confidence: "low"` para que la suma siga teniendo sentido.
 */
export function resolveIngredient(raw: {
  key?: string | null;
  name?: string | null;
  grams?: unknown;
}): ResolvedIngredient {
  const name = String(raw.name ?? "").trim();
  const grams = clampGrams(raw.grams);

  if (raw.key) {
    const byKey = FOOD_BY_KEY.get(String(raw.key).trim());
    if (byKey) return { name: name || byKey.label, grams, food: byKey, confidence: "high" };
  }

  const matched = matchFood(name);
  if (matched) return { name, grams, food: matched.food, confidence: matched.confidence };

  return { name: name || "ingrediente", grams, food: GENERIC_FOOD, confidence: "low" };
}

/** Suma las macros de una lista de ingredientes ya resueltos. */
export function macrosOf(ingredients: ResolvedIngredient[]): Macros {
  const total = { ...ZERO };
  for (const ing of ingredients) {
    const factor = ing.grams / 100;
    total.kcal += ing.food.kcal * factor;
    total.protein_g += ing.food.protein_g * factor;
    total.carbs_g += ing.food.carbs_g * factor;
    total.fat_g += ing.food.fat_g * factor;
    total.fiber_g += ing.food.fiber_g * factor;
  }
  return {
    kcal: Math.round(total.kcal),
    protein_g: Math.round(total.protein_g),
    carbs_g: Math.round(total.carbs_g),
    fat_g: Math.round(total.fat_g),
    fiber_g: Math.round(total.fiber_g),
  };
}

/** Precio orientativo (€) de una lista de ingredientes ya resueltos. */
export function priceOf(ingredients: ResolvedIngredient[]): number {
  let total = 0;
  for (const ing of ingredients) total += ing.food.pricePer100Eur * (ing.grams / 100);
  return Math.round(total * 100) / 100;
}

/**
 * ¿Qué proporción de los ingredientes (por gramos) se pudo identificar con
 * confianza alta? Sirve para decidir si fiarse del número o caer al respaldo.
 */
export function resolutionQuality(ingredients: ResolvedIngredient[]): number {
  const totalG = ingredients.reduce((sum, ing) => sum + ing.grams, 0);
  if (totalG <= 0) return 0;
  const highG = ingredients
    .filter((ing) => ing.confidence === "high")
    .reduce((sum, ing) => sum + ing.grams, 0);
  return highG / totalG;
}
