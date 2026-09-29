/**
 * I/O de los ingredientes desde USDA FoodData Central (ticket 22 de
 * `precision-nutricional`). La lógica pura, testeada, está en `usda.ts`.
 *
 * - La traducción a una consulta en inglés y la elección entre candidatos las
 *   hace `DISAMBIGUATION_MODEL` (el barato): solo texto y un número de una lista
 *   cerrada, nunca una cifra.
 * - La API va con `USDA_FDC_API_KEY` (servidor; cuota gratuita de 1.000
 *   peticiones por hora). Sin clave, no se busca: se queda el "más parecido".
 * - Lo encontrado se guarda en `foods_extra` (global, solo escribe el servidor)
 *   y se registra en el proceso (`registerExtraFoods`): a partir de ahí es una
 *   fila más de la tabla. `ensureExtraFoods` las carga en el proceso (y las
 *   relee cada 10 min), que es lo que permite volver a sumar una receta guardada
 *   que las usa.
 *
 * Server-only.
 */

import { generateText } from "ai";

import { DISAMBIGUATION_MODEL, type createAiProvider } from "@/lib/ai-provider.server";
import { errorText, logEvent } from "@/lib/log.server";
import { parseJsonLoose } from "@/lib/plan-shared";

import type { Food, FoodCategory } from "./foods.data";
import { registerExtraFoods } from "./nutrition";
import { lookupUsdaFood, type UsdaCandidate } from "./usda";

type Provider = ReturnType<typeof createAiProvider>;

const SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const TIMEOUT_MS = 15_000;

/**
 * Lo que puede tardar una búsqueda en USDA (traducir, buscar y elegir, en
 * serie): con un presupuesto de petición (ticket 22) no se empieza sin esto.
 */
export const USDA_LOOKUP_MS = 3 * TIMEOUT_MS;

const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST205" || code === "42P01";
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type ExtraRow = {
  key: string;
  label: string;
  aliases: string[] | null;
  category: string;
  kcal: number | string;
  protein_g: number | string;
  carbs_g: number | string;
  fat_g: number | string;
  fiber_g: number | string;
};

const rowToFood = (r: ExtraRow): Food => ({
  key: r.key,
  label: r.label,
  aliases: r.aliases ?? [],
  category: r.category as FoodCategory,
  kcal: Number(r.kcal),
  protein_g: Number(r.protein_g),
  carbs_g: Number(r.carbs_g),
  fat_g: Number(r.fat_g),
  fiber_g: Number(r.fiber_g),
  densityGPerMl: 1,
  perishable: false,
  shelfLifeDays: Infinity,
  pricePer100Eur: 0.5,
});

/** Cada cuánto se relee `foods_extra`: lo que guarda otra instancia tarda como mucho esto. */
const EXTRA_FOODS_TTL_MS = 10 * 60_000;
/** Tras una lectura fallida, cuándo se vuelve a intentar. */
const EXTRA_FOODS_RETRY_MS = 30_000;

let extraFoods: { at: number; ok: boolean; promise: Promise<void> } | null = null;

/**
 * Carga `foods_extra` en el proceso y la relee cada `EXTRA_FOODS_TTL_MS`; tras
 * un fallo, reintenta a los `EXTRA_FOODS_RETRY_MS` (antes un fallo se memorizaba
 * y la instancia se quedaba sin esas filas hasta morir). Llamadas a la vez
 * comparten la lectura. Sin tabla (migración pendiente), nada.
 */
export function ensureExtraFoods(): Promise<void> {
  const now = Date.now();
  if (
    extraFoods &&
    now - extraFoods.at < (extraFoods.ok ? EXTRA_FOODS_TTL_MS : EXTRA_FOODS_RETRY_MS)
  ) {
    return extraFoods.promise;
  }
  const entry = { at: now, ok: true, promise: Promise.resolve() };
  entry.promise = (async () => {
    try {
      const db = await admin();
      const { data, error } = await db
        .from("foods_extra" as never)
        .select("key, label, aliases, category, kcal, protein_g, carbs_g, fat_g, fiber_g");
      if (error) {
        if (isMissingTable(error)) return;
        entry.ok = false;
        logEvent("warn", "foods_extra_load_failed", { error: errorText(error) });
        return;
      }
      registerExtraFoods(((data ?? []) as unknown as ExtraRow[]).map(rowToFood));
    } catch (error) {
      entry.ok = false;
      logEvent("warn", "foods_extra_load_failed", { error: errorText(error) });
    }
  })();
  extraFoods = entry;
  return entry.promise;
}

async function translate(ai: Provider, name: string, category: FoodCategory) {
  const { text } = await generateText({
    model: ai(DISAMBIGUATION_MODEL),
    temperature: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    prompt:
      `Ingrediente en español: «${name}» (tipo: ${category}). Escribe SOLO la búsqueda en inglés ` +
      "que usarías en USDA FoodData Central para el alimento genérico, en crudo si se cocina " +
      '(p. ej. "manteca de cerdo" → "lard", "morcilla" → "blood sausage"). Sin comillas ni ' +
      "explicación; si no es un alimento, responde NADA.",
  });
  const query = text.trim().replace(/^["'«]|["'»]$/g, "");
  return !query || /^nada$/i.test(query) || query.length > 60 ? null : query;
}

async function search(apiKey: string, query: string) {
  const url =
    `${SEARCH_URL}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}` +
    `&dataType=${encodeURIComponent("Foundation,SR Legacy")}&pageSize=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`USDA ${res.status}`);
  return res.json();
}

async function pick(ai: Provider, name: string, candidates: UsdaCandidate[]) {
  const { text } = await generateText({
    model: ai(DISAMBIGUATION_MODEL),
    temperature: 0,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    prompt:
      `¿Cuál de estos alimentos de USDA es «${name}» tal como se usa en una receta española? ` +
      "Prefiere el genérico y crudo.\n" +
      candidates.map((c, i) => `${i + 1}) ${c.description}`).join("\n") +
      '\nDevuelve SOLO JSON: {"opcion": número, o null si ninguno lo es}.',
  });
  const parsed = parseJsonLoose(text) as { opcion?: unknown } | null;
  const n = Number(parsed?.opcion);
  return Number.isInteger(n) && n >= 1 ? n - 1 : null;
}

/**
 * Busca en USDA los ingredientes dados y devuelve, para cada uno, su fila (o
 * `null`). Lo encontrado queda guardado para toda la app. Nunca lanza.
 */
export async function resolveWithUsda(
  ai: Provider,
  items: { name: string; category: FoodCategory }[],
): Promise<(Food | null)[]> {
  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey || !items.length) return items.map(() => null);
  await ensureExtraFoods();

  const found = await Promise.all(
    items.map((item) =>
      lookupUsdaFood(item, {
        translate: (name, category) => translate(ai, name, category),
        search: (query) => search(apiKey, query),
        pick: (name, candidates) => pick(ai, name, candidates),
      }).catch((error) => {
        console.warn("usda: búsqueda", (error as Error)?.message ?? error);
        return null;
      }),
    ),
  );

  const fresh = found.filter((f): f is NonNullable<typeof f> => !!f);
  if (fresh.length) {
    registerExtraFoods(fresh.map((f) => f.food));
    try {
      const db = await admin();
      const { error } = await db.from("foods_extra" as never).upsert(
        fresh.map(({ food, candidate }) => ({
          key: food.key,
          label: food.label,
          aliases: [food.label],
          category: food.category,
          kcal: food.kcal,
          protein_g: food.protein_g,
          carbs_g: food.carbs_g,
          fat_g: food.fat_g,
          fiber_g: food.fiber_g,
          source: "usda",
          source_id: String(candidate.fdcId),
          source_label: candidate.description,
        })) as never,
        { onConflict: "key", ignoreDuplicates: true },
      );
      if (error && !isMissingTable(error)) console.error("foods_extra: escritura", error);
    } catch (error) {
      console.warn("foods_extra: sin guardar", error);
    }
  }
  return found.map((f) => f?.food ?? null);
}
