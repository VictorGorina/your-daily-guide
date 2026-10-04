/**
 * Caché GLOBAL de recetas canónicas (`dish_recipes`, ticket 06 de
 * `precision-nutricional`). Un plato se descompone UNA vez para toda la app y
 * a partir de ahí da las mismas cifras a todo el mundo, todos los días.
 *
 *  1. Lee de golpe las recetas de todos los platos pedidos (`in (...)`).
 *  2. Descarta las de un `PIPELINE_VERSION` antiguo que nadie ha revisado y las
 *     que usan una fila que ya no existe.
 *  3. Lo que falta → `decomposeDishes` (ticket 05) → se guarda con
 *     `supabaseAdmin` (invariante 5: solo escribe el servidor).
 *  4. Lo que no se consigue calcular vuelve con `recipe: null`: el llamador lo
 *     enseña "Calculando…" y lo reintenta. Nunca un promedio (D13).
 *
 * Si la tabla no se puede leer, todo funciona igual sin caché persistente
 * (solo la de este proceso) y el error queda en el log.
 *
 * Server-only.
 */

import type { TablesInsert } from "@/integrations/supabase/types";
import type { Deadline } from "@/lib/deadline";
import { errorText, logEvent } from "@/lib/log.server";

import type { RecipeSlot } from "./validate-recipe";
import { dishKey } from "./dish-key";
import {
  canonicalIngredients,
  FOODS_VERSION,
  PIPELINE_VERSION,
  resolvedFromRecipe,
  type CanonicalIngredient,
  type CanonicalRecipe,
  type ServingKind,
} from "./recipe";
import { parseCookingMethods } from "./cooking";
import type { DecomposeFailure, DishBreakdown } from "./resolve-dish.server";

/** Lo que se sabe de un texto de plato tras pasar por la caché. */
export type RecipeLookup = {
  /** El texto tal como se pidió. */
  dish: string;
  key: string;
  /** `null` = aún sin calcular (se reintenta), vago o no es comida. */
  recipe: CanonicalRecipe | null;
  /** "media pizza" = 0,5; `null` si el texto no dice cantidad. */
  textQuantity: number | null;
  vague: boolean;
  isFood: boolean;
  failure?: DecomposeFailure;
  fromCache: boolean;
};

type Row = {
  dish_key: string;
  dish_label: string;
  ingredients: unknown;
  methods: string[] | null;
  serving_kind: string | null;
  unit_label: string | null;
  text_quantity: number | string | null;
  quality: number | string;
  flags: string[] | null;
  pipeline_version: number;
  foods_version: string;
  reviewed: boolean;
};

const COLUMNS =
  "dish_key, dish_label, ingredients, methods, serving_kind, unit_label, text_quantity, quality, " +
  "flags, pipeline_version, foods_version, reviewed";

/** Recetas de este proceso: ahorran releer la tabla y la sustituyen si falla. */
const processCache = new Map<string, RecipeLookup>();

type Lookup = Omit<RecipeLookup, "dish" | "key">;

/**
 * Platos que alguna petición de esta instancia está descomponiendo ahora mismo
 * (ticket 22, PERF-13): otra que pida el mismo espera a esa en vez de pagarlo
 * dos veces. Entre instancias no hay deduplicación; no merece una tabla de
 * bloqueos, y dos recetas del mismo plato son igual de válidas.
 */
const inFlight = new Map<string, Promise<Lookup>>();

const UNRESOLVED: Lookup = {
  recipe: null,
  textQuantity: null,
  vague: false,
  isFood: true,
  failure: "error-modelo",
  fromCache: false,
};

/**
 * Un uso de cada `HITS_SAMPLE` se apunta, sumando `HITS_SAMPLE` (ticket 22):
 * antes era una escritura por lectura sobre las filas más leídas. El recuento
 * queda aproximado, que es para lo que se usa (qué platos revisar primero).
 */
const HITS_SAMPLE = 10;

const numberOr = (v: unknown, fallback: number | null) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : fallback;
};

function recipeFromRow(row: Row): CanonicalRecipe | null {
  const ingredients = (
    Array.isArray(row.ingredients) ? row.ingredients : []
  ) as CanonicalIngredient[];
  if (!ingredients.length) return null;
  const recipe: CanonicalRecipe = {
    dishKey: row.dish_key,
    dishLabel: row.dish_label,
    ingredients,
    methods: parseCookingMethods(row.methods ?? []),
    servingKind: (row.serving_kind === "unidad" ? "unidad" : "plato") as ServingKind,
    unitLabel: row.unit_label,
    quality: numberOr(row.quality, 0)!,
    flags: row.flags ?? [],
    pipelineVersion: row.pipeline_version,
    foodsVersion: row.foods_version,
  };
  // Una fila que ya no existe (una de USDA sin cargar): no se usa a medias.
  return resolvedFromRecipe(recipe) ? recipe : null;
}

function recipeFromBreakdown(key: string, b: DishBreakdown): CanonicalRecipe {
  return {
    dishKey: key,
    dishLabel: b.dish,
    ingredients: canonicalIngredients(b.ingredients),
    methods: b.methods,
    servingKind: b.servingKind,
    unitLabel: b.unitLabel ?? null,
    quality: Math.round(b.quality * 1000) / 1000,
    flags: b.flags,
    pipelineVersion: PIPELINE_VERSION,
    foodsVersion: FOODS_VERSION,
  };
}

/** La fila de `dish_recipes` de una receta recién calculada. */
function recipeRow(key: string, b: DishBreakdown): TablesInsert<"dish_recipes"> {
  const recipe = recipeFromBreakdown(key, b);
  return {
    dish_key: key,
    dish_label: recipe.dishLabel,
    ingredients: recipe.ingredients,
    methods: recipe.methods,
    serving_kind: recipe.servingKind,
    unit_label: recipe.unitLabel ?? null,
    text_quantity: b.textQuantity,
    quality: recipe.quality,
    flags: recipe.flags,
    pipeline_version: recipe.pipelineVersion,
    foods_version: recipe.foodsVersion,
    updated_at: new Date().toISOString(),
  };
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function adminClient(): Promise<Admin | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  } catch (error) {
    console.warn("dish_recipes: sin cliente de servicio", error);
    return null;
  }
}

type GetRecipesOptions = {
  apiKey?: string;
  userId: string | null;
  slots?: ReadonlyMap<string, RecipeSlot>;
  model?: string;
  noCache?: boolean;
  /** Presupuesto de la petición (ticket 22): lo que no quepa vuelve sin receta. */
  deadline?: Deadline;
  /** Quién descompone lo que falta; solo lo cambian los tests (sin red). */
  decompose?: typeof import("./resolve-dish.server").decomposeDishes;
};

/**
 * Descompone los platos que faltan (`texts`: clave → texto) y guarda sus
 * recetas en `db` en cuanto las hay (ticket 22): si la función se corta
 * después (tiempo, un paso que lanza), lo ya pagado queda guardado. Si dos
 * personas piden el mismo plato a la vez, las dos recetas son igual de
 * válidas: gana la última. Una fila revisada a mano nunca se pisa (no llega
 * aquí: una revisada siempre se sirve de la caché).
 *
 * Devuelve lo que se sabe de cada clave. Solo lanza si lanza `decompose` (el
 * de verdad nunca lo hace).
 */
async function decomposeAndSave(
  texts: ReadonlyMap<string, string>,
  opts: GetRecipesOptions,
  db: Admin | null,
): Promise<Map<string, Lookup>> {
  const { decomposeDishes, isCalculated } = await import("./resolve-dish.server");
  const keyOfText = new Map([...texts].map(([key, text]) => [text, key]));

  const saved = new Set<string>();
  const saveRecipes = async (list: readonly DishBreakdown[]) => {
    const rows = list.flatMap((b) => {
      const key = keyOfText.get(b.dish);
      if (!key || saved.has(key)) return [];
      saved.add(key);
      return [recipeRow(key, b)];
    });
    if (!db || !rows.length) return;
    try {
      const { error } = await db.from("dish_recipes").upsert(rows, { onConflict: "dish_key" });
      if (error) console.error("dish_recipes: escritura", error);
    } catch (error) {
      console.error("dish_recipes: escritura", error);
    }
  };

  const breakdowns = await (opts.decompose ?? decomposeDishes)([...texts.values()], {
    apiKey: opts.apiKey,
    userId: opts.userId,
    model: opts.model,
    slots: opts.slots,
    deadline: opts.deadline,
    onCalculated: saveRecipes,
  });

  const found = new Map<string, Lookup>();
  const calculatedList: DishBreakdown[] = [];
  for (const [key, text] of texts) {
    const b: DishBreakdown | undefined = breakdowns.get(text);
    // En un booleano, sin estrechar `b`: en la rama de "sin calcular" hace falta
    // leer si era vago o no era comida.
    const calculated = (isCalculated as (x: unknown) => boolean)(b);
    if (!b || !calculated) {
      found.set(key, {
        recipe: null,
        textQuantity: null,
        vague: b?.vague === true,
        isFood: b ? b.isFood : true,
        ...(b?.failure ? { failure: b.failure } : {}),
        fromCache: false,
      });
      continue;
    }
    found.set(key, {
      recipe: recipeFromBreakdown(key, b),
      textQuantity: b.textQuantity,
      vague: false,
      isFood: true,
      fromCache: false,
    });
    calculatedList.push(b);
  }

  // Lo que necesitó los pasos de después de la cadena (y lo de un `decompose`
  // que no avise por el camino).
  await saveRecipes(calculatedList);
  return found;
}

/**
 * Las recetas de varios platos, de la caché o calculándolas. Nunca lanza.
 *
 * `slots` (comida de cada plato) solo se usa al calcular uno nuevo: la receta
 * guardada es la misma se coma cuando se coma. `noCache` = el eval, que mide el
 * pipeline y no la caché.
 */
export async function getRecipes(
  dishes: readonly string[],
  opts: GetRecipesOptions,
): Promise<Map<string, RecipeLookup>> {
  const out = new Map<string, RecipeLookup>();
  const byKey = new Map<string, string[]>();
  for (const raw of dishes) {
    const dish = raw.trim();
    if (!dish || out.has(dish)) continue;
    const key = dishKey(dish);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), dish]);
  }
  const fill = (key: string, lookup: Omit<RecipeLookup, "dish" | "key">) => {
    for (const dish of byKey.get(key) ?? []) out.set(dish, { ...lookup, dish, key });
  };

  // Las filas de USDA (ticket 22) antes de leer recetas que las usen.
  const { ensureExtraFoods } = await import("./usda.server");
  await ensureExtraFoods();

  // 1-2. La caché.
  const admin = opts.noCache ? null : await adminClient();
  let tableOk = !!admin;
  const cachedKeys: string[] = [];
  if (admin && byKey.size) {
    const { data, error } = await admin
      .from("dish_recipes")
      .select(COLUMNS)
      .in("dish_key", [...byKey.keys()]);
    if (error) {
      tableOk = false;
      console.error("dish_recipes: lectura", error);
    }
    for (const row of (data ?? []) as unknown as Row[]) {
      const fresh = row.reviewed || row.pipeline_version === PIPELINE_VERSION;
      const recipe = fresh ? recipeFromRow(row) : null;
      if (!recipe) continue;
      cachedKeys.push(row.dish_key);
      fill(row.dish_key, {
        recipe,
        textQuantity: numberOr(row.text_quantity, null),
        vague: false,
        isFood: true,
        fromCache: true,
      });
    }
  }
  if (!tableOk && !opts.noCache) {
    for (const key of byKey.keys()) {
      const hit = processCache.get(key);
      if (hit && !out.has(byKey.get(key)![0]!)) fill(key, { ...hit, fromCache: true });
    }
  }

  // Los usos de cada receta servida, por muestreo y sin esperar: priorizan la
  // revisión manual.
  if (admin && tableOk && cachedKeys.length && Math.random() < 1 / HITS_SAMPLE) {
    // `rpc` casi nunca rechaza: el fallo llega como `{ error }`, así que se mira también.
    void Promise.resolve(
      admin.rpc("increment_dish_recipe_hits", { _keys: cachedKeys, _by: HITS_SAMPLE }),
    )
      .then(({ error }) => {
        if (error) logEvent("warn", "recipe_hits_failed", { error: errorText(error) });
      })
      .catch((error) => logEvent("warn", "recipe_hits_failed", { error: errorText(error) }));
  }

  // 3. Lo que falta, con el pipeline del ticket 05. Lo que ya descompone otra
  //    petición de esta instancia se espera; lo demás se registra en vuelo.
  const missing = [...byKey.keys()].filter((key) => !out.has(byKey.get(key)![0]!));
  if (!missing.length) return out;
  const shared = opts.noCache ? [] : missing.filter((key) => inFlight.has(key));
  const waited = Promise.all(
    shared.map(async (key) => fill(key, { ...(await inFlight.get(key)!), fromCache: false })),
  );
  const texts = new Map(
    missing.filter((key) => !shared.includes(key)).map((key) => [key, byKey.get(key)![0]!]),
  );
  const done = new Map<string, (lookup: Lookup) => void>();
  if (!opts.noCache) {
    for (const key of texts.keys()) {
      inFlight.set(key, new Promise((resolve) => done.set(key, resolve)));
    }
  }
  let found = new Map<string, Lookup>();
  try {
    if (texts.size) found = await decomposeAndSave(texts, opts, admin && tableOk ? admin : null);
  } finally {
    // También si `decompose` lanza: quien espera no se queda colgado.
    for (const [key, resolve] of done) {
      resolve(found.get(key) ?? UNRESOLVED);
      inFlight.delete(key);
    }
  }
  for (const [key, lookup] of found) {
    fill(key, lookup);
    if (lookup.recipe && !opts.noCache) {
      processCache.set(key, { ...lookup, dish: texts.get(key)!, key });
    }
  }
  await waited;
  return out;
}
