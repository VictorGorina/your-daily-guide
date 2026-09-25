/**
 * Método de cocción y grasa de cocinar (tickets 14 y 05 de
 * `precision-nutricional`, invariante 14: el aceite lo pone el código).
 *
 * El modelo solo CLASIFICA el método del plato (un reconocimiento de patrón,
 * que hace bien); los gramos de grasa los pone esta tabla. Antes el modelo
 * apuntaba el aceite él mismo y el eval midió que se pasaba (20 g en una
 * plancha, 10 g en una tostada), y un suelo de 25 g en los fritos inflaba la
 * tortilla: el aceite que de verdad queda en la comida es mucho menos que el
 * que se echa en la sartén.
 *
 * Puro: lo usan `resolve-dish.server.ts`, `validate-recipe.ts` y los tests.
 */

import { normName } from "@/lib/plan-shared";

export const COOKING_METHODS = [
  "cruda",
  "alinada",
  "untada",
  "plancha",
  "horno",
  "salteado",
  "guiso",
  "hervido",
  "frito_rebozado",
] as const;

export type CookingMethod = (typeof COOKING_METHODS)[number];

/**
 * Gramos de grasa por ración base según el método. Valores iniciales del
 * ticket 14, a ajustar con `bun run eval:recipes`:
 *
 * - `frito_rebozado` 14 g: aceite RETENIDO (la tortilla de patatas medida con
 *   BEDCA), no el de la sartén.
 * - `alinada` 8 g: el aliño de una ensalada. `untada` 5 g: una tostada.
 * - `hervido` y `cruda`, nada.
 */
export const OIL_BY_METHOD: Record<CookingMethod, number> = {
  cruda: 0,
  alinada: 8,
  untada: 5,
  plancha: 5,
  horno: 8,
  salteado: 8,
  guiso: 10,
  hervido: 0,
  frito_rebozado: 14,
};

/**
 * Métodos que calientan con grasa. Sobre un plato hecho solo de productos ya
 * cocinados (una pizza, un bocadillo de tortilla comprada) no ponen nada: la
 * fila del producto ya lleva su grasa y se contaría dos veces. Aliñar y untar
 * sí se hacen sobre alimentos listos (una ensalada de bote, una tostada).
 */
const HEAT_METHODS: ReadonlySet<CookingMethod> = new Set([
  "plancha",
  "horno",
  "salteado",
  "guiso",
  "frito_rebozado",
]);

/** Lee lo que diga el modelo (con o sin tilde, en masculino o femenino). `null` si no es ninguno. */
export function parseCookingMethod(raw: unknown): CookingMethod | null {
  const t = normName(String(raw ?? ""))
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (!t) return null;
  if ((COOKING_METHODS as readonly string[]).includes(t)) return t as CookingMethod;
  // `normName` ya quita la tilde de la eñe: "aliñada" llega como "alinada".
  if (t === "alinado") return "alinada";
  if (t === "crudo") return "cruda";
  if (t === "untado") return "untada";
  if (t === "frito" || t === "frita" || t === "rebozado" || t === "fritura")
    return "frito_rebozado";
  if (t === "hervida" || t === "cocido" || t === "vapor") return "hervido";
  if (t === "asado" || t === "asada" || t === "al_horno") return "horno";
  if (t === "salteada" || t === "wok") return "salteado";
  if (t === "guisado" || t === "guisada" || t === "estofado" || t === "sofrito") return "guiso";
  // El valor antiguo del pipeline: sin más pista, lo más prudente es no poner grasa de más.
  if (t === "otra") return null;
  return null;
}

/** Hasta dos métodos distintos, en orden; `[]` si no se entiende ninguno. */
export function parseCookingMethods(raw: unknown): CookingMethod[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: CookingMethod[] = [];
  for (const item of list) {
    const m = parseCookingMethod(item);
    if (m && !out.includes(m)) out.push(m);
    if (out.length === 2) break;
  }
  return out;
}

const NO_OIL = /\b(sin aceite|al vapor|en papillote|hervid[oa]s? sin)\b/;
const AIR_FRYER = /\b(freidora de aire|air ?fryer|airfryer)\b/;

/**
 * Gramos de grasa de cocinar de una ración base, a partir de los métodos del
 * plato y de lo que diga su nombre.
 *
 * Dos métodos NO se suman sin más (eval del 2026-09-25: un revuelto sobre una
 * tostada salía con 13 g de aceite frente a 3 g, y unos pimientos rellenos con
 * 18 g frente a 4): la grasa de dos métodos de calor es la misma sartén, así que
 * cuenta el mayor. El aliño sí se suma, porque es un componente aparte (ensalada
 * aliñada + pollo a la plancha), y el untado solo cuenta si no hay calor (una
 * tostada con un revuelto encima no se unta además).
 *
 * - "sin aceite", "al vapor": 0.
 * - "en freidora de aire": un frito cuenta como la plancha.
 * - `allReady` (todos los ingredientes que no son grasa son productos listos):
 *   los métodos de calor no suman (ver `HEAT_METHODS`).
 */
export function cookingFatGrams(
  methods: readonly CookingMethod[],
  dishText: string,
  opts: { allReady?: boolean } = {},
): number {
  const text = normName(dishText);
  if (NO_OIL.test(text)) return 0;
  const airFryer = AIR_FRYER.test(text);
  let heat = 0;
  let dressing = 0;
  let spread = 0;
  for (const method of methods) {
    if (opts.allReady && HEAT_METHODS.has(method)) continue;
    const effective = airFryer && method === "frito_rebozado" ? "plancha" : method;
    const grams = OIL_BY_METHOD[effective];
    if (HEAT_METHODS.has(method)) heat = Math.max(heat, grams);
    else if (effective === "alinada") dressing = grams;
    else if (effective === "untada") spread = grams;
  }
  return heat + dressing + (heat ? 0 : spread);
}

/** Claves de la tabla que son aceite: siempre se tratan como grasa de cocinar. */
export const OIL_FOOD_KEYS: ReadonlySet<string> = new Set([
  "aceite-oliva",
  "aceite-girasol",
  "aceite-coco",
]);
