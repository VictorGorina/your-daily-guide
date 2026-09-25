/**
 * Descomposición de un plato en ingredientes con gramos — la ÚNICA llamada al
 * modelo de todo el pipeline de nutrición. El modelo hace lo que sabe hacer
 * (conocimiento del mundo: "shakshuka" → huevo, tomate, pimiento…); los números
 * (kcal, macros, precio) los pone el código en `nutrition.ts` a partir de la
 * tabla de composición.
 *
 * Server-only (`ai`, `OPENROUTER_API_KEY`). Se carga con `await import()` desde
 * las server functions, igual que el resto de `*.server`.
 */

import { generateText } from "ai";

import {
  createAiProvider,
  DISAMBIGUATION_MODEL,
  DISH_FALLBACK_MODEL,
  DISH_MODEL,
} from "@/lib/ai-provider.server";
import { normName, parseJsonLoose } from "@/lib/plan-shared";

import {
  CHAIN_TIMEOUTS,
  failureOf,
  parseDecomposition,
  runDecomposeChain,
  type DecomposeFailure,
  type RawDish,
} from "./decompose-chain";
import { FOOD_KEYS, type Food, type FoodCategory } from "./foods.data";
import {
  FOOD_CATEGORIES,
  foodsOfCategory,
  heavyUnmatched,
  macrosOf,
  priceOf,
  resolutionQuality,
  resolveIngredient,
  ZERO,
  type Macros,
  type ResolvedIngredient,
} from "./nutrition";

export type DishBreakdown = {
  dish: string;
  servings: number;
  ingredients: ResolvedIngredient[];
  /** Macros para TODAS las raciones (`servings`). */
  macros: Macros;
  /** Macros por ración. */
  perServing: Macros;
  /** Precio orientativo (€) de los ingredientes, todas las raciones. */
  price: number;
  /** 0-1: proporción de gramos identificada con confianza alta. */
  quality: number;
  /**
   * ¿Esto es comida? `false` SOLO cuando el modelo lo dice explícitamente (una
   * broma, algo que no se come). Se deja en `true` ante cualquier duda o fallo:
   * negarle a alguien apuntar lo que ha comido es peor que colar una broma, que
   * además ya filtra `content-guard` antes de llegar aquí.
   */
  isFood: boolean;
  /**
   * El texto no dice qué se comió ("algo rápido", "lo de siempre"): no se
   * inventa un plato, se le pregunta a la persona (ticket 13). Llega sin
   * ingredientes, igual que un "no es comida", y tampoco se reintenta.
   */
  vague: boolean;
  source: "model" | "unresolved";
  /**
   * Por qué se quedó sin calcular tras TODA la cadena (solo con
   * `source: "unresolved"` y ni vago ni "no es comida"). Va al log, sin el
   * texto del plato.
   */
  failure?: DecomposeFailure;
};

export type { DecomposeFailure };

const empty = (dish: string, servings: number): DishBreakdown => ({
  dish,
  servings,
  ingredients: [],
  macros: { ...ZERO },
  perServing: { ...ZERO },
  price: 0,
  quality: 0,
  isFood: true,
  vague: false,
  source: "unresolved",
});

/**
 * ¿Sale de su receta? Es la ÚNICA definición de "calculado" (D13): un plato
 * con receta se cuenta aunque parte de sus ingredientes sean el alimento más
 * parecido; uno sin receta no se rellena con ningún promedio. 0 kcal vale (un
 * refresco sin azúcar), lo que decide es que se haya entendido.
 */
export const isCalculated = (b: DishBreakdown | null | undefined): b is DishBreakdown =>
  !!b && b.source === "model" && b.ingredients.length > 0;

const perServingOf = (macros: Macros, servings: number): Macros => {
  const n = Math.max(1, servings);
  return {
    kcal: Math.round(macros.kcal / n),
    protein_g: Math.round(macros.protein_g / n),
    carbs_g: Math.round(macros.carbs_g / n),
    fat_g: Math.round(macros.fat_g / n),
    fiber_g: Math.round(macros.fiber_g / n),
  };
};

// Memo por proceso: dentro de una misma ejecución (una guía, una pasada del
// eval) el mismo plato no se le pide dos veces al modelo. No sustituye a una
// caché persistente — eso es la tabla `dish_breakdowns` de la Fase 3 —, pero la
// guía ya cachea su resultado entero en `daily_logs.guide`, así que hoy el
// modelo ve cada plato una vez al día por persona, igual que antes.
const memo = new Map<string, DishBreakdown>();
const memoKey = (dish: string, servings: number) => `${normName(dish)}|${servings}`;

const RATION_ANCHORS =
  "Anclas de ración POR PERSONA: pasta ≈ 180 g cocida (70 g en seco); arroz ≈ 150 g cocido; " +
  "carne o pescado ≈ 130 g; legumbre ≈ 180 g cocida; verdura de guarnición ≈ 150 g; " +
  "pan ≈ 60 g; aceite para saltear o a la plancha ≈ 10 g; fruta de postre ≈ 150 g; yogur ≈ 125 g. " +
  // "Onza" de chocolate en España es un cuadradito de la tableta, no la onza
  // anglosajona: sin decirlo, el modelo daba 57 g para "dos onzas".
  "Picoteo: puñado de frutos secos ≈ 30 g; galleta ≈ 10 g cada una; " +
  "onza de chocolate = un cuadradito de la tableta ≈ 7 g (NO la onza inglesa de 28 g); " +
  "bolsa pequeña de patatas ≈ 40 g; caña de cerveza ≈ 200 g; tercio ≈ 330 g; " +
  "copa de vino ≈ 150 g; copa de licor ≈ 50 g; bola de helado ≈ 60 g.";

/**
 * Ticket 13: la categoría de cada ingrediente, para que uno que no casa con la
 * tabla caiga en su categoría (y, si pesa, en el alimento más parecido) y nunca
 * en el genérico de 130 kcal; y "vago", para no inventarse un plato.
 */
const CATEGORY_FIELD =
  `- "categoria" en cada ingrediente: uno de estos valores exactos: ${FOOD_CATEGORIES.join(", ")} ` +
  "(el tipo de alimento que es, aunque su key sea null).\n";

const VAGUE_FIELD =
  '- "vago": true SOLO si el texto no permite saber qué se comió ("algo rápido", "lo de ' +
  'siempre", "lo que había en la oficina", "cualquier cosa"); en ese caso deja la lista de ' +
  'ingredientes vacía. Un plato genérico pero reconocible ("un bocadillo", "ensalada", ' +
  '"pasta") NO es vago: descomponlo como el más habitual.\n';

/**
 * Dos correcciones que antes vivían como texto largo en el prompt (pedirle al
 * modelo que hiciera la conversión o inventara un gramaje de aceite él mismo,
 * caso a caso) y ahora son CLASIFICACIONES cerradas que resuelve el código
 * (`resolveIngredient` para `wasRaw`, `applyFryingOilFloor` más abajo para
 * `coccion`). Al modelo solo se le pide reconocer un patrón, no hacer
 * aritmética ni recordar una lista de platos — por eso generaliza a cualquier
 * plato nuevo sin tocar el prompt otra vez (issue de precisión, 2026-09-19).
 */
const CLASSIFICATION_FIELDS =
  '- "coccion" del plato (uno de estos 3 valores exactos): "cruda" (ensalada, fruta, nada se ' +
  'cocina); "frito_rebozado" SOLO si de verdad se fríe con bastante aceite y lo absorbe — ' +
  "rebozado, empanado, tempura, croquetas, buñuelos, tortilla de patatas (lleva bastante aceite " +
  'de la fritura); "otra" para todo lo demás, INCLUIDA una tortilla francesa o de un par de ' +
  "huevos batidos (se cuaja en la sartén con muy poco aceite, no es una fritura) y cualquier " +
  "plancha, horno, vapor, hervido o salteado con poco aceite.\n" +
  '- "wasRaw" en cada ingrediente de carne o pescado FRESCO (no en curados, enlatados, huevo ni ' +
  "proteína vegetal): true si el gramaje que has puesto es el peso ANTES de cocinar (el texto dice " +
  '"crudo/a", "en crudo", "sin cocinar", "pesada antes de cocinar", o es una compra en crudo sin ' +
  "cocinar todavía); false en cualquier otro caso, incluido cuando el texto no dice nada. NO " +
  "conviertas tú el gramaje — el código lo hace a partir de este campo.";

const OIL_KEYS = new Set(["aceite-oliva", "aceite-girasol", "aceite-coco"]);
const FRYING_OIL_FLOOR_PER_SERVING = 25;

/**
 * En un plato "frito_rebozado" el modelo suele apuntar el aceite que se ECHA
 * en la sartén, no el que queda de verdad ABSORBIDO en la comida — varias
 * veces menos. En vez de listar platos fritos uno a uno en el prompt (lo que
 * no cubre el siguiente plato frito que alguien escriba), el código impone un
 * mínimo plausible una vez que el modelo ya clasificó el método de cocción
 * (issue de precisión, 2026-09-19: la tortilla de patatas se quedaba en 138
 * kcal/100 g con 10 g de aceite; una tortilla real ronda 190-220 kcal/100 g).
 */
const applyFryingOilFloor = (
  ingredients: ResolvedIngredient[],
  servings: number,
): ResolvedIngredient[] => {
  const floor = FRYING_OIL_FLOOR_PER_SERVING * servings;
  const oilGrams = ingredients
    .filter((ing) => OIL_KEYS.has(ing.food.key))
    .reduce((sum, ing) => sum + ing.grams, 0);
  if (oilGrams >= floor) return ingredients;

  const missing = floor - oilGrams;
  const existingOil = ingredients.find((ing) => OIL_KEYS.has(ing.food.key));
  if (existingOil) {
    return ingredients.map((ing) =>
      ing === existingOil ? { ...ing, grams: ing.grams + missing } : ing,
    );
  }
  return [
    ...ingredients,
    resolveIngredient({ key: "aceite-oliva", name: "aceite absorbido en fritura", grams: missing }),
  ];
};

// ---------------------------------------------------------------------------
// La cadena de cálculo (ticket 13 de `precision-nutricional`, D13)
// ---------------------------------------------------------------------------

const DISAMBIGUATION_TIMEOUT_MS = 20_000;

function decomposePrompt(dishes: string[], servings: number): string {
  return (
    `Descompón cada plato en sus ingredientes, con la cantidad en GRAMOS para ${servings} ` +
    `ración(es) EN TOTAL. Platos:\n${dishes.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\n` +
    'Devuelve SOLO JSON: {"platos": [{"plato": string (igual que te lo doy), ' +
    '"comida": boolean, "vago": boolean, "coccion": string, "ingredientes": [{"key": ' +
    'string|null, "name": string, "gramos": number, "wasRaw": boolean, "categoria": string}]}]}\n' +
    '- "comida": true para cualquier plato, alimento o bebida, por raro, casero o poco ' +
    "saludable que sea. false SOLO si es una broma, un insulto o algo que no se come; en ese " +
    "caso deja la lista de ingredientes vacía.\n" +
    VAGUE_FIELD +
    `- "key": una de esta lista SOLO si encaja de verdad; si no, null:\n${FOOD_KEYS.join(", ")}\n` +
    '- "name": ingrediente en español, singular, sin marca (p. ej. "pechuga de pollo")\n' +
    `- "gramos": gramos TOTALES para las ${servings} raciones, tal como se come ` +
    "(arroz, pasta y legumbre en COCIDO). Incluye el aceite de cocinar y los básicos con peso real.\n" +
    CATEGORY_FIELD +
    "- Un producto ya hecho (patatas de bolsa, galletas, bollería, helado, chocolatina, refresco, " +
    "cerveza) es UN solo ingrediente con su key: no lo descompongas en harina, aceite o azúcar.\n" +
    `${CLASSIFICATION_FIELDS}\n` +
    `${RATION_ANCHORS}\n` +
    "Sin markdown, sin texto alrededor."
  );
}

type Provider = ReturnType<typeof createAiProvider>;

/** Una llamada al modelo para varios platos (el `ask` de la cadena). */
async function askModel(
  ai: Provider,
  model: string,
  dishes: string[],
  servings: number,
  timeoutMs: number,
): Promise<Map<string, RawDish>> {
  const { text } = await generateText({
    model: ai(model),
    temperature: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
    prompt: decomposePrompt(dishes, servings),
  });
  return parseDecomposition(text, parseJsonLoose);
}

/**
 * Pide al modelo barato el alimento de la tabla más parecido a cada
 * ingrediente que no casó y pesa en el plato. El modelo solo elige un número de
 * una lista cerrada de su categoría: nunca escribe una cifra (invariante 1 del
 * spec). Si falla, cada ingrediente se queda con la mediana de su categoría.
 */
async function pickClosestFoods(
  ai: Provider,
  items: { name: string; category: FoodCategory }[],
): Promise<(Food | null)[]> {
  const lists = new Map<FoodCategory, Food[]>();
  for (const it of items) {
    if (!lists.has(it.category)) lists.set(it.category, foodsOfCategory(it.category));
  }
  const { text } = await generateText({
    model: ai(DISAMBIGUATION_MODEL),
    temperature: 0,
    abortSignal: AbortSignal.timeout(DISAMBIGUATION_TIMEOUT_MS),
    prompt:
      "Para cada ingrediente, elige de SU lista el alimento más parecido en composición " +
      "nutricional (energía, grasa, proteína e hidratos por 100 g), no en el nombre.\n\n" +
      items
        .map((it, i) => {
          const options = (lists.get(it.category) ?? [])
            .map((food, j) => `${j + 1}) ${food.label}`)
            .join("; ");
          return `${i + 1}. «${it.name}» — opciones: ${options}`;
        })
        .join("\n") +
      '\n\nDevuelve SOLO JSON: {"elecciones": [{"n": número del ingrediente, "opcion": número ' +
      "de la opción}]}. Sin markdown.",
  });
  const parsed = parseJsonLoose(text) as { elecciones?: unknown };
  const picks: (Food | null)[] = items.map(() => null);
  for (const raw of Array.isArray(parsed?.elecciones) ? parsed.elecciones : []) {
    const o = (raw ?? {}) as { n?: unknown; opcion?: unknown };
    const i = Number(o.n) - 1;
    const j = Number(o.opcion) - 1;
    const item = items[i];
    if (!item || !Number.isInteger(j)) continue;
    picks[i] = lists.get(item.category)?.[j] ?? null;
  }
  return picks;
}

function ingredientsOf(raw: RawDish, servings: number): ResolvedIngredient[] {
  const ingredients = raw.ingredientes
    .map((o) =>
      resolveIngredient({
        key: o.key as string,
        name: o.name as string,
        grams: o.gramos,
        wasRaw: o.wasRaw === true,
        category: o.categoria,
      }),
    )
    .filter((ing) => ing.grams > 0);
  return raw.coccion === "frito_rebozado"
    ? applyFryingOilFloor(ingredients, servings)
    : ingredients;
}

/**
 * Descompone varios platos en ingredientes con gramos. Devuelve un mapa
 * indexado por el string de plato tal como se pasó. Nunca lanza.
 *
 * **La cadena no se rinde a la primera** (D13: todo plato se calcula):
 *
 *  1. Un lote con `DISH_MODEL` (o `opts.model`).
 *  2. Los platos que vuelven vacíos se reintentan uno a uno, en paralelo, con
 *     el mismo modelo: en el eval, los fallos venían en lotes enteros.
 *  3. Los que siguen vacíos, con `DISH_FALLBACK_MODEL`, de otra familia.
 *  4. Si todo falla, el plato vuelve `unresolved` con su `failure` y queda en
 *     el log (sin el texto del plato). El caller lo enseña "Calculando…" y lo
 *     reintenta; NUNCA lo rellena con un promedio.
 *
 * Después, cada ingrediente que no casa con la tabla y aporta ≥ 5 % de las kcal
 * pasa por `pickClosestFoods` (el alimento más parecido); los demás se quedan
 * con la mediana de su categoría.
 *
 * El tope DIARIO de gasto no corta esta cadena (sí el mensual): `capScope:
 * "month"`, ver "Tope de gasto en IA" en CLAUDE.md.
 *
 * `userId` es a quién se apunta el gasto (ver `createAiProvider`); `null` solo
 * en el eval, que no corre en nombre de nadie.
 */
export async function decomposeDishes(
  dishes: string[],
  opts: {
    servings?: number;
    apiKey?: string;
    userId: string | null;
    model?: string;
    /** Sin el paso 3 (el eval, para medir un modelo a solas). */
    noFallback?: boolean;
  },
): Promise<Map<string, DishBreakdown>> {
  const servings = Math.max(1, Math.round(opts.servings ?? 1));
  const unique = Array.from(new Set(dishes.map((d) => d.trim()).filter(Boolean)));
  const out = new Map<string, DishBreakdown>();

  const pending: string[] = [];
  for (const dish of unique) {
    const cached = memo.get(memoKey(dish, servings));
    if (cached) out.set(dish, cached);
    else pending.push(dish);
  }
  if (!pending.length) return out;

  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    for (const dish of pending) out.set(dish, { ...empty(dish, servings), failure: "sin-clave" });
    return out;
  }

  const ai = createAiProvider(apiKey, opts.userId, { capScope: "month" });
  const { raws, failures, capped } = await runDecomposeChain({
    dishes: pending,
    ask: (asked, model, timeoutMs) => askModel(ai, model, asked, servings, timeoutMs),
    model: opts.model ?? DISH_MODEL,
    fallbackModel: DISH_FALLBACK_MODEL,
    noFallback: opts.noFallback,
    timeouts: CHAIN_TIMEOUTS,
  });

  // Ingredientes contra la tabla.
  const resolved = new Map<string, ResolvedIngredient[]>();
  for (const [dish, raw] of raws) resolved.set(dish, ingredientsOf(raw, servings));

  // Lo que no casa y pesa: el alimento más parecido de su categoría.
  const heavy: { dish: string; index: number; name: string; category: FoodCategory }[] = [];
  for (const [dish, ingredients] of resolved) {
    for (const index of heavyUnmatched(ingredients)) {
      const ing = ingredients[index];
      if (ing.category) heavy.push({ dish, index, name: ing.name, category: ing.category });
    }
  }
  if (heavy.length && !capped) {
    try {
      const picks = await pickClosestFoods(ai, heavy);
      heavy.forEach((h, i) => {
        const food = picks[i];
        const list = resolved.get(h.dish);
        if (!food || !list) return;
        list[h.index] = { ...list[h.index], food, fallback: "closest" };
      });
    } catch (error) {
      // Se quedan con la mediana de su categoría: sigue siendo un cálculo.
      console.warn("decomposeDishes: desambiguación", failureOf(error));
    }
  }

  const unresolved: DecomposeFailure[] = [];
  for (const dish of pending) {
    const raw = raws.get(dish);
    const ingredients = resolved.get(dish) ?? [];
    if (!raw || !ingredients.length) {
      // "No es comida" y "vago" llegan sin ingredientes y son una respuesta,
      // no un fallo: se distinguen de un plato que no se pudo descomponer (o
      // cuyos ingredientes llegaron todos sin gramos).
      const answered = !!raw && (!raw.comida || raw.vago);
      const failure = answered ? undefined : (failures.get(dish) ?? "sin-respuesta");
      if (failure) unresolved.push(failure);
      out.set(dish, {
        ...empty(dish, servings),
        isFood: raw ? raw.comida : true,
        vague: raw?.vago === true,
        ...(failure ? { failure } : {}),
      });
      continue;
    }
    const macros = macrosOf(ingredients);
    const breakdown: DishBreakdown = {
      dish,
      servings,
      ingredients,
      macros,
      perServing: perServingOf(macros, servings),
      price: priceOf(ingredients),
      quality: resolutionQuality(ingredients),
      isFood: raw.comida,
      vague: false,
      source: "model",
    };
    memo.set(memoKey(dish, servings), breakdown);
    out.set(dish, breakdown);
  }
  if (unresolved.length) {
    // Sin el texto de los platos: es de la persona.
    console.error("decomposeDishes: sin calcular", { count: unresolved.length, unresolved });
  }

  return out;
}

/** Un solo plato. Azúcar sobre `decomposeDishes`. */
export async function dishToIngredients(
  dish: string,
  opts: { servings?: number; apiKey?: string; userId: string | null },
): Promise<DishBreakdown> {
  const servings = Math.max(1, Math.round(opts.servings ?? 1));
  const map = await decomposeDishes([dish], opts);
  return map.get(dish.trim()) ?? empty(dish, servings);
}

/** Vacía el memo del proceso (para los tests y entre perfiles del eval). */
export const _clearDishMemo = () => memo.clear();
