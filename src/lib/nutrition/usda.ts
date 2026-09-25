/**
 * Ingredientes desconocidos desde USDA FoodData Central (ticket 22 de
 * `precision-nutricional`, D13). Núcleo puro: leer la respuesta de búsqueda,
 * construir la fila y orquestar la búsqueda con dependencias inyectadas (así se
 * testea con la API simulada). El I/O real — el modelo que traduce y elige, la
 * API y la tabla `foods_extra` — vive en `usda.server.ts`.
 *
 * El modelo NUNCA escribe una cifra (invariante 1): traduce el nombre a una
 * consulta en inglés y elige un número de una lista cerrada de descripciones.
 * Los valores por 100 g son los de USDA.
 */

import type { Food, FoodCategory } from "./foods.data";
import { categoryMedianFood } from "./nutrition";

export type UsdaPer100 = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

export type UsdaCandidate = {
  fdcId: number;
  description: string;
  dataType: string;
  per100: UsdaPer100;
};

/** Ids de nutriente de FDC. La energía de Foundation suele venir como Atwater (2047/2048). */
const ENERGY_IDS = [1008, 2047, 2048];
const PROTEIN = 1003;
const FAT = 1004;
const CARBS = 1005;
const FIBER = 1079;

type RawNutrient = { nutrientId?: number; value?: number; unitName?: string };

function nutrient(list: RawNutrient[], ids: number[]): number | null {
  for (const id of ids) {
    const n = list.find((x) => x.nutrientId === id);
    if (!n || !Number.isFinite(Number(n.value))) continue;
    // La energía en kJ (algunas filas la traen así) se pasa a kcal.
    if (ENERGY_IDS.includes(id) && String(n.unitName).toUpperCase() === "KJ") {
      return Number(n.value) / 4.184;
    }
    return Number(n.value);
  }
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Candidatos con energía y macros de una respuesta de `/foods/search`. */
export function candidatesFromSearch(json: unknown): UsdaCandidate[] {
  const foods = (json as { foods?: unknown } | null)?.foods;
  if (!Array.isArray(foods)) return [];
  const out: UsdaCandidate[] = [];
  for (const raw of foods) {
    const f = (raw ?? {}) as {
      fdcId?: number;
      description?: string;
      dataType?: string;
      foodNutrients?: RawNutrient[];
    };
    const list = Array.isArray(f.foodNutrients) ? f.foodNutrients : [];
    const kcal = nutrient(list, ENERGY_IDS);
    const protein = nutrient(list, [PROTEIN]);
    const fat = nutrient(list, [FAT]);
    const carbs = nutrient(list, [CARBS]);
    if (
      !f.fdcId ||
      !f.description ||
      kcal == null ||
      protein == null ||
      fat == null ||
      carbs == null
    ) {
      continue;
    }
    out.push({
      fdcId: f.fdcId,
      description: f.description,
      dataType: String(f.dataType ?? ""),
      per100: {
        kcal: Math.round(kcal),
        protein_g: round1(protein),
        carbs_g: round1(carbs),
        fat_g: round1(fat),
        fiber_g: round1(nutrient(list, [FIBER]) ?? 0),
      },
    });
  }
  return out;
}

/** La fila de la tabla para un alimento de USDA. El precio, el de su categoría. */
export function foodFromUsda(c: UsdaCandidate, name: string, category: FoodCategory): Food {
  const like = categoryMedianFood(category);
  return {
    key: `usda-${c.fdcId}`,
    label: name.trim().toLowerCase(),
    aliases: [],
    category,
    ...c.per100,
    densityGPerMl: 1,
    perishable: like.perishable,
    shelfLifeDays: like.shelfLifeDays,
    pricePer100Eur: like.pricePer100Eur,
  };
}

export type UsdaDeps = {
  /** "manteca de cerdo" → "lard". `null` si no hay traducción. Solo texto. */
  translate: (name: string, category: FoodCategory) => Promise<string | null>;
  /** La respuesta cruda de `/foods/search` (Foundation + SR Legacy). */
  search: (query: string) => Promise<unknown>;
  /** Con varios candidatos, el índice del más adecuado (lista cerrada), o `null`. */
  pick: (name: string, candidates: UsdaCandidate[]) => Promise<number | null>;
};

/** Candidatos que se enseñan para elegir: con energía, como mucho 8. */
export const USDA_MAX_CANDIDATES = 8;

/**
 * Busca un ingrediente en USDA. `null` si no hay traducción, respuesta ni un
 * candidato elegible: entonces se queda el "más parecido" del ticket 13, nunca
 * el genérico. Lanza lo que lancen las dependencias (el llamador lo recoge).
 */
export async function lookupUsdaFood(
  item: { name: string; category: FoodCategory },
  deps: UsdaDeps,
): Promise<{ food: Food; candidate: UsdaCandidate } | null> {
  const query = (await deps.translate(item.name, item.category))?.trim();
  if (!query) return null;
  const candidates = candidatesFromSearch(await deps.search(query))
    .filter((c) => c.per100.kcal > 0)
    .slice(0, USDA_MAX_CANDIDATES);
  if (!candidates.length) return null;
  const index = candidates.length === 1 ? 0 : await deps.pick(item.name, candidates);
  const candidate = index != null ? candidates[index] : undefined;
  if (!candidate) return null;
  return { food: foodFromUsda(candidate, item.name, item.category), candidate };
}
