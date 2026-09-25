/**
 * Clave de un plato en la caché de recetas (`dish_recipes`, ticket 06):
 * `normName` → palabras → singular → ORDENADAS. Así "arroz con pollo" y "pollo
 * con arroz" comparten receta, y "lentejas estofadas con verdura" y "…con
 * verduras" también.
 *
 * Solo se quitan palabras gramaticales. Nunca "sin" ("cerveza sin alcohol" no es
 * una cerveza), ni "fresco" o "natural" ("queso fresco" no es un queso curado),
 * ni las cantidades ("media pizza" guarda su cantidad con su propia clave).
 *
 * Puro. Copia de `src/lib/nutrition/dish-key.ts` de la web.
 */

import { normName } from "./plan-shared";

const GRAMMAR = new Set([
  "de",
  "del",
  "la",
  "el",
  "lo",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "con",
  "y",
  "e",
  "o",
  "a",
  "al",
  "en",
  "para",
  "por",
  "su",
  "mi",
]);

/** Plural simple, igual que `matchFood`: "lentejas" → "lenteja", "verduras" → "verdura". */
const singular = (token: string): string => {
  if (token.length > 4 && token.endsWith("es") && !token.endsWith("ies")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
};

export const DISH_KEY_MAX = 200;

export function dishKey(label: string): string {
  return normName(label)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !GRAMMAR.has(t))
    .map(singular)
    .sort()
    .join(" ")
    .slice(0, DISH_KEY_MAX);
}
