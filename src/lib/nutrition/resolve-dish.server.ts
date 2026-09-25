/**
 * Receta canónica de un plato (ticket 05 de `precision-nutricional`): la ÚNICA
 * llamada al modelo de todo el pipeline de nutrición. El modelo hace lo que
 * sabe hacer — reconocer de qué está hecho un plato ("shakshuka" → huevo,
 * tomate, pimiento…) y clasificar su método de cocción —; los números los pone
 * el código:
 *
 *  1. Una lectura con salida ESTRUCTURADA (`Output.object` + Zod): UNA ración
 *     base de AESAN en gramos crudos. Sin `parseJsonLoose` ni lotes que vuelven
 *     vacíos sin error.
 *  2. Casado contra la tabla (`resolveIngredient`): lo crudo va contra la fila
 *     en seco o se convierte con el rendimiento de la fila.
 *  3. La grasa de cocinar la pone `OIL_BY_METHOD` (`applyCookingFat`).
 *  4. `validateRecipe` recorta lo que se sale de la ración y, si falta algo que
 *     el nombre dice, pide UN reintento con la pista.
 *  5. Lo que no casa con seguridad y pesa: el alimento más parecido de su
 *     categoría (ticket 13).
 *  6. Calidad ponderada por kcal ≥ `MIN_RECIPE_QUALITY` o el plato no se da por
 *     calculado (D13: se reintenta, nunca un promedio).
 *
 * Server-only (`ai`, `OPENROUTER_API_KEY`). Se carga con `await import()` desde
 * las server functions, igual que el resto de `*.server`.
 */

import { generateText, Output } from "ai";
import { z } from "zod";

import {
  createAiProvider,
  DISAMBIGUATION_MODEL,
  DISH_FALLBACK_MODEL,
  DISH_MODEL,
} from "@/lib/ai-provider.server";
import { parseJsonLoose } from "@/lib/plan-shared";

import { COOKING_METHODS, parseCookingMethods, type CookingMethod } from "./cooking";
import {
  CHAIN_TIMEOUTS,
  failureOf,
  matchAnswer,
  rawDishesOf,
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
  MIN_RECIPE_QUALITY,
  priceOf,
  resolutionQuality,
  resolveIngredient,
  ZERO,
  type Macros,
  type ResolvedIngredient,
} from "./nutrition";
import type { ServingKind } from "./recipe";
import { applyCookingFat, validateRecipe, type RecipeSlot } from "./validate-recipe";

export type DishBreakdown = {
  dish: string;
  /** Siempre 1: la receta es UNA ración base (o una pieza, ver `servingKind`). */
  servings: number;
  ingredients: ResolvedIngredient[];
  /** Macros de la ración base. */
  macros: Macros;
  /** Igual que `macros` (una ración); se mantiene por los llamadores. */
  perServing: Macros;
  /** Precio orientativo (€) de los ingredientes de la ración base. */
  price: number;
  /** 0-1, parte de las kcal que sale de ingredientes identificados. */
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
  /** Método(s) de cocción: deciden la grasa (`OIL_BY_METHOD`). */
  methods: CookingMethod[];
  /** "unidad" = se come por piezas (una pizza pesa lo que pesa, ticket 17). */
  servingKind: ServingKind;
  unitLabel?: string | null;
  /** Lo que dice el texto respecto a una ración ("media pizza" = 0,5); `null` si nada. */
  textQuantity: number | null;
  /** Flags de `validateRecipe` (recortes, inventados, fuera de banda…). */
  flags: string[];
};

export type { DecomposeFailure };

const empty = (dish: string): DishBreakdown => ({
  dish,
  servings: 1,
  ingredients: [],
  macros: { ...ZERO },
  perServing: { ...ZERO },
  price: 0,
  quality: 0,
  isFood: true,
  vague: false,
  source: "unresolved",
  methods: [],
  servingKind: "plato",
  textQuantity: null,
  flags: [],
});

/**
 * ¿Sale de su receta? Es la ÚNICA definición de "calculado" (D13): un plato
 * con receta se cuenta aunque parte de sus ingredientes sean el alimento más
 * parecido; uno sin receta no se rellena con ningún promedio. 0 kcal vale (un
 * refresco sin azúcar), lo que decide es que se haya entendido.
 */
export const isCalculated = (b: DishBreakdown | null | undefined): b is DishBreakdown =>
  !!b && b.source === "model" && b.ingredients.length > 0;

// ---------------------------------------------------------------------------
// El prompt y el esquema
// ---------------------------------------------------------------------------

/**
 * Ración base: AESAN 2022, punto medio (decisión del usuario del 2026-09-24,
 * memoria `reference-ration-aesan-midpoint`), dicha EN CRUDO como pide la
 * receta canónica (D8). El aceite no va: lo pone el código por el método.
 */
const RATION_ANCHORS =
  "RACIÓN BASE por persona (AESAN 2022), en crudo: legumbre 60 g en seco; arroz o pasta 70 g " +
  "en seco; cuscús o quinoa 60 g en seco; carne 110 g cruda; pescado 135 g crudo; huevo: 1 " +
  "(50 g) si acompaña o va en una tostada, 2 (100 g) si el huevo ES el plato (tortilla, " +
  "revuelto), salvo que el nombre diga otro número; pan 50 g; patata 150-200 g; verdura de " +
  "guarnición 150-200 g; fruta de postre 150 g (una pieza), pero troceada encima de un yogur, " +
  "avena o tostada 60 g (una naranja o mandarina se come aparte, entera); yogur 125 g; leche " +
  "200 ml; frutos secos 25 g; queso 30-40 g. " +
  "La ración es POR PLATO: si el plato junta dos bases de hidrato (legumbre con arroz, legumbre " +
  "con patata, arroz como guarnición de un curry), repártelas entre las dos, no pongas una " +
  "ración entera de cada una. " +
  "Guisos, sopas y cremas: incluye el líquido que queda en el plato (agua o caldo) con su peso. " +
  "Cremas y purés: la verdura que nombra el plato, SIN añadir patata si el nombre no la dice. " +
  // "Onza" de chocolate en España es un cuadradito de la tableta, no la onza
  // anglosajona: sin decirlo, el modelo daba 57 g para "dos onzas".
  "Picoteo: puñado de frutos secos 25 g; galleta 10 g cada una; onza de chocolate = un " +
  "cuadradito de la tableta, 7 g (NO la onza inglesa de 28 g); bolsa pequeña de patatas 40 g; " +
  "caña de cerveza 200 g; tercio 330 g; copa de vino 150 g; copa de licor 50 g; bola de " +
  "helado 60 g.";

const METHODS_HELP =
  '"metodos": 1 método de cocción, o 2 si el plato junta dos preparaciones (ensalada + pollo a ' +
  "la plancha). cruda = nada se cocina (fruta, yogur, bocadillo frío); alinada = ensalada o " +
  "verdura con aliño de aceite; untada = pan o tostada con aceite o mantequilla untados; " +
  "plancha; horno; salteado = sartén o wok con poco aceite, revueltos y tortillas francesas o " +
  "de verdura; guiso = guisos, estofados, cremas, sofritos, arroces y legumbres guisadas; " +
  "hervido = hervido o al vapor, sin sofrito; frito_rebozado = SOLO fritura en mucho aceite " +
  "(rebozados, empanados, croquetas, patatas fritas, tortilla de patatas).";

function decomposePrompt(dishes: string[], hint?: string): string {
  return (
    "Da la receta de cada plato para UNA ración base de un adulto. Platos:\n" +
    dishes.map((d, i) => `${i + 1}. ${d}`).join("\n") +
    "\n\n" +
    '- "plato": igual que te lo doy.\n' +
    '- "comida": true para cualquier plato, alimento o bebida, por raro, casero o poco ' +
    "saludable que sea. false SOLO si es una broma, un insulto o algo que no se come; en ese " +
    "caso, sin ingredientes.\n" +
    '- "vago": true SOLO si el texto no permite saber qué se comió ("algo rápido", "lo de ' +
    'siempre", "lo que había"); en ese caso, sin ingredientes. Un plato genérico pero ' +
    'reconocible ("un bocadillo", "ensalada", "pasta") NO es vago: da el más habitual.\n' +
    `- ${METHODS_HELP}\n` +
    '- "tipo_racion": "unidad" si se come por piezas que no se sirven al gusto (pizza ' +
    'individual, hamburguesa completa, bocadillo, kebab, croissant, menú del día); "plato" ' +
    'para lo que se sirve en plato. "unidad": la pieza en palabras o null.\n' +
    '- "cantidad_texto": si el texto dice cuánto se comió respecto a UNA ración o pieza ' +
    '("media pizza" 0.5, "dos platos de lentejas" 2, "un plato pequeño" 0.75), ese número; si ' +
    "no dice nada, null. La receta es SIEMPRE de 1 ración o 1 pieza: no multipliques tú.\n" +
    '- "ingredientes": solo los que tienen peso real (una pizca de sal o de especias no ' +
    "cuenta). Un producto que se compra ya hecho (patatas de bolsa, galletas, bollería, " +
    "helado, chocolatina, refresco, cerveza, pizza o croquetas compradas) es UN ingrediente " +
    "con su key: no lo descompongas. Un plato casero, sí.\n" +
    '  - "gramos": EN CRUDO: arroz, pasta, cuscús, quinoa y legumbre EN SECO; carne y pescado ' +
    "crudos; verdura cruda y limpia. Lo que se compra hecho (pan, conservas, legumbre de bote, " +
    "embutido, queso, yogur, productos preparados), con su peso tal cual.\n" +
    '  - "estado": "crudo" si los gramos son el peso antes de cocinar; "listo" si son el peso ' +
    'tal como se come o se compra hecho (y cuando el texto lo dice así: "130 g de pollo a la ' +
    'plancha").\n' +
    '  - "es_grasa_de_cocinar": true para el aceite, la mantequilla o la manteca con que se ' +
    "cocina, se aliña o se unta. Ponla si se usa: la cantidad la ajusta el sistema.\n" +
    `  - "key": una de esta lista SOLO si encaja de verdad; si no, null:\n${FOOD_KEYS.join(", ")}\n` +
    '  - "nombre": en español, singular, sin marca ("pechuga de pollo").\n' +
    '  - "categoria": el tipo de alimento que es, aunque su key sea null.\n' +
    `${RATION_ANCHORS}\n` +
    (hint ? `\nCORRIGE ESTO respecto a tu respuesta anterior: ${hint}\n` : "")
  );
}

const IngredientSchema = z.object({
  nombre: z.string(),
  key: z.string().nullable(),
  categoria: z.enum(FOOD_CATEGORIES as [FoodCategory, ...FoodCategory[]]),
  gramos: z.number(),
  estado: z.enum(["crudo", "listo"]),
  es_grasa_de_cocinar: z.boolean(),
});

const DecompositionSchema = z.object({
  platos: z.array(
    z.object({
      plato: z.string(),
      comida: z.boolean(),
      vago: z.boolean(),
      metodos: z.array(z.enum(COOKING_METHODS)),
      tipo_racion: z.enum(["plato", "unidad"]),
      unidad: z.string().nullable(),
      cantidad_texto: z.number().nullable(),
      ingredientes: z.array(IngredientSchema),
    }),
  ),
});

type Provider = ReturnType<typeof createAiProvider>;

/** Una llamada al modelo para varios platos (el `ask` de la cadena). */
async function askModel(
  ai: Provider,
  model: string,
  dishes: string[],
  timeoutMs: number,
  hint?: string,
): Promise<Map<string, RawDish>> {
  const { output } = await generateText({
    model: ai(model),
    temperature: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
    output: Output.object({ schema: DecompositionSchema, name: "recetas" }),
    prompt: decomposePrompt(dishes, hint),
  });
  return rawDishesOf(output);
}

// ---------------------------------------------------------------------------
// Del modelo a la receta validada
// ---------------------------------------------------------------------------

const DISAMBIGUATION_TIMEOUT_MS = 20_000;

/**
 * Pide al modelo barato el alimento de la tabla más parecido a cada
 * ingrediente que no casó con seguridad. El modelo solo elige un número de una
 * lista cerrada de su categoría: nunca escribe una cifra (invariante 1). Si
 * falla, cada ingrediente se queda como estaba.
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

type Draft = {
  raw: RawDish;
  ingredients: ResolvedIngredient[];
  methods: CookingMethod[];
  flags: string[];
  retryHint?: string;
};

const stateOf = (raw: unknown): "crudo" | "listo" => (raw === "crudo" ? "crudo" : "listo");

/** RawDish → ingredientes casados, con la grasa por método y validados. */
function draftOf(dish: string, raw: RawDish, slot: RecipeSlot): Draft {
  const rows = raw.ingredientes;
  const resolved: ResolvedIngredient[] = [];
  const fatFlags: boolean[] = [];
  for (const o of rows) {
    const ing = resolveIngredient({
      key: (o.key as string | null) ?? null,
      name: String(o.nombre ?? o.name ?? ""),
      grams: o.gramos,
      state: stateOf(o.estado),
      category: o.categoria,
    });
    if (ing.grams <= 0) continue;
    resolved.push(ing);
    fatFlags.push(o.es_grasa_de_cocinar === true);
  }
  const methods = parseCookingMethods(raw.metodos);
  const fat = applyCookingFat(resolved, methods, dish, fatFlags);
  const validated = validateRecipe(fat.ingredients, dish, slot);
  return {
    raw,
    ingredients: validated.ingredients,
    methods,
    flags: [...(fat.changed ? ["grasa_por_metodo"] : []), ...validated.flags],
    retryHint: validated.retryHint,
  };
}

const flagsWeight = (d: Draft) => (d.retryHint ? 1 : 0);

/**
 * Lo que no casó con seguridad y pesa (≥ 5 % de las kcal):
 *
 *  1. Si no casó con NADA: su composición de USDA (ticket 22), que queda como
 *     fila para toda la app.
 *  2. Lo que siga dudoso: el alimento más parecido de su categoría (ticket 13).
 *  3. Si con eso la calidad no llega, también lo dudoso ligero.
 *
 * Muta los drafts.
 */
async function resolveUnsure(ai: Provider, drafts: Map<string, Draft>): Promise<void> {
  // 1. USDA para lo que no casó con nada (sin clave, no hace nada).
  const unmatched: { dish: string; index: number; name: string; category: FoodCategory }[] = [];
  for (const [dish, draft] of drafts) {
    for (const index of heavyUnmatched(draft.ingredients)) {
      const ing = draft.ingredients[index]!;
      if ((ing.fallback === "category" || ing.fallback === "generic") && ing.category) {
        unmatched.push({ dish, index, name: ing.name, category: ing.category });
      }
    }
  }
  if (unmatched.length) {
    const { resolveWithUsda } = await import("./usda.server");
    const foods = await resolveWithUsda(ai, unmatched.slice(0, 6));
    foods.forEach((food, i) => {
      const it = unmatched[i]!;
      const list = drafts.get(it.dish)?.ingredients;
      if (!food || !list) return;
      list[it.index] = { ...list[it.index]!, food, fallback: "usda", confidence: "low" };
    });
  }

  const collect = (onlyHeavy: boolean) => {
    const items: { dish: string; index: number; name: string; category: FoodCategory }[] = [];
    for (const [dish, draft] of drafts) {
      const indexes = onlyHeavy
        ? heavyUnmatched(draft.ingredients)
        : draft.ingredients
            .map((ing, i) => ({ ing, i }))
            .filter(
              ({ ing }) =>
                ing.fallback === "category" || (!ing.fallback && ing.confidence === "low"),
            )
            .map(({ i }) => i);
      for (const index of indexes) {
        const ing = draft.ingredients[index]!;
        const category = ing.category ?? ing.food.category;
        items.push({ dish, index, name: ing.name, category });
      }
    }
    return items;
  };
  const apply = async (items: ReturnType<typeof collect>) => {
    if (!items.length) return;
    try {
      const picks = await pickClosestFoods(ai, items);
      items.forEach((it, i) => {
        const food = picks[i];
        const list = drafts.get(it.dish)?.ingredients;
        if (!food || !list) return;
        const ing = list[it.index]!;
        list[it.index] = { ...ing, food, fallback: "closest", confidence: "low" };
      });
    } catch (error) {
      console.warn("decomposeDishes: desambiguación", failureOf(error));
    }
  };

  await apply(collect(true));
  // Si aun así alguna receta no llega a la calidad mínima (varios dudosos
  // ligeros que suman), se resuelven también los ligeros de esas recetas.
  const short = new Map(
    [...drafts].filter(([, d]) => resolutionQuality(d.ingredients) < MIN_RECIPE_QUALITY),
  );
  if (short.size) {
    const items = collect(false).filter((it) => short.has(it.dish));
    await apply(items);
  }
}

const quantityOf = (raw: unknown): number | null => {
  const n = Number(raw);
  return raw != null && Number.isFinite(n) && n > 0
    ? Math.min(10, Math.round(n * 100) / 100)
    : null;
};

/**
 * Descompone varios platos en su receta canónica (1 ración base). Devuelve un
 * mapa indexado por el string de plato tal como se pasó. Nunca lanza.
 *
 * **La cadena no se rinde a la primera** (D13, ticket 13): lote → uno a uno →
 * `DISH_FALLBACK_MODEL` de otra familia. Después, cada receta pasa por
 * `validateRecipe` y, si pide reintento (falta algo que el nombre dice, masa
 * imposible), se le pide UNA vez más al mismo modelo con la pista; se queda la
 * versión que valida mejor.
 *
 * `slot` es la comida a la que pertenecen (para la masa y la banda de kcal);
 * `null` si no se sabe.
 *
 * El tope DIARIO de gasto no corta esta cadena (sí el mensual): `capScope:
 * "month"`, ver "Tope de gasto en IA" en CLAUDE.md. `userId` es a quién se
 * apunta el gasto; `null` solo en el eval.
 */
export async function decomposeDishes(
  dishes: string[],
  opts: {
    apiKey?: string;
    userId: string | null;
    model?: string;
    /** Sin el modelo de respaldo (el eval, para medir un modelo a solas). */
    noFallback?: boolean;
    slot?: RecipeSlot;
    /** Comida de cada plato, si se sabe (gana a `slot`). */
    slots?: ReadonlyMap<string, RecipeSlot>;
  },
): Promise<Map<string, DishBreakdown>> {
  const unique = Array.from(new Set(dishes.map((d) => d.trim()).filter(Boolean)));
  const out = new Map<string, DishBreakdown>();
  const slotOf = (dish: string): RecipeSlot => opts.slots?.get(dish) ?? opts.slot ?? null;

  // Sin memo: la caché, global y persistente, es `dish_recipes` (ticket 06,
  // `getRecipes` en `recipes.server.ts`). Esto siempre descompone.
  const pending = unique;
  if (!pending.length) return out;

  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    for (const dish of pending) out.set(dish, { ...empty(dish), failure: "sin-clave" });
    return out;
  }

  const ai = createAiProvider(apiKey, opts.userId, { capScope: "month" });
  const model = opts.model ?? DISH_MODEL;
  const { raws, failures, capped } = await runDecomposeChain({
    dishes: pending,
    ask: (asked, stepModel, timeoutMs) => askModel(ai, stepModel, asked, timeoutMs),
    model,
    fallbackModel: DISH_FALLBACK_MODEL,
    noFallback: opts.noFallback,
    timeouts: CHAIN_TIMEOUTS,
  });

  // Receta casada, con grasa por método y validada.
  const drafts = new Map<string, Draft>();
  for (const [dish, raw] of raws) {
    if (!raw.comida || raw.vago || !raw.ingredientes.length) continue;
    drafts.set(dish, draftOf(dish, raw, slotOf(dish)));
  }

  // UN reintento con pista para las que lo piden. Se queda la que valida mejor.
  const retries = [...drafts].filter(([, d]) => d.retryHint);
  if (retries.length && !capped) {
    await Promise.all(
      retries.map(async ([dish, draft]) => {
        try {
          const answer = await askModel(ai, model, [dish], CHAIN_TIMEOUTS.single, draft.retryHint);
          // Igual que la cadena: tolera la etiqueta con el número de la lista.
          const raw = matchAnswer([dish], answer).get(dish);
          if (!raw || !raw.ingredientes.length) return;
          const second = draftOf(dish, raw, slotOf(dish));
          if (flagsWeight(second) <= flagsWeight(draft)) drafts.set(dish, second);
        } catch (error) {
          console.warn("decomposeDishes: reintento con pista", failureOf(error));
        }
      }),
    );
  }

  if (!capped) await resolveUnsure(ai, drafts);

  const unresolved: DecomposeFailure[] = [];
  for (const dish of pending) {
    const raw = raws.get(dish);
    const draft = drafts.get(dish);
    const quality = draft ? resolutionQuality(draft.ingredients) : 0;
    if (!raw || !draft || !draft.ingredients.length || quality < MIN_RECIPE_QUALITY) {
      // "No es comida" y "vago" llegan sin ingredientes y son una respuesta,
      // no un fallo: se distinguen de un plato que no se pudo descomponer.
      const answered = !!raw && (!raw.comida || raw.vago);
      const failure: DecomposeFailure | undefined = answered
        ? undefined
        : draft?.ingredients.length
          ? "calidad-baja"
          : (failures.get(dish) ?? "sin-respuesta");
      if (failure) unresolved.push(failure);
      out.set(dish, {
        ...empty(dish),
        isFood: raw ? raw.comida : true,
        vague: raw?.vago === true,
        ...(failure ? { failure } : {}),
      });
      continue;
    }
    const macros = macrosOf(draft.ingredients);
    const breakdown: DishBreakdown = {
      dish,
      servings: 1,
      ingredients: draft.ingredients,
      macros,
      perServing: macros,
      price: priceOf(draft.ingredients),
      quality,
      isFood: raw.comida,
      vague: false,
      source: "model",
      methods: draft.methods,
      servingKind: raw.tipo_racion === "unidad" ? "unidad" : "plato",
      unitLabel: typeof raw.unidad === "string" && raw.unidad.trim() ? raw.unidad.trim() : null,
      textQuantity: quantityOf(raw.cantidad_texto),
      flags: draft.flags,
    };
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
  opts: { apiKey?: string; userId: string | null; slot?: RecipeSlot },
): Promise<DishBreakdown> {
  const map = await decomposeDishes([dish], opts);
  return map.get(dish.trim()) ?? empty(dish);
}
