/**
 * Referencias externas por 100 g — miden el error de la TABLA de composición,
 * no el del modelo (`precision-nutricional`, ticket 02).
 *
 * Alimentos y platos-producto donde una fila genérica suele fallar (hallazgo
 * H4: el salmorejo casado con el gazpacho, la morcilla con el chorizo). `name`
 * es como lo escribiría una persona: el eval lo casa con `matchFood`, igual que
 * producción, así que un casado a la fila equivocada también sale como error.
 *
 * Dos fuentes (decisión D5 para los genéricos; etiquetas para el producto
 * español, que ninguna tabla oficial recoge bien):
 *
 * - **USDA FoodData Central** para alimentos genéricos, en el estado en que se
 *   comen (la tabla guarda valores "tal como se come").
 * - **Open Food Facts** para productos del mercado español: la MEDIANA de las
 *   etiquetas de los productos vendidos en España de esa categoría (consulta del
 *   2026-09-24), no una marca suelta. Son valores "tal como se venden".
 *
 * `expectedKey` es la fila que DEBERÍA casar. Si no existe todavía, el informe
 * lo marca como fila que falta (se mide contra el genérico que sumaría hoy
 * producción).
 */

import type { GoldenExternal } from "./golden";

const usda = (fdcId: number, description: string) =>
  `USDA FoodData Central ${fdcId} (${description}): https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`;

const off = (tag: string, n: number, codes: string[]) =>
  `Open Food Facts, mediana de ${n} productos vendidos en España de la categoría ${tag} ` +
  `(2026-09-24; p. ej. ${codes.join(", ")}): https://world.openfoodfacts.org/category/${tag}`;

export const GOLDEN_EXTERNAL: GoldenExternal[] = [
  // --- Genéricos (USDA) -------------------------------------------------------
  {
    name: "cerveza",
    expectedKey: "cerveza",
    per100: { kcal: 43, protein_g: 0.46, carbs_g: 3.55, fat_g: 0 },
    source: usda(168746, "Alcoholic beverage, beer, regular, all"),
    reviewedBy: null,
  },
  {
    name: "vino tinto",
    expectedKey: "vino-cocinar",
    per100: { kcal: 85, protein_g: 0.07, carbs_g: 2.61, fat_g: 0 },
    source: usda(173190, "Alcoholic beverage, wine, table, red"),
    reviewedBy: null,
    notes: "La fila `vino-cocinar` es la del vino de mesa; el nombre de la fila no importa aquí.",
  },
  {
    name: "pechuga de pollo a la plancha",
    expectedKey: "pechuga-pollo",
    per100: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.57 },
    source: usda(171477, "Chicken, broilers or fryers, breast, meat only, cooked, roasted"),
    reviewedBy: null,
  },
  {
    name: "salmón a la plancha",
    expectedKey: "salmon",
    per100: { kcal: 206, protein_g: 22.1, carbs_g: 0, fat_g: 12.4 },
    source: usda(175168, "Fish, salmon, Atlantic, farmed, cooked, dry heat"),
    reviewedBy: null,
    notes: "Salmón de piscifactoría, el habitual en España. El salvaje cocinado da 182 kcal.",
  },
  {
    name: "bacalao al horno",
    expectedKey: "bacalao",
    per100: { kcal: 105, protein_g: 22.8, carbs_g: 0, fat_g: 0.86 },
    source: usda(171956, "Fish, cod, Atlantic, cooked, dry heat"),
    reviewedBy: null,
  },
  {
    name: "arroz blanco cocido",
    expectedKey: "arroz-blanco",
    per100: { kcal: 130, protein_g: 2.38, carbs_g: 28.6, fat_g: 0.21 },
    source: usda(168880, "Rice, white, medium-grain, enriched, cooked"),
    reviewedBy: null,
  },

  // --- Producto español (Open Food Facts) -------------------------------------
  {
    name: "salmorejo",
    expectedKey: "salmorejo",
    per100: { kcal: 87, protein_g: 1.1, carbs_g: 6.2, fat_g: 6.4 },
    source: off("en:salmorejos", 29, ["8480000399014", "8480000399021", "8480000399663"]),
    reviewedBy: null,
    notes:
      "Salmorejo envasado (rango 63-238 kcal). El casero lleva más pan y aceite: revisar si la " +
      "referencia debe ser la casera.",
  },
  {
    name: "tortilla de patatas",
    expectedKey: "tortilla-patatas",
    per100: { kcal: 155, protein_g: 5.2, carbs_g: 12.1, fat_g: 9 },
    source: off("es:tortillas-de-patatas", 30, ["8480000808950", "8480000807717", "20657284"]),
    reviewedBy: null,
    notes: "Coincide con la casera calculada con BEDCA (~145 kcal, Caliro).",
  },
  {
    name: "croquetas de jamón",
    expectedKey: "croqueta",
    per100: { kcal: 193, protein_g: 6.6, carbs_g: 23.9, fat_g: 8.2 },
    source: off("es:croquetas", 10, ["8431876298963", "8425324001670", "8434702003380"]),
    reviewedBy: null,
    notes:
      "Congeladas, ANTES de freír: fritas absorben aceite y suben. Solo productos con 'jamón' en " +
      "el nombre.",
  },
  {
    name: "fuet",
    expectedKey: "salchichon",
    per100: { kcal: 438, protein_g: 27, carbs_g: 3.2, fat_g: 36 },
    source: off("es:fuet", 22, ["8480000551085", "8410762005014", "8410762005113"]),
    reviewedBy: null,
    notes: "El fuet es un salchichón fino: con un alias en `salchichon` (420 kcal) bastaría.",
  },
  {
    name: "morcilla",
    expectedKey: "morcilla",
    per100: { kcal: 223, protein_g: 5.9, carbs_g: 17.2, fat_g: 14.2 },
    source: off("es:morcillas", 25, ["8437005509016", "8437004456014", "8421764100775"]),
    reviewedBy: null,
    notes: "Mezcla morcilla de arroz, de cebolla y de Burgos (rango 170-687 kcal).",
  },
  {
    name: "pechuga de pavo loncheada",
    expectedKey: "pechuga-pavo-loncheada",
    per100: { kcal: 88, protein_g: 16, carbs_g: 1.5, fat_g: 1 },
    source: off("en:turkey-breasts", 30, ["8480000057105", "8480000602435", "8410320249478"]),
    reviewedBy: null,
    notes: "Casaba por alias con `jamon-cocido` (110 kcal, +25 %); fila propia desde el ticket 14.",
  },
  {
    name: "bacon",
    expectedKey: "bacon",
    per100: { kcal: 289, protein_g: 15, carbs_g: 1, fat_g: 25 },
    source: off("en:bacons", 29, ["8480000590664", "8410973643395", "8411477910631"]),
    reviewedBy: null,
    notes: "Tal como se compra (crudo). Frito pierde agua y grasa.",
  },
  {
    name: "hummus",
    expectedKey: "hummus",
    per100: { kcal: 276, protein_g: 6.7, carbs_g: 11.1, fat_g: 22 },
    source: off("en:hummus", 28, ["8480000808585", "8480000808622", "8480000808929"]),
    reviewedBy: null,
    notes: "El hummus de supermercado español lleva bastante más aceite que el clásico.",
  },
  {
    name: "pizza margarita",
    expectedKey: "pizza",
    per100: { kcal: 215.5, protein_g: 8.8, carbs_g: 32, fat_g: 6 },
    source: off("en:margherita-pizzas", 6, ["4056489443025", "5059697699368", "20001650"]),
    reviewedBy: null,
    notes: "Pizza entera horneada (masa + tomate + queso); `masa-pizza` es solo la masa.",
  },
  {
    name: "pan de pita",
    expectedKey: "pan-blanco",
    per100: { kcal: 245, protein_g: 8.4, carbs_g: 48.5, fat_g: 1.1 },
    source: off("en:pita-breads", 29, ["8714535110081", "5036034406834", "8437004218049"]),
    reviewedBy: null,
    notes: "Casar con pan blanco es aceptable si el error se queda en torno al 10 %.",
  },
  {
    name: "bebida de soja",
    expectedKey: "bebida-soja",
    per100: { kcal: 34, protein_g: 3.1, carbs_g: 1.2, fat_g: 1.7 },
    source: off("en:soy-milks", 30, ["8480000136824", "8480000293145", "8480000679499"]),
    reviewedBy: null,
    notes: "Hoy casa con `bebida-avena`: otra bebida, con menos proteína y más hidrato.",
  },
];
