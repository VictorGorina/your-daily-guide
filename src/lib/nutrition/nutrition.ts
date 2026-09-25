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
  /** Gramos en la base de la fila (`gramsInRowBasis`): los que se multiplican por `food`. */
  grams: number;
  /** Estado en que llegaron los gramos, y cuántos eran (la receta que se pesa, D8). */
  state?: IngredientState;
  gramsRaw?: number;
  /** Fila de la tabla, o `GENERIC_FOOD` si no se pudo identificar. */
  food: Food;
  /** `high` = alias/clave exacta o solape fuerte; `low` = solape flojo o genérico. */
  confidence: "high" | "low";
  /**
   * Cómo se llegó a la fila cuando NO casó con la tabla (ticket 13 de
   * `precision-nutricional`): `category` = mediana de su categoría (lo que diga
   * el modelo que es), `closest` = el alimento más parecido que eligió
   * `DISAMBIGUATION_MODEL` de una lista cerrada, `usda` = una fila traída de
   * USDA FoodData Central (ticket 22), `generic` = `GENERIC_FOOD` (sin
   * categoría). Ausente si casó.
   */
  fallback?: "category" | "closest" | "usda" | "generic";
  /** Categoría que dio el modelo, para buscar el alimento más parecido. */
  category?: FoodCategory;
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

/** La tabla y, detrás, las filas de USDA registradas (una fila de la tabla gana a igualdad). */
const searchableFoods = (): readonly Food[] =>
  EXTRA_FOODS.size ? [...FOODS, ...EXTRA_FOODS.values()] : FOODS;

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

  const candidates = searchableFoods();
  for (const food of candidates) {
    if (food.label.length >= 4 && norm.includes(normName(food.label))) {
      return { food, confidence: "high" };
    }
  }

  const want = significantTokens(name);
  if (!want.length) return null;

  let best: Food | null = null;
  let bestScore = 0;
  for (const food of candidates) {
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
 * En qué estado da los gramos el modelo: `crudo` = antes de cocinar (lo que se
 * pesa y se compra: arroz, pasta y legumbre en seco, carne y pescado crudos),
 * `listo` = tal como se come o se vende hecho (pan, conservas, embutido, "130 g
 * de pollo a la plancha"). D8 de `precision-nutricional`: la receta canónica va
 * en crudo.
 */
export type IngredientState = "crudo" | "listo";

/**
 * Pasa los gramos a la base de la fila (ticket 14 §4), cuando tiene
 * `cookedYield`: crudo sobre una fila cocinada → × rendimiento; listo sobre una
 * fila cruda → ÷ rendimiento. Sin `cookedYield` no hay nada que convertir
 * (curados, enlatados, huevo, proteína vegetal).
 *
 * Deliberadamente en código y no en el prompt: pedirle al modelo que calcule
 * "200 × 0.75" en prosa acertaba unas veces y otras no (issue de precisión,
 * 2026-09-19). El modelo solo dice el estado; el número lo pone la tabla.
 */
export function gramsInRowBasis(grams: number, food: Food, state: IngredientState | undefined) {
  if (!food.cookedYield || !state) return grams;
  const basis = food.basis ?? "cocinado";
  if (state === "crudo" && basis === "cocinado") return Math.round(grams * food.cookedYield);
  if (state === "listo" && basis === "crudo") return Math.round(grams / food.cookedYield);
  return grams;
}

/**
 * Fila cocinada → su fila en crudo o en seco. Si el modelo da "70 g de arroz" en
 * crudo y el nombre casa con el arroz cocido (130 kcal), se contarían 91 kcal en
 * vez de 252: los gramos en seco van SIEMPRE contra la fila en seco. La patata
 * frita casera en crudo es patata: el aceite lo pone el método (`cooking.ts`).
 */
export const COOKED_TO_RAW: Readonly<Record<string, string>> = {
  "arroz-blanco": "arroz-crudo",
  "arroz-integral": "arroz-integral-crudo",
  pasta: "pasta-cruda",
  "pasta-integral": "pasta-integral-cruda",
  quinoa: "quinoa-cruda",
  couscous: "couscous-seco",
  lentejas: "lentejas-secas",
  garbanzos: "garbanzos-secos",
  "alubias-blancas": "alubias-blancas-secas",
  "alubias-negras": "alubias-negras-secas",
  "patata-frita": "patata",
};

/** Fila en seco → su fila cocida (la inversa de `COOKED_TO_RAW`, sin la patata). */
export const RAW_TO_COOKED: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(COOKED_TO_RAW)
    .filter(([cooked]) => cooked !== "patata-frita")
    .map(([cooked, raw]) => [raw, cooked]),
);

/** La fila que toca según el estado en que vienen los gramos. */
function rowForState(food: Food, state: IngredientState | undefined): Food {
  if (state !== "crudo") return food;
  const rawKey = COOKED_TO_RAW[food.key];
  return (rawKey && FOOD_BY_KEY.get(rawKey)) || food;
}

// ---------------------------------------------------------------------------
// Ingredientes que no casan: categoría antes que genérico (ticket 13, D13)
// ---------------------------------------------------------------------------

export const FOOD_CATEGORIES: readonly FoodCategory[] = [
  "proteina",
  "verdura",
  "fruta",
  "cereal",
  "legumbre",
  "lacteo",
  "grasa",
  "fruto-seco",
  "despensa",
];

/** La categoría que escribe el modelo, con o sin tildes y en plural. `null` si no es ninguna. */
export function parseFoodCategory(raw: unknown): FoodCategory | null {
  const norm = normName(String(raw ?? ""))
    .replace(/\s+/g, "-")
    .replace(/s$/, "");
  if (!norm) return null;
  if (norm === "fruto-seco" || norm === "frutos-seco" || norm === "fruto-secos")
    return "fruto-seco";
  if (norm === "cereale") return "cereal";
  return (FOOD_CATEGORIES as readonly string[]).includes(norm) ? (norm as FoodCategory) : null;
}

/** Filas de la tabla de una categoría, sin las de 0 kcal (sal, agua): son candidatas. */
export function foodsOfCategory(category: FoodCategory): Food[] {
  return FOODS.filter((food) => food.category === category && food.kcal > 0);
}

const CATEGORY_MEDIAN = new Map<FoodCategory, Food>();
for (const category of FOOD_CATEGORIES) {
  const rows = [...foodsOfCategory(category)].sort((a, b) => a.kcal - b.kcal);
  const median = rows[Math.floor((rows.length - 1) / 2)];
  if (!median) continue;
  // La fila mediana por kcal (no la mediana de cada macro por separado, que
  // daría una combinación que no existe) con una key propia, para que se vea
  // en cualquier desglose que es una aproximación y no un casado.
  CATEGORY_MEDIAN.set(category, {
    ...median,
    key: `__${category}__`,
    label: `${median.label} (aproximado)`,
    aliases: [],
  });
}

/** Alimento de referencia de una categoría: su fila mediana por kcal. */
export const categoryMedianFood = (category: FoodCategory): Food =>
  CATEGORY_MEDIAN.get(category) ?? GENERIC_FOOD;

/**
 * Filas que no están en `FOODS` pero sí existen para toda la app: las traídas
 * de USDA (`foods_extra`, ticket 22). Las registra el servidor al cargarlas;
 * `foodByKey` y `matchFood` las ven igual que una fila de la tabla.
 */
const EXTRA_FOODS = new Map<string, Food>();

export function registerExtraFoods(foods: readonly Food[]): void {
  for (const food of foods) {
    if (FOOD_BY_KEY.has(food.key)) continue;
    EXTRA_FOODS.set(food.key, food);
    const tokens = new Set<string>();
    for (const phrase of [food.label, ...food.aliases]) {
      const norm = normName(phrase);
      if (norm && !EXACT.has(norm)) EXACT.set(norm, food);
      for (const token of significantTokens(phrase)) tokens.add(token);
    }
    FOOD_TOKENS.set(food, tokens);
    FOOD_HEAD.set(food, significantTokens(food.label)[0] ?? "");
  }
}

/**
 * Cualquier fila por su clave: la tabla, las filas de USDA, la mediana de una
 * categoría (`__verdura__`) o el genérico. Es lo que usa una receta guardada
 * (`dish_recipes`) para volver a calcular sus macros al leerla (invariante 4).
 */
export function foodByKey(key: string): Food | null {
  const found = FOOD_BY_KEY.get(key) ?? EXTRA_FOODS.get(key);
  if (found) return found;
  if (key === GENERIC_FOOD.key) return GENERIC_FOOD;
  const category = /^__(.+)__$/.exec(key)?.[1];
  return category && CATEGORY_MEDIAN.has(category as FoodCategory)
    ? CATEGORY_MEDIAN.get(category as FoodCategory)!
    : null;
}

/**
 * Parte de las kcal del plato a partir de la cual un ingrediente sin casar
 * "pesa": por encima no vale una mediana, se busca el alimento más parecido.
 */
export const HEAVY_UNMATCHED_SHARE = 0.05;

/**
 * Índices de los ingredientes que no casaron con seguridad y aportan al menos
 * `HEAVY_UNMATCHED_SHARE` de las kcal del plato (con su valor provisional de
 * mediana). Son los que `resolve-dish.server` manda a desambiguar; el resto
 * (especias, un chorrito de algo) se queda con la mediana de su categoría.
 */
export function heavyUnmatched(ingredients: readonly ResolvedIngredient[]): number[] {
  const total = macrosOf([...ingredients]).kcal;
  if (total <= 0) return [];
  const out: number[] = [];
  ingredients.forEach((ing, i) => {
    // Sin casar (mediana o genérico) o casado flojo por un solo token: los dos
    // restan calidad (`resolutionQuality`), así que si pesan se desambiguan.
    const unsure =
      ing.fallback === "category" ||
      ing.fallback === "generic" ||
      (!ing.fallback && ing.confidence === "low");
    if (!unsure) return;
    const kcal = (ing.food.kcal * ing.grams) / 100;
    if (kcal / total >= HEAVY_UNMATCHED_SHARE) out.push(i);
  });
  return out;
}

/**
 * Resuelve un ingrediente crudo (lo que devuelve el modelo) contra la tabla:
 * primero por `key` explícita, luego por nombre. Si nada casa, la mediana de
 * la categoría que diga el modelo; solo sin categoría cae en `GENERIC_FOOD`.
 * En los dos casos con `confidence: "low"` y `fallback` para que se sepa.
 */
export function resolveIngredient(raw: {
  key?: string | null;
  name?: string | null;
  grams?: unknown;
  /** En qué estado vienen los gramos — ver `gramsInRowBasis` y `rowForState`. */
  state?: IngredientState;
  /** Categoría que da el modelo (`proteina`, `grasa`…), texto libre. */
  category?: unknown;
}): ResolvedIngredient {
  const name = String(raw.name ?? "").trim();
  const grams = clampGrams(raw.grams);
  const state = raw.state;
  const settle = (found: Food, confidence: "high" | "low"): ResolvedIngredient => {
    const food = rowForState(found, state);
    return {
      name: name || food.label,
      grams: gramsInRowBasis(grams, food, state),
      food,
      confidence,
      ...(state ? { state, gramsRaw: grams } : {}),
    };
  };

  if (raw.key) {
    const byKey = foodByKey(String(raw.key).trim());
    if (byKey) return settle(byKey, "high");
  }

  const matched = matchFood(name);
  if (matched) return settle(matched.food, matched.confidence);

  const category = parseFoodCategory(raw.category);
  if (category) {
    return {
      name: name || "ingrediente",
      grams,
      food: categoryMedianFood(category),
      confidence: "low",
      fallback: "category",
      category,
    };
  }
  return {
    name: name || "ingrediente",
    grams,
    food: GENERIC_FOOD,
    confidence: "low",
    fallback: "generic",
  };
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

/** Macros × un factor (una ración personal, "dos cañas"), redondeadas como `macrosOf`. */
export function scaleMacros(m: Macros, factor: number): Macros {
  return {
    kcal: Math.round(m.kcal * factor),
    protein_g: Math.round(m.protein_g * factor),
    carbs_g: Math.round(m.carbs_g * factor),
    fat_g: Math.round(m.fat_g * factor),
    fiber_g: Math.round(m.fiber_g * factor),
  };
}

/** Precio orientativo (€) de una lista de ingredientes ya resueltos. */
export function priceOf(ingredients: ResolvedIngredient[]): number {
  let total = 0;
  for (const ing of ingredients) total += ing.food.pricePer100Eur * (ing.grams / 100);
  return Math.round(total * 100) / 100;
}

/** ¿Cuenta como identificado para la calidad? Casado con confianza, o resuelto a propósito. */
const isIdentified = (ing: ResolvedIngredient) =>
  ing.confidence === "high" || ing.fallback === "closest" || ing.fallback === "usda";

const kcalOfIngredient = (ing: ResolvedIngredient) => (ing.food.kcal * ing.grams) / 100;

/**
 * ¿Qué parte de las KCAL del plato sale de ingredientes identificados?
 * (ticket 14 §5: antes pesaba por gramos, así que 300 g de caldo bien casado
 * tapaban 30 g de manteca sin casar, que es donde están las kcal). Cuenta como
 * identificado lo casado con confianza alta y lo que se resolvió a propósito (el
 * alimento más parecido, ticket 13, o USDA, ticket 22); no cuentan una mediana
 * de categoría, el genérico ni un casado flojo por un solo token.
 *
 * Un plato con todo a 0 kcal (agua, un refresco zero) bien casado vale 1.
 */
export function resolutionQuality(ingredients: ResolvedIngredient[]): number {
  if (!ingredients.length) return 0;
  const total = ingredients.reduce((sum, ing) => sum + kcalOfIngredient(ing), 0);
  if (total <= 0) return ingredients.every(isIdentified) ? 1 : 0;
  const identified = ingredients
    .filter(isIdentified)
    .reduce((sum, ing) => sum + kcalOfIngredient(ing), 0);
  return identified / total;
}

/**
 * Por debajo de esta calidad, un plato NO se da por calculado (ticket 05 §5): lo
 * que falla se resuelve con el alimento más parecido o con USDA y se vuelve a
 * medir; si aun así no llega, se queda "calculando" y se reintenta. Nunca se
 * enseña con un genérico ni con un promedio (D13).
 */
export const MIN_RECIPE_QUALITY = 0.9;
