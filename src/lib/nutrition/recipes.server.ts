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
 * Mientras la migración `dish_recipes` no esté aplicada, la tabla no existe
 * (PGRST205): se avisa una vez y todo funciona igual, sin caché persistente
 * (solo la de este proceso).
 *
 * Server-only.
 */

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

/** Tabla sin crear (migración pendiente): PostgREST responde PGRST205; Postgres, 42P01. */
const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST205" || code === "42P01";
};

let warnedMissing = false;
const warnMissing = () => {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn("dish_recipes: la tabla no existe todavía (migración pendiente); sin caché global");
};

/** Recetas de este proceso: sustituyen a la tabla mientras no exista. */
const processCache = new Map<string, RecipeLookup>();

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

/**
 * Las recetas de varios platos, de la caché o calculándolas. Nunca lanza.
 *
 * `slots` (comida de cada plato) solo se usa al calcular uno nuevo: la receta
 * guardada es la misma se coma cuando se coma. `noCache` = el eval, que mide el
 * pipeline y no la caché.
 */
export async function getRecipes(
  dishes: readonly string[],
  opts: {
    apiKey?: string;
    userId: string | null;
    slots?: ReadonlyMap<string, RecipeSlot>;
    model?: string;
    noCache?: boolean;
  },
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
      .from("dish_recipes" as never)
      .select(COLUMNS)
      .in("dish_key", [...byKey.keys()]);
    if (error) {
      tableOk = false;
      if (isMissingTable(error)) warnMissing();
      else console.error("dish_recipes: lectura", error);
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

  // Un uso más de cada receta servida, sin esperar: prioriza la revisión manual.
  if (admin && tableOk && cachedKeys.length) {
    void Promise.resolve(
      admin.rpc("increment_dish_recipe_hits" as never, { _keys: cachedKeys } as never),
    ).catch(() => {});
  }

  // 3. Lo que falta, con el pipeline del ticket 05.
  const missingKeys = [...byKey.keys()].filter((key) => !out.has(byKey.get(key)![0]!));
  if (!missingKeys.length) return out;

  const { decomposeDishes, isCalculated } = await import("./resolve-dish.server");
  const texts = missingKeys.map((key) => byKey.get(key)![0]!);
  const breakdowns = await decomposeDishes(texts, {
    apiKey: opts.apiKey,
    userId: opts.userId,
    model: opts.model,
    slots: opts.slots,
  });

  const rows: Record<string, unknown>[] = [];
  for (const key of missingKeys) {
    const text = byKey.get(key)![0]!;
    const b: DishBreakdown | undefined = breakdowns.get(text);
    // En un booleano, sin estrechar `b`: en la rama de "sin calcular" hace falta
    // leer si era vago o no era comida.
    const calculated = (isCalculated as (x: unknown) => boolean)(b);
    if (!b || !calculated) {
      fill(key, {
        recipe: null,
        textQuantity: null,
        vague: b?.vague === true,
        isFood: b ? b.isFood : true,
        ...(b?.failure ? { failure: b.failure } : {}),
        fromCache: false,
      });
      continue;
    }
    const recipe = recipeFromBreakdown(key, b);
    const lookup = {
      recipe,
      textQuantity: b.textQuantity,
      vague: false,
      isFood: true,
      fromCache: false,
    };
    fill(key, lookup);
    if (!opts.noCache) processCache.set(key, { ...lookup, dish: text, key });
    rows.push({
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
    });
  }

  // Guardar. Si dos personas piden el mismo plato a la vez, las dos recetas son
  // igual de válidas: gana la última. Una fila revisada a mano nunca se pisa
  // (no llega aquí: una revisada siempre se sirve de la caché).
  if (admin && tableOk && rows.length) {
    const { error } = await admin
      .from("dish_recipes" as never)
      .upsert(rows as never, { onConflict: "dish_key" });
    if (error && !isMissingTable(error)) console.error("dish_recipes: escritura", error);
  }
  return out;
}
