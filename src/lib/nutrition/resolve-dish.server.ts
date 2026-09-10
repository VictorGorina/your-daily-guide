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

import { COACH_MODEL, createAiProvider } from "@/lib/ai-provider.server";
import { normName, parseJsonLoose } from "@/lib/plan-shared";

import { FOOD_KEYS } from "./foods.data";
import {
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
  source: "model" | "unresolved";
};

const empty = (dish: string, servings: number): DishBreakdown => ({
  dish,
  servings,
  ingredients: [],
  macros: { ...ZERO },
  perServing: { ...ZERO },
  price: 0,
  quality: 0,
  source: "unresolved",
});

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
  "pan ≈ 60 g; aceite para cocinar ≈ 10 g; fruta de postre ≈ 150 g; yogur ≈ 125 g.";

/**
 * Descompone varios platos en una sola llamada al modelo. Devuelve un mapa
 * indexado por el string de plato tal como se pasó. Nunca lanza: un fallo del
 * modelo devuelve el plato como `unresolved` y el caller decide el respaldo.
 */
export async function decomposeDishes(
  dishes: string[],
  opts: { servings?: number; apiKey?: string } = {},
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
    for (const dish of pending) out.set(dish, empty(dish, servings));
    return out;
  }

  try {
    const ai = createAiProvider(apiKey);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      temperature: 0,
      prompt:
        `Descompón cada plato en sus ingredientes, con la cantidad en GRAMOS para ${servings} ` +
        `ración(es) EN TOTAL. Platos:\n${pending.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\n` +
        'Devuelve SOLO JSON: {"platos": [{"plato": string (igual que te lo doy), ' +
        '"ingredientes": [{"key": string|null, "name": string, "gramos": number}]}]}\n' +
        `- "key": una de esta lista SOLO si encaja de verdad; si no, null:\n${FOOD_KEYS.join(", ")}\n` +
        '- "name": ingrediente en español, singular, sin marca (p. ej. "pechuga de pollo")\n' +
        `- "gramos": gramos TOTALES para las ${servings} raciones, tal como se come ` +
        "(arroz, pasta y legumbre en COCIDO). Incluye el aceite de cocinar y los básicos con peso real.\n" +
        `${RATION_ANCHORS}\n` +
        "Sin markdown, sin texto alrededor.",
    });

    const parsed = parseJsonLoose(text) as { platos?: unknown };
    const rows = Array.isArray(parsed?.platos) ? parsed.platos : [];
    const byNorm = new Map<string, ResolvedIngredient[]>();
    for (const row of rows) {
      const r = (row ?? {}) as { plato?: unknown; ingredientes?: unknown };
      const label = String(r.plato ?? "").trim();
      if (!label) continue;
      const rawList = Array.isArray(r.ingredientes) ? r.ingredientes : [];
      const ingredients = rawList
        .slice(0, 30)
        .map((raw) => {
          const o = (raw ?? {}) as Record<string, unknown>;
          return resolveIngredient({
            key: o.key as string,
            name: o.name as string,
            grams: o.gramos,
          });
        })
        .filter((ing) => ing.grams > 0);
      byNorm.set(normName(label), ingredients);
    }

    for (const dish of pending) {
      const ingredients = byNorm.get(normName(dish)) ?? [];
      if (!ingredients.length) {
        out.set(dish, empty(dish, servings));
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
        source: "model",
      };
      memo.set(memoKey(dish, servings), breakdown);
      out.set(dish, breakdown);
    }
  } catch (error) {
    console.error("decomposeDishes", error);
    for (const dish of pending) if (!out.has(dish)) out.set(dish, empty(dish, servings));
  }

  return out;
}

/** Un solo plato. Azúcar sobre `decomposeDishes`. */
export async function dishToIngredients(
  dish: string,
  opts: { servings?: number; apiKey?: string } = {},
): Promise<DishBreakdown> {
  const servings = Math.max(1, Math.round(opts.servings ?? 1));
  const map = await decomposeDishes([dish], opts);
  return map.get(dish.trim()) ?? empty(dish, servings);
}

/** Vacía el memo del proceso (para los tests y entre perfiles del eval). */
export const _clearDishMemo = () => memo.clear();
