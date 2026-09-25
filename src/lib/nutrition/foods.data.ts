/**
 * Tabla de composición de alimentos — la base de datos nutricional de la app.
 *
 * Cada fila son los valores por **100 g de porción comestible, tal como se
 * come** (cocido para lo que se come cocido: arroz, pasta, legumbre). Para esos
 * casos hay una fila aparte para el alimento crudo/seco, con sus propios alias
 * ("arroz crudo", "arroz seco"), porque el modelo a veces da los gramos en seco.
 *
 * Origen de los valores: composición estándar de alimentos genéricos (BEDCA y
 * equivalentes públicos), redondeada a entero. Son **orientativos** — el copy de
 * Hoy ya avisa de que la barra de macros no es un conteo clínico.
 *
 * `pricePer100Eur` es un precio de supermercado en España, aproximado y a mano:
 * es la única parte de la tabla que se mantiene (refresco trimestral).
 *
 * NO importar este archivo desde código de navegador si se puede evitar: son
 * ~150 filas. Vive detrás de `resolve-dish.server.ts` y del eval.
 */

export type FoodCategory =
  | "proteina"
  | "verdura"
  | "fruta"
  | "cereal"
  | "legumbre"
  | "lacteo"
  | "grasa"
  | "fruto-seco"
  | "despensa";

export type Food = {
  /** Slug canónico. Es lo que el modelo debe devolver en `key` cuando encaja. */
  key: string;
  /** Nombre legible en español. */
  label: string;
  /** Nombres alternativos ya normalizados (minúscula, sin acentos). */
  aliases: string[];
  category: FoodCategory;
  /** Por 100 g, tal como se come. */
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  /** g por ml, para convertir cantidades que el modelo dé en ml. Por defecto 1. */
  densityGPerMl: number;
  perishable: boolean;
  /** Días que aguanta en casa (nevera normal, sin congelar). `Infinity` = despensa. */
  shelfLifeDays: number;
  pricePer100Eur: number;
  /**
   * Solo carne, pescado y patata frescos: qué fracción del peso en crudo queda tras
   * cocinar (se pierde agua, no energía). Va SIEMPRE con `basis`, que dice en qué
   * estado está el valor de la fila, y `resolveIngredient` convierte los gramos en la
   * dirección que toque: crudo → cocinado (× rendimiento) si la fila es cocinada, y
   * cocinado → crudo (÷ rendimiento) si la fila es cruda. Así el modelo solo dice en qué
   * estado da los gramos (`estado`), nunca hace la cuenta (issue de precisión,
   * 2026-09-19: en prosa acertaba unas veces y otras no). `undefined` en curados,
   * enlatados, huevo, proteína vegetal y todo lo que no cambia de peso al cocinarse.
   */
  cookedYield?: number;
  /**
   * En qué estado es el valor de la fila, cuando tiene `cookedYield` (ticket 14 §4).
   * Antes se daba por hecho "cocinado" y varias filas eran el valor crudo (el salmón,
   * 208 kcal, es USDA en crudo): 100 g crudos contaban un 20 % de menos.
   */
  basis?: "crudo" | "cocinado";
};

type FoodOpts = {
  aliases?: string[];
  densityGPerMl?: number;
  perishable?: boolean;
  shelfLifeDays?: number;
  cookedYield?: number;
  basis?: "crudo" | "cocinado";
};

const f = (
  key: string,
  label: string,
  category: FoodCategory,
  kcal: number,
  protein_g: number,
  carbs_g: number,
  fat_g: number,
  fiber_g: number,
  pricePer100Eur: number,
  opts: FoodOpts = {},
): Food => {
  const perishable = opts.perishable ?? PERISHABLE_BY_DEFAULT.has(category);
  return {
    key,
    label,
    aliases: opts.aliases ?? [],
    category,
    kcal,
    protein_g,
    carbs_g,
    fat_g,
    fiber_g,
    densityGPerMl: opts.densityGPerMl ?? 1,
    perishable,
    shelfLifeDays: opts.shelfLifeDays ?? (perishable ? 6 : Infinity),
    pricePer100Eur,
    cookedYield: opts.cookedYield,
    basis: opts.basis,
  };
};

const PERISHABLE_BY_DEFAULT = new Set<FoodCategory>(["proteina", "verdura", "fruta", "lacteo"]);

// prettier-ignore
export const FOODS: Food[] = [
  // ---------------------------------------------------------------- PROTEÍNA
  f("pechuga-pollo", "pechuga de pollo", "proteina", 165, 31, 0, 3.6, 0, 0.75, { aliases: ["pollo", "pechuga pollo", "pollo a la plancha", "pollo asado"], shelfLifeDays: 2, cookedYield: 0.75, basis: "cocinado" }),
  f("muslo-pollo", "muslo de pollo", "proteina", 209, 26, 0, 11, 0, 0.55, { aliases: ["contramuslo", "jamoncitos de pollo", "muslo pollo"], shelfLifeDays: 2, cookedYield: 0.78, basis: "cocinado" }),
  f("pavo-pechuga", "pechuga de pavo", "proteina", 135, 29, 0, 1.5, 0, 0.95, { aliases: ["pavo", "filete de pavo"], shelfLifeDays: 2, cookedYield: 0.75, basis: "cocinado" }),
  f("ternera-magra", "ternera magra", "proteina", 217, 27, 0, 12, 0, 1.4, { aliases: ["ternera", "filete de ternera", "carne de ternera", "vacuno", "carne", "carne de vacuno"], shelfLifeDays: 3, cookedYield: 0.75, basis: "cocinado" }),
  f("carne-picada", "carne picada mixta", "proteina", 250, 18, 0, 20, 0, 0.8, { aliases: ["carne picada", "picada", "carne molida"], shelfLifeDays: 2, cookedYield: 0.75, basis: "cocinado" }),
  f("cerdo-lomo", "lomo de cerdo", "proteina", 210, 27, 0, 11, 0, 0.7, { aliases: ["cerdo", "lomo", "cinta de lomo", "filete de cerdo"], shelfLifeDays: 3, cookedYield: 0.75, basis: "cocinado" }),
  f("jamon-serrano", "jamón serrano", "proteina", 240, 31, 1, 12, 0, 3.5, { aliases: ["jamon", "jamon iberico", "jamon curado"], shelfLifeDays: 20 }),
  f("jamon-cocido", "jamón cocido", "proteina", 110, 18, 1.5, 3.5, 0, 1.2, { aliases: ["jamon york", "fiambre", "lacon"], shelfLifeDays: 6 }),
  // Ticket 14 §3. Open Food Facts, mediana de 30 productos vendidos en España (en:turkey-breasts,
  // 2026-09-24; p. ej. 8480000057105, 8480000602435). Casaba con el jamón cocido: +25 % de kcal.
  f("pechuga-pavo-loncheada", "pechuga de pavo loncheada", "proteina", 88, 16, 1.5, 1, 0.7, 1.5, { aliases: ["pavo loncheado", "fiambre de pavo", "lonchas de pavo", "pechuga de pavo en lonchas", "pavo en lonchas"], shelfLifeDays: 6 }),
  f("chorizo", "chorizo", "proteina", 350, 24, 2, 28, 0, 1.2, { shelfLifeDays: 15 }),
  // Ticket 14 §3. Open Food Facts, mediana de 57 productos (en:bacons, 2026-09-25; p. ej.
  // 8480000590664, 8410973643395). Tal como se compra, en crudo.
  f("bacon", "bacon o panceta", "proteina", 289, 15, 1, 25, 0, 1.0, { aliases: ["beicon", "panceta", "tocino", "bacon ahumado", "taquitos de bacon", "panceta curada"], shelfLifeDays: 10 }),
  // Ticket 14 §3. Open Food Facts, mediana de 13 productos (es:sobrasadas, 2026-09-25; p. ej.
  // 8410843005810, 8411959101007).
  f("sobrasada", "sobrasada", "proteina", 592, 10, 0.5, 61, 0, 1.2, { aliases: ["sobrassada"], shelfLifeDays: 30 }),
  // Separados de "chorizo" (issue de precisión, 2026-09-17): compartían la fila
  // pero sus macros reales difieren mucho — sobre todo la proteína, casi el
  // doble en el curado que en el fresco o el cocido. Valores anclados a BEDCA.
  f("chorizo-fresco", "chorizo fresco para freír", "proteina", 296, 14, 4, 25, 0, 0.9, { aliases: ["chorizo crudo", "chorizo para freir", "chorizo criollo"], shelfLifeDays: 4 }),
  // Fuet: Open Food Facts, mediana de 22 productos (438 kcal, +4 % frente al salchichón).
  f("salchichon", "salchichón", "proteina", 420, 26, 2, 35, 0, 1.3, { aliases: ["fuet", "espetec", "longaniza curada"], shelfLifeDays: 20 }),
  f("butifarra", "butifarra", "proteina", 240, 10, 5, 20, 0, 1.0, { aliases: ["butifarra fresca", "botifarra"], shelfLifeDays: 4 }),
  f("salchicha", "salchicha tipo frankfurt", "proteina", 260, 13, 1.5, 23, 0, 0.8, { aliases: ["salchichas", "frankfurt", "salchicha de frankfurt"], shelfLifeDays: 6 }),
  f("morcilla", "morcilla", "proteina", 325, 11, 3, 30, 0, 1.1, { aliases: ["morcilla de burgos", "morcilla de arroz", "morcilla de cebolla", "moronga"], shelfLifeDays: 5 }),
  f("huevo", "huevo", "proteina", 143, 13, 1.1, 9.5, 0, 0.30, { aliases: ["huevos", "huevo cocido", "huevo frito", "huevo duro", "tortilla francesa", "huevos revueltos", "revuelto de huevo"], shelfLifeDays: 21 }),
  f("clara-huevo", "clara de huevo", "proteina", 52, 11, 0.7, 0.2, 0, 0.40, { aliases: ["claras", "clara"], shelfLifeDays: 10 }),
  // Ticket 14 §3: plato-producto (la de supermercado o de bar, ya hecha). Open Food Facts,
  // mediana de 58 productos (es:tortillas-de-patatas, 2026-09-25; p. ej. 8480000808950,
  // 8480000807717). Coincide con la casera calculada con BEDCA (~145 kcal).
  f("tortilla-patatas", "tortilla de patatas", "proteina", 156, 5.2, 12.8, 9, 1.6, 0.60, { aliases: ["tortilla espanola", "tortilla de patata", "pincho de tortilla"], shelfLifeDays: 3 }),
  // Ticket 14 §4: 208 kcal es USDA 175167 (Atlantic, farmed, RAW), no el cocinado. Sin
  // `cookedYield`: USDA da casi lo mismo cocinado (175168, 206 kcal), así que 100 g crudos o a la
  // plancha cuentan igual. Con el rendimiento de 0,8 el crudo contaba un 20 % de menos.
  f("salmon", "salmón", "proteina", 208, 20, 0, 13, 0, 2.2, { aliases: ["salmon fresco", "lomo de salmon"], shelfLifeDays: 2 }),
  f("merluza", "merluza", "proteina", 90, 18, 0, 2, 0, 1.6, { aliases: ["pescadilla", "filete de merluza", "pescado", "pescado blanco al horno"], shelfLifeDays: 2, cookedYield: 0.85, basis: "crudo" }),
  f("bacalao", "bacalao", "proteina", 105, 23, 0, 1, 0, 2.5, { aliases: ["bacalao fresco", "bacalao desalado"], shelfLifeDays: 2, cookedYield: 0.85, basis: "cocinado" }),
  f("atun-fresco", "atún fresco", "proteina", 130, 28, 0, 1, 0, 2.5, { aliases: ["atun", "bonito", "lomo de atun"], shelfLifeDays: 2, cookedYield: 0.80, basis: "cocinado" }),
  f("atun-lata", "atún en lata al natural", "proteina", 116, 26, 0, 1, 0, 1.4, { aliases: ["atun en conserva", "atun claro", "lata de atun", "atun al natural"], perishable: false }),
  f("atun-lata-aceite", "atún en lata en aceite", "proteina", 190, 25, 0, 10, 0, 1.5, { aliases: ["atun en aceite"], perishable: false }),
  f("sardina", "sardina", "proteina", 208, 25, 0, 11, 0, 1.0, { aliases: ["sardinas", "sardinas en lata"], shelfLifeDays: 2, cookedYield: 0.80, basis: "cocinado" }),
  f("caballa", "caballa", "proteina", 205, 19, 0, 14, 0, 0.9, { aliases: ["verdel", "melva"], shelfLifeDays: 2, cookedYield: 0.80, basis: "crudo" }),
  f("dorada", "dorada o lubina", "proteina", 115, 20, 0, 4, 0, 1.8, { aliases: ["lubina", "dorada", "pescado blanco"], shelfLifeDays: 2, cookedYield: 0.85, basis: "cocinado" }),
  f("gambas", "gambas o langostinos", "proteina", 99, 24, 0, 0.3, 0, 2.0, { aliases: ["gamba", "langostino", "langostinos", "camaron", "marisco"], shelfLifeDays: 2, cookedYield: 0.85, basis: "cocinado" }),
  f("mejillones", "mejillones", "proteina", 86, 12, 3.7, 2.2, 0, 0.7, { aliases: ["mejillon", "almeja", "almejas", "berberechos"], shelfLifeDays: 2, cookedYield: 0.85, basis: "crudo" }),
  f("calamar", "calamar", "proteina", 92, 16, 3, 1.4, 0, 1.8, { aliases: ["calamares", "sepia", "chipiron", "anillas de calamar"], shelfLifeDays: 2, cookedYield: 0.85, basis: "crudo" }),
  f("pulpo", "pulpo", "proteina", 82, 15, 2, 1, 0, 2.5, { aliases: ["pulpo cocido"], shelfLifeDays: 3 }),
  f("tofu", "tofu", "proteina", 76, 8, 1.9, 4.8, 0.3, 0.9, { aliases: ["tofu firme"], shelfLifeDays: 10 }),
  f("tempeh", "tempeh", "proteina", 190, 19, 9, 11, 0, 1.5, { shelfLifeDays: 10 }),
  f("seitan", "seitán", "proteina", 120, 24, 4, 2, 0, 1.2, { shelfLifeDays: 8 }),
  f("soja-texturizada", "soja texturizada hidratada", "proteina", 105, 16, 4, 1, 3, 0.6, { aliases: ["proteina de soja", "soja texturizada"], perishable: false }),

  // --------------------------------------------------------------- LEGUMBRE
  f("lentejas", "lentejas cocidas", "legumbre", 116, 9, 20, 0.4, 8, 0.35, { aliases: ["lenteja", "lentejas de bote", "lentejas guisadas"], perishable: false }),
  f("garbanzos", "garbanzos cocidos", "legumbre", 164, 9, 27, 2.6, 8, 0.35, { aliases: ["garbanzo", "garbanzos de bote"], perishable: false }),
  f("alubias-blancas", "alubias blancas cocidas", "legumbre", 140, 9, 25, 0.6, 6, 0.35, { aliases: ["alubia", "judias blancas", "judion", "fabes", "habichuelas", "pochas"], perishable: false }),
  f("alubias-negras", "alubias negras cocidas", "legumbre", 132, 9, 24, 0.5, 9, 0.40, { aliases: ["frijoles", "judias negras", "porotos"], perishable: false }),
  f("guisantes", "guisantes", "legumbre", 84, 5, 14, 0.4, 5, 0.30, { aliases: ["guisante", "arvejas", "chicharos", "garrofon"], perishable: false, shelfLifeDays: 5 }),
  f("edamame", "edamame", "legumbre", 121, 12, 9, 5, 5, 0.60, { aliases: ["soja verde", "habas de soja"], perishable: false, shelfLifeDays: 5 }),
  f("lentejas-secas", "lentejas secas", "legumbre", 352, 25, 60, 1, 11, 0.20, { aliases: ["lentejas crudas", "lenteja seca"], perishable: false }),
  f("garbanzos-secos", "garbanzos secos", "legumbre", 364, 19, 61, 6, 17, 0.20, { aliases: ["garbanzos crudos"], perishable: false }),
  // USDA FoodData Central, SR Legacy: 175202 (Beans, white, mature seeds, raw), 173734 (Beans,
  // black, mature seeds, raw).
  f("alubias-blancas-secas", "alubias blancas secas", "legumbre", 333, 23.4, 60, 0.9, 15.2, 0.35, { aliases: ["alubias crudas", "judias blancas secas", "alubias secas"], perishable: false }),
  f("alubias-negras-secas", "alubias negras secas", "legumbre", 341, 21.6, 62, 1.4, 15.5, 0.40, { aliases: ["frijoles secos", "judias negras secas"], perishable: false }),
  // Ticket 14 §3. USDA FoodData Central 174288 (Chickpea flour, besan).
  f("harina-garbanzo", "harina de garbanzo", "legumbre", 387, 22.4, 58, 6.7, 10.8, 0.35, { aliases: ["harina de garbanzos", "besan"], perishable: false }),
  f("hummus", "hummus", "legumbre", 177, 8, 14, 10, 6, 0.80, { shelfLifeDays: 5 }),

  // ----------------------------------------------------------------- CEREAL
  f("arroz-blanco", "arroz blanco cocido", "cereal", 130, 2.7, 28, 0.3, 0.4, 0.15, { aliases: ["arroz", "arroz cocido", "arroz hervido"], perishable: false, shelfLifeDays: 3 }),
  f("arroz-integral", "arroz integral cocido", "cereal", 112, 2.6, 24, 0.9, 1.8, 0.25, { aliases: ["arroz integral"], perishable: false, shelfLifeDays: 3 }),
  f("arroz-crudo", "arroz crudo", "cereal", 360, 7, 79, 0.6, 1.3, 0.15, { aliases: ["arroz seco", "arroz sin cocinar"], perishable: false }),
  f("pasta", "pasta cocida", "cereal", 158, 6, 31, 0.9, 1.8, 0.20, { aliases: ["macarrones", "espaguetis", "fideos", "penne", "tallarines", "pasta hervida", "espirales"], perishable: false, shelfLifeDays: 3 }),
  f("pasta-cruda", "pasta cruda", "cereal", 371, 13, 75, 1.5, 3, 0.20, { aliases: ["pasta seca", "macarrones crudos", "espaguetis crudos"], perishable: false }),
  f("pasta-integral", "pasta integral cocida", "cereal", 149, 6, 30, 1.3, 4, 0.30, { aliases: ["pasta integral"], perishable: false, shelfLifeDays: 3 }),
  // Filas en seco (ticket 05, D8: la receta va en crudo). USDA FoodData Central, SR Legacy:
  // 169703 (Rice, brown, long-grain, raw), 169738 (Pasta, whole-wheat, dry), 168874 (Quinoa,
  // uncooked), 169699 (Couscous, dry).
  f("arroz-integral-crudo", "arroz integral crudo", "cereal", 367, 7.5, 76, 3.2, 3.6, 0.25, { aliases: ["arroz integral seco", "arroz integral sin cocinar"], perishable: false }),
  f("pasta-integral-cruda", "pasta integral cruda", "cereal", 352, 13.9, 73, 2.9, 9.2, 0.30, { aliases: ["pasta integral seca", "macarrones integrales crudos"], perishable: false }),
  f("quinoa-cruda", "quinoa cruda", "cereal", 368, 14.1, 64, 6.1, 7, 0.90, { aliases: ["quinoa seca", "quinua cruda"], perishable: false }),
  f("couscous-seco", "cuscús seco", "cereal", 376, 12.8, 77, 0.6, 5, 0.30, { aliases: ["cuscus seco", "cuscus crudo", "semola de trigo"], perishable: false }),
  f("pan-blanco", "pan blanco", "cereal", 265, 9, 49, 3.2, 2.7, 0.25, { aliases: ["pan", "barra de pan", "baguette", "chapata"], shelfLifeDays: 3 }),
  f("pan-integral", "pan integral", "cereal", 247, 10, 41, 3.4, 6, 0.35, { aliases: ["pan de centeno", "pan multicereal"], shelfLifeDays: 4 }),
  f("pan-molde", "pan de molde", "cereal", 265, 8, 49, 4, 2.5, 0.40, { aliases: ["pan de sandwich", "pan bimbo"], shelfLifeDays: 7 }),
  f("biscote", "tostada o biscote", "cereal", 380, 12, 72, 6, 4, 0.60, { aliases: ["pan tostado", "tostadas", "picos", "regañas", "cracker"], perishable: false }),
  f("couscous", "cuscús cocido", "cereal", 112, 3.8, 23, 0.2, 1.4, 0.35, { aliases: ["cuscus", "semola", "bulgur"], perishable: false, shelfLifeDays: 3 }),
  f("quinoa", "quinoa cocida", "cereal", 120, 4.4, 21, 1.9, 2.8, 0.60, { aliases: ["quinua"], perishable: false, shelfLifeDays: 3 }),
  f("avena", "copos de avena", "cereal", 375, 13, 60, 7, 10, 0.30, { aliases: ["avena", "porridge", "gachas de avena"], perishable: false }),
  // Ticket 14 §3. Granola: Open Food Facts, mediana de 60 productos (en:granolas, 2026-09-25; p. ej.
  // 8402001010873, 8480000095367). Copos de maíz: mediana de 59 productos (en:corn-flakes,
  // 2026-09-25; p. ej. 8480000229663, 8410188012092).
  f("granola", "granola", "cereal", 439, 9, 61, 15.1, 8, 0.90, { aliases: ["granola crujiente", "granola casera"], perishable: false }),
  f("cereales-desayuno", "copos de maíz", "cereal", 376, 7.3, 83, 1, 3.5, 0.50, { aliases: ["corn flakes", "cereales", "cereales de desayuno", "copos de maiz", "cereales de maiz"], perishable: false }),
  // Rendimiento 0,89 = 77 kcal en crudo (USDA 170026) ÷ 86,5 cocida (USDA 170438): conserva la energía.
  f("patata", "patata cocida", "cereal", 87, 2, 20, 0.1, 1.8, 0.12, { aliases: ["patatas", "papa", "patata hervida", "patata asada", "pure de patata"], shelfLifeDays: 20, cookedYield: 0.89, basis: "cocinado" }),
  f("patata-frita", "patata frita casera", "cereal", 190, 3, 27, 8, 2.5, 0.20, { aliases: ["patatas fritas", "patatas panadera"], perishable: false }),
  f("boniato", "boniato", "cereal", 90, 2, 21, 0.1, 3, 0.25, { aliases: ["batata", "camote"], shelfLifeDays: 18 }),
  f("wrap", "wrap o tortilla de trigo", "cereal", 310, 8, 50, 8, 3, 0.60, { aliases: ["tortita de trigo", "tortilla mexicana", "fajita", "tortilla de maiz"], shelfLifeDays: 10 }),
  f("harina", "harina de trigo", "cereal", 364, 10, 76, 1, 2.7, 0.10, { aliases: ["harina", "maizena", "harina de maiz"], perishable: false }),
  f("pan-rallado", "pan rallado", "cereal", 350, 12, 66, 4, 4, 0.30, { aliases: ["panko"], perishable: false }),
  f("maiz-dulce", "maíz dulce", "cereal", 86, 3, 19, 1.2, 2.7, 0.35, { aliases: ["maiz", "mazorca", "maiz de lata"], perishable: false }),

  // ---------------------------------------------------------------- VERDURA
  f("tomate", "tomate", "verdura", 18, 0.9, 3.9, 0.2, 1.2, 0.20, { aliases: ["tomates", "tomate cherry", "tomate rama"], shelfLifeDays: 7 }),
  f("tomate-triturado", "tomate triturado", "verdura", 32, 1.6, 7, 0.3, 1.5, 0.15, { aliases: ["tomate en conserva", "tomate natural triturado", "tomate pera", "passata", "tomate entero de lata"], perishable: false }),
  f("tomate-frito", "tomate frito", "despensa", 82, 1.5, 11, 3.5, 1.5, 0.25, { aliases: ["salsa de tomate", "tomate frito de bote"], perishable: false }),
  f("cebolla", "cebolla", "verdura", 40, 1.1, 9, 0.1, 1.7, 0.12, { aliases: ["cebolleta", "cebolla morada", "chalota"], shelfLifeDays: 25 }),
  f("ajo", "ajo", "verdura", 149, 6, 33, 0.5, 2, 0.50, { aliases: ["diente de ajo", "ajos"], shelfLifeDays: 30 }),
  f("pimiento", "pimiento", "verdura", 26, 1, 6, 0.3, 2, 0.25, { aliases: ["pimiento rojo", "pimiento verde", "pimiento amarillo", "pimientos"], shelfLifeDays: 9 }),
  f("calabacin", "calabacín", "verdura", 17, 1.2, 3.1, 0.3, 1, 0.20, { aliases: ["calabacines", "zucchini"], shelfLifeDays: 7 }),
  f("berenjena", "berenjena", "verdura", 25, 1, 6, 0.2, 3, 0.20, { aliases: ["berenjenas"], shelfLifeDays: 7 }),
  f("zanahoria", "zanahoria", "verdura", 41, 0.9, 10, 0.2, 2.8, 0.10, { aliases: ["zanahorias"], shelfLifeDays: 20 }),
  f("brocoli", "brócoli", "verdura", 34, 2.8, 7, 0.4, 2.6, 0.30, { aliases: ["brecol"], shelfLifeDays: 5 }),
  f("coliflor", "coliflor", "verdura", 25, 1.9, 5, 0.3, 2, 0.25, { aliases: ["romanesco"], shelfLifeDays: 6 }),
  f("espinaca", "espinacas", "verdura", 23, 2.9, 3.6, 0.4, 2.2, 0.30, { aliases: ["espinaca", "espinacas frescas", "espinacas congeladas"], shelfLifeDays: 4 }),
  f("acelga", "acelgas", "verdura", 19, 1.8, 3.7, 0.2, 1.6, 0.25, { aliases: ["acelga", "grelos"], shelfLifeDays: 4 }),
  f("lechuga", "lechuga", "verdura", 15, 1.4, 2.9, 0.2, 1.3, 0.20, { aliases: ["ensalada", "escarola", "hoja de roble", "cogollo"], shelfLifeDays: 5 }),
  f("canonigos", "canónigos o rúcula", "verdura", 20, 2, 3.5, 0.4, 1.5, 0.80, { aliases: ["canonigos", "rucula", "brotes tiernos", "mezclum"], shelfLifeDays: 4 }),
  f("pepino", "pepino", "verdura", 15, 0.7, 3.6, 0.1, 0.5, 0.15, { shelfLifeDays: 8 }),
  f("judia-verde", "judía verde", "verdura", 31, 1.8, 7, 0.2, 3.4, 0.30, { aliases: ["judias verdes", "vainas", "chauchas"], shelfLifeDays: 6 }),
  f("champinon", "champiñones o setas", "verdura", 22, 3.1, 3.3, 0.3, 1, 0.40, { aliases: ["champinon", "champinones", "seta", "setas", "portobello"], shelfLifeDays: 5 }),
  f("calabaza", "calabaza", "verdura", 26, 1, 6.5, 0.1, 0.5, 0.15, { shelfLifeDays: 20 }),
  f("puerro", "puerro", "verdura", 61, 1.5, 14, 0.3, 1.8, 0.25, { aliases: ["puerros"], shelfLifeDays: 10 }),
  f("col", "col o repollo", "verdura", 25, 1.3, 6, 0.1, 2.5, 0.12, { aliases: ["repollo", "col rizada", "kale", "lombarda", "col lombarda"], shelfLifeDays: 14 }),
  f("esparragos", "espárragos", "verdura", 20, 2.2, 3.9, 0.1, 2.1, 0.50, { aliases: ["esparrago", "esparragos trigueros"], shelfLifeDays: 5 }),
  f("alcachofa", "alcachofa", "verdura", 47, 3.3, 11, 0.2, 5.4, 0.40, { aliases: ["alcachofas"], shelfLifeDays: 7 }),
  f("remolacha", "remolacha cocida", "verdura", 44, 1.7, 10, 0.2, 2, 0.30, { shelfLifeDays: 14 }),
  f("apio", "apio", "verdura", 16, 0.7, 3, 0.2, 1.6, 0.20, { shelfLifeDays: 10 }),
  f("gazpacho", "gazpacho", "verdura", 35, 1, 4, 1.8, 1, 0.30, { densityGPerMl: 1.02, shelfLifeDays: 4 }),
  // Separado de "gazpacho" (issue de precisión, 2026-09-19): compartía alias pese a llevar mucho
  // más pan y aceite por ración — el salmorejo casi cuadriplica las kcal/100g del gazpacho.
  f("salmorejo", "salmorejo", "verdura", 128, 2, 10, 9, 1.2, 0.35, { densityGPerMl: 1.03, shelfLifeDays: 4 }),
  f("aceituna", "aceitunas", "grasa", 145, 1, 4, 15, 3, 0.60, { aliases: ["aceituna", "olivas", "aceitunas negras", "aceitunas verdes"], perishable: false }),

  // ------------------------------------------------------------------ FRUTA
  f("manzana", "manzana", "fruta", 52, 0.3, 14, 0.2, 2.4, 0.20, { aliases: ["manzanas", "fruta", "fruta de temporada", "fruta fresca"], shelfLifeDays: 20 }),
  f("aguacate", "aguacate", "fruta", 160, 2, 9, 15, 7, 0.70, { aliases: ["aguacates", "guacamole"], shelfLifeDays: 6 }),
  f("platano", "plátano", "fruta", 89, 1.1, 23, 0.3, 2.6, 0.15, { aliases: ["banana", "platanos"], shelfLifeDays: 6 }),
  f("naranja", "naranja", "fruta", 47, 0.9, 12, 0.1, 2.4, 0.15, { aliases: ["naranjas", "zumo de naranja"], shelfLifeDays: 15 }),
  f("pera", "pera", "fruta", 57, 0.4, 15, 0.1, 3.1, 0.20, { aliases: ["peras"], shelfLifeDays: 12 }),
  f("fresa", "fresas", "fruta", 32, 0.7, 8, 0.3, 2, 0.40, { aliases: ["fresa", "freson"], shelfLifeDays: 4 }),
  f("uva", "uvas", "fruta", 69, 0.7, 18, 0.2, 0.9, 0.30, { aliases: ["uva"], shelfLifeDays: 8 }),
  f("sandia", "sandía", "fruta", 30, 0.6, 8, 0.2, 0.4, 0.10, { shelfLifeDays: 10 }),
  f("melon", "melón", "fruta", 34, 0.8, 8, 0.2, 0.9, 0.12, { shelfLifeDays: 10 }),
  f("kiwi", "kiwi", "fruta", 61, 1.1, 15, 0.5, 3, 0.40, { aliases: ["kiwis"], shelfLifeDays: 12 }),
  f("pina", "piña", "fruta", 50, 0.5, 13, 0.1, 1.4, 0.20, { aliases: ["pina", "ananas"], shelfLifeDays: 8 }),
  f("melocoton", "melocotón", "fruta", 39, 0.9, 10, 0.3, 1.5, 0.25, { aliases: ["nectarina", "paraguayo", "melocotones"], shelfLifeDays: 6 }),
  f("ciruela", "ciruela", "fruta", 46, 0.7, 11, 0.3, 1.4, 0.30, { aliases: ["ciruelas"], shelfLifeDays: 7 }),
  f("cereza", "cerezas", "fruta", 63, 1, 16, 0.2, 2.1, 0.60, { aliases: ["cereza", "picota"], shelfLifeDays: 5 }),
  f("arandano", "arándanos", "fruta", 57, 0.7, 14, 0.3, 2.4, 1.20, { aliases: ["arandano", "frutos rojos", "frutos del bosque"], shelfLifeDays: 6 }),
  f("frambuesa", "frambuesas", "fruta", 52, 1.2, 12, 0.7, 6.5, 1.50, { aliases: ["frambuesa", "mora", "moras"], shelfLifeDays: 3 }),
  f("mandarina", "mandarina", "fruta", 53, 0.8, 13, 0.3, 1.8, 0.20, { aliases: ["mandarinas", "clementina"], shelfLifeDays: 12 }),
  f("mango", "mango", "fruta", 60, 0.8, 15, 0.4, 1.6, 0.40, { aliases: ["papaya"], shelfLifeDays: 8 }),
  f("granada", "granada", "fruta", 83, 1.7, 19, 1.2, 4, 0.50, { shelfLifeDays: 14 }),
  f("limon", "limón", "fruta", 29, 1.1, 9, 0.3, 2.8, 0.20, { aliases: ["lima", "limones", "zumo de limon"], shelfLifeDays: 18 }),
  f("datil", "dátiles", "fruta", 277, 1.8, 75, 0.2, 7, 0.60, { aliases: ["datil"], perishable: false }),
  f("pasas", "pasas", "fruta", 299, 3, 79, 0.5, 3.7, 0.50, { aliases: ["uvas pasas", "orejones", "fruta desecada"], perishable: false }),
  f("albaricoque", "albaricoque", "fruta", 48, 1.4, 11, 0.4, 2, 0.40, { aliases: ["albaricoques", "damasco"], shelfLifeDays: 6 }),

  // ----------------------------------------------------------------- LÁCTEO
  f("leche-entera", "leche entera", "lacteo", 62, 3.2, 4.7, 3.5, 0, 0.10, { aliases: ["leche"], densityGPerMl: 1.03, shelfLifeDays: 6 }),
  f("leche-semi", "leche semidesnatada", "lacteo", 46, 3.3, 4.8, 1.6, 0, 0.10, { aliases: ["leche semi"], densityGPerMl: 1.03, shelfLifeDays: 6 }),
  f("leche-desnatada", "leche desnatada", "lacteo", 34, 3.4, 5, 0.2, 0, 0.10, { densityGPerMl: 1.03, shelfLifeDays: 6 }),
  // Ticket 14 §3: bebidas vegetales separadas de la de avena. Soja: Open Food Facts, mediana de 30
  // productos (en:soy-milks, 2026-09-24; p. ej. 8480000136824, 8480000293145). Almendra: mediana
  // de 60 productos (en:almond-based-drinks, 2026-09-25; p. ej. 8480000239266, 8480000156488).
  f("bebida-soja", "bebida de soja", "lacteo", 34, 3.1, 1.2, 1.7, 0.5, 0.15, { aliases: ["leche de soja", "bebida vegetal de soja"], densityGPerMl: 1.02, shelfLifeDays: 5 }),
  f("bebida-almendra", "bebida de almendra", "lacteo", 25, 0.7, 0.4, 2.1, 0.2, 0.20, { aliases: ["leche de almendras", "leche de almendra", "bebida de almendras"], densityGPerMl: 1.02, shelfLifeDays: 5 }),
  // Ticket 14 §3. USDA FoodData Central 171275 (Milk, canned, condensed, sweetened).
  f("leche-condensada", "leche condensada", "lacteo", 321, 7.9, 54, 8.7, 0, 0.60, { aliases: ["leche condensada azucarada"], densityGPerMl: 1.3, perishable: false }),
  f("bebida-avena", "bebida vegetal de avena", "lacteo", 45, 0.8, 7, 1.5, 0.8, 0.15, { aliases: ["leche de avena", "bebida vegetal"], densityGPerMl: 1.02, shelfLifeDays: 5 }),
  f("yogur-natural", "yogur natural", "lacteo", 61, 3.5, 4.7, 3.3, 0, 0.25, { aliases: ["yogur", "yogures"], shelfLifeDays: 12 }),
  f("yogur-griego", "yogur griego", "lacteo", 97, 9, 4, 5, 0, 0.40, { aliases: ["yogur skyr", "skyr"], shelfLifeDays: 12 }),
  f("yogur-desnatado", "yogur desnatado", "lacteo", 40, 4, 6, 0.1, 0, 0.30, { shelfLifeDays: 12 }),
  f("queso-batido", "queso batido o quark", "lacteo", 72, 12, 4, 0.2, 0, 0.40, { aliases: ["queso batido", "quark", "requeson desnatado"], shelfLifeDays: 10 }),
  f("queso-fresco", "queso fresco", "lacteo", 174, 12, 4, 12, 0, 0.70, { aliases: ["queso de burgos", "queso fresco batido", "mató"], shelfLifeDays: 8 }),
  f("requeson", "requesón o ricotta", "lacteo", 138, 11, 3, 8, 0, 0.60, { aliases: ["ricotta", "cottage"], shelfLifeDays: 8 }),
  f("queso-curado", "queso curado", "lacteo", 390, 26, 1, 32, 0, 1.50, { aliases: ["queso manchego", "queso viejo", "parmesano rallado"], shelfLifeDays: 30 }),
  f("queso-semicurado", "queso semicurado", "lacteo", 350, 25, 1, 27, 0, 1.20, { aliases: ["queso", "queso tierno", "queso en lonchas", "queso havarti", "queso gouda", "queso emmental"], shelfLifeDays: 20 }),
  f("mozzarella", "mozzarella", "lacteo", 250, 18, 3, 19, 0, 0.90, { aliases: ["queso mozzarella", "burrata"], shelfLifeDays: 8 }),
  f("parmesano", "parmesano", "lacteo", 402, 36, 4, 27, 0, 2.50, { aliases: ["queso parmesano", "grana padano", "pecorino"], shelfLifeDays: 30 }),
  f("feta", "queso feta", "lacteo", 264, 14, 4, 21, 0, 1.30, { aliases: ["queso feta", "queso de cabra"], shelfLifeDays: 12 }),
  f("queso-untar", "queso de untar", "lacteo", 250, 6, 5, 23, 0, 0.90, { aliases: ["queso crema", "philadelphia", "queso para untar"], shelfLifeDays: 14 }),
  f("mantequilla", "mantequilla", "grasa", 717, 0.9, 0.1, 81, 0, 1.00, { shelfLifeDays: 40 }),
  f("nata", "nata líquida", "lacteo", 292, 2.5, 3, 30, 0, 0.60, { aliases: ["crema de leche", "nata para cocinar", "creme fraiche"], densityGPerMl: 1.0, shelfLifeDays: 10 }),

  // ------------------------------------------------------------------ GRASA
  f("aceite-oliva", "aceite de oliva virgen extra", "grasa", 884, 0, 0, 100, 0, 0.90, { aliases: ["aceite", "aove", "aceite de oliva"], densityGPerMl: 0.91, perishable: false }),
  f("aceite-girasol", "aceite de girasol", "grasa", 884, 0, 0, 100, 0, 0.25, { aliases: ["aceite vegetal", "aceite de semillas"], densityGPerMl: 0.91, perishable: false }),
  f("aceite-coco", "aceite de coco", "grasa", 892, 0, 0, 99, 0, 1.20, { densityGPerMl: 0.92, perishable: false }),

  // ------------------------------------------------------------- FRUTO SECO
  f("almendra", "almendras", "fruto-seco", 579, 21, 22, 50, 12, 1.20, { aliases: ["almendra", "almendra cruda", "almendra tostada"], perishable: false }),
  f("nuez", "nueces", "fruto-seco", 654, 15, 14, 65, 7, 1.50, { aliases: ["nuez", "nuez de california"], perishable: false }),
  f("avellana", "avellanas", "fruto-seco", 628, 15, 17, 61, 10, 1.60, { aliases: ["avellana"], perishable: false }),
  f("pistacho", "pistachos", "fruto-seco", 560, 20, 28, 45, 10, 1.80, { aliases: ["pistacho"], perishable: false }),
  f("anacardo", "anacardos", "fruto-seco", 553, 18, 30, 44, 3, 1.60, { aliases: ["anacardo", "nuez de la india"], perishable: false }),
  f("cacahuete", "cacahuetes", "fruto-seco", 567, 26, 16, 49, 8, 0.60, { aliases: ["cacahuete", "mani"], perishable: false }),
  f("crema-cacahuete", "crema de cacahuete", "fruto-seco", 588, 25, 20, 50, 6, 0.90, { aliases: ["mantequilla de cacahuete", "crema de frutos secos"], perishable: false }),
  f("tahini", "tahini", "fruto-seco", 595, 17, 21, 54, 9, 1.20, { aliases: ["pasta de sesamo"], perishable: false }),
  f("pipas-girasol", "pipas de girasol", "fruto-seco", 584, 21, 20, 51, 9, 0.50, { aliases: ["pipas", "semillas de girasol", "semillas de calabaza"], perishable: false }),
  f("chia", "semillas de chía", "fruto-seco", 486, 17, 42, 31, 34, 1.50, { aliases: ["chia", "semillas"], perishable: false }),
  f("lino", "semillas de lino", "fruto-seco", 534, 18, 29, 42, 27, 0.60, { aliases: ["linaza"], perishable: false }),
  f("sesamo", "semillas de sésamo", "fruto-seco", 573, 18, 23, 50, 12, 0.80, { aliases: ["sesamo", "ajonjoli"], perishable: false }),
  f("pinones", "piñones", "fruto-seco", 673, 14, 13, 68, 4, 6.00, { aliases: ["pinon"], perishable: false }),

  // --------------------------------------------------------------- DESPENSA
  f("sal", "sal", "despensa", 0, 0, 0, 0, 0, 0.05, { aliases: ["sal marina", "sal fina", "agua", "hielo", "sal y pimienta"], perishable: false }),
  f("azucar", "azúcar", "despensa", 387, 0, 100, 0, 0, 0.10, { aliases: ["azucar blanco", "azucar moreno"], perishable: false }),
  f("miel", "miel", "despensa", 304, 0.3, 82, 0, 0, 0.60, { densityGPerMl: 1.42, perishable: false }),
  f("mermelada", "mermelada", "despensa", 250, 0.4, 60, 0.1, 0.8, 0.40, { aliases: ["confitura"], perishable: false }),
  f("cacao-polvo", "cacao en polvo puro", "despensa", 228, 20, 58, 14, 33, 1.00, { aliases: ["cacao puro", "cacao desgrasado"], perishable: false }),
  f("chocolate-negro", "chocolate negro", "despensa", 598, 7.8, 46, 43, 11, 1.50, { aliases: ["chocolate", "chocolate 70", "onza de chocolate", "chocolate para fundir"], perishable: false }),
  f("chocolate-leche", "chocolate con leche", "despensa", 535, 8, 59, 30, 2, 1.20, { perishable: false }),
  f("caldo", "caldo de verduras o pollo", "despensa", 6, 0.5, 0.5, 0.2, 0, 0.05, { aliases: ["caldo de pollo", "caldo de verduras", "fondo", "pastilla de caldo", "fumet"], densityGPerMl: 1.0, perishable: false }),
  f("leche-coco", "leche de coco", "despensa", 197, 2, 3, 21, 0, 0.50, { aliases: ["leche de coco de lata", "crema de coco"], densityGPerMl: 0.98, perishable: false }),
  f("salsa-soja", "salsa de soja", "despensa", 53, 8, 5, 0.1, 0.8, 0.60, { aliases: ["soja", "salsa teriyaki", "tamari"], densityGPerMl: 1.1, perishable: false }),
  f("mostaza", "mostaza", "despensa", 66, 4, 5, 3.3, 3, 0.50, { perishable: false }),
  f("ketchup", "kétchup", "despensa", 112, 1.2, 26, 0.2, 0.3, 0.40, { aliases: ["ketchup", "salsa barbacoa"], perishable: false }),
  f("mayonesa", "mayonesa", "despensa", 680, 1, 1.5, 75, 0, 0.50, { aliases: ["mahonesa", "alioli"], perishable: false }),
  f("vinagre", "vinagre", "despensa", 20, 0, 0.6, 0, 0, 0.20, { aliases: ["vinagre de jerez", "vinagre balsamico", "vinagre de manzana"], densityGPerMl: 1.01, perishable: false }),
  f("vino-cocinar", "vino para cocinar", "despensa", 83, 0.1, 2.6, 0, 0, 0.30, { aliases: ["vino blanco", "vino tinto", "brandy", "jerez"], densityGPerMl: 0.99, perishable: false }),
  f("coco-rallado", "coco rallado", "despensa", 660, 6.9, 24, 65, 16, 1.00, { perishable: false }),
  f("pan-hamburguesa", "pan de hamburguesa", "cereal", 290, 9, 50, 5, 3, 0.50, { aliases: ["pan de perrito", "bollo de hamburguesa"], shelfLifeDays: 8 }),
  f("masa-pizza", "masa de pizza", "cereal", 270, 8, 51, 3, 2.5, 0.50, { aliases: ["base de pizza", "masa quebrada", "masa de hojaldre", "masa brisa"], shelfLifeDays: 12 }),
  // Ticket 14 §3: platos-producto. Pizza: Open Food Facts, mediana de 6 productos
  // (en:margherita-pizzas, 2026-09-24; p. ej. 4056489443025, 20001650), la pizza entera
  // horneada. Croquetas: mediana de 34 productos (es:croquetas, 2026-09-25; p. ej.
  // 8480000134967, 8410239041613), congeladas ANTES de freír: el aceite retenido lo pone el
  // método `frito_rebozado`.
  f("pizza", "pizza", "cereal", 216, 8.8, 32, 6, 2, 0.80, { aliases: ["pizza margarita", "pizza de jamon y queso", "pizza barbacoa", "pizza cuatro quesos", "porcion de pizza"], shelfLifeDays: 3 }),
  f("croqueta", "croquetas", "cereal", 197, 6.8, 21.5, 8.4, 1, 0.70, { aliases: ["croquetas de jamon", "croquetas de pollo", "croqueta de jamon", "croquetas caseras"], shelfLifeDays: 4 }),
  f("pesto", "pesto", "despensa", 450, 5, 6, 45, 2, 1.50, { aliases: ["salsa pesto"], perishable: false }),
  f("sofrito", "sofrito", "despensa", 90, 1.5, 8, 6, 2, 0.40, { aliases: ["sofrito de tomate"], perishable: false }),
  f("levadura", "levadura", "despensa", 120, 12, 12, 1, 5, 0.80, { aliases: ["levadura de panaderia", "levadura quimica", "levadura nutricional"], perishable: false }),
  // Especias y aromáticas: se usan en gramos sueltos, así que el impacto en
  // macros es mínimo aunque el valor por 100 g sea alto. Una sola fila cubre
  // todo lo que la IA suele nombrar suelto.
  f("especias", "especias y aromáticas", "despensa", 250, 10, 45, 5, 25, 0.60, { aliases: ["especia", "curry", "curry en polvo", "canela", "jengibre", "pimenton", "comino", "oregano", "curcuma", "pimienta", "nuez moscada", "azafran", "hierbas provenzales", "hierbas aromaticas", "eneldo", "laurel"], perishable: false }),
  f("hierba-fresca", "hierbas frescas", "verdura", 40, 3, 7, 0.8, 3, 1.00, { aliases: ["perejil", "cilantro", "hierbabuena", "menta", "albahaca", "cebollino", "hierba fresca"], shelfLifeDays: 6 }),
  f("cafe", "café", "despensa", 2, 0.1, 0, 0, 0, 1.50, { aliases: ["cafe solo", "infusion", "cafe negro"], densityGPerMl: 1.0, perishable: false }),
  f("salsa-cesar", "salsa césar", "despensa", 430, 3, 5, 44, 0, 1.20, { aliases: ["aliño cesar", "salsa para ensalada", "vinagreta"], perishable: false }),
  f("cacao-avena", "harina de avena", "cereal", 375, 13, 60, 7, 10, 0.30, { aliases: ["harina de avena", "salvado de avena"], perishable: false }),

  // ---------------------------------------------------------------- PICOTEO
  // Lo que se pica entre horas (feature `picoteo-hoy`). Valores de USDA
  // FoodData Central (SR Legacy) y CIQUAL, por 100 g tal como se come; las
  // bebidas llevan su densidad. Van al final a propósito: un alias exacto ya
  // registrado arriba ("patatas fritas" → casera) sigue mandando.
  f("patatas-chips", "patatas fritas de bolsa", "despensa", 536, 6.6, 53, 35, 3.1, 0.80, { aliases: ["patatas de bolsa", "patatas chips", "chips", "bolsa de patatas", "bolsa de patatas fritas", "patatas fritas de paquete"], perishable: false }),
  f("aperitivo-maiz", "aperitivos de maíz", "despensa", 500, 7, 60, 25, 5, 0.90, { aliases: ["aperitivo", "aperitivos", "nachos", "doritos", "gusanitos", "ganchitos", "cheetos", "totopos", "tortilla chips"], perishable: false }),
  f("palomitas", "palomitas de maíz", "despensa", 500, 9, 58, 28, 10, 0.90, { aliases: ["palomitas", "palomitas de microondas", "cotufas", "popcorn"], perishable: false }),
  f("frutos-secos-mix", "frutos secos variados", "fruto-seco", 600, 18, 20, 52, 8, 1.30, { aliases: ["frutos secos", "coctel de frutos secos", "mezcla de frutos secos", "puñado de frutos secos"], perishable: false }),
  f("galleta", "galletas", "cereal", 436, 7, 74, 12, 2.5, 0.50, { aliases: ["galleta", "galletas maria", "galleta maria", "galletas digestive", "galleta digestive"], perishable: false }),
  f("galleta-chocolate", "galletas con chocolate", "cereal", 490, 5.5, 64, 24, 2.5, 0.90, { aliases: ["galletas de chocolate", "cookies", "cookie", "oreo", "galletas rellenas", "galleta rellena", "galletas con pepitas de chocolate"], perishable: false }),
  f("bolleria", "bollería", "cereal", 406, 8.2, 46, 21, 2.6, 0.90, { aliases: ["croissant", "cruasan", "napolitana", "napolitana de chocolate", "palmera", "palmera de chocolate", "donut", "berlina", "ensaimada", "caracola", "bolleria industrial"], shelfLifeDays: 4 }),
  f("magdalena", "magdalenas", "cereal", 440, 6, 52, 23, 1.2, 0.70, { aliases: ["magdalena", "bizcocho", "muffin", "sobao", "cupcake"], shelfLifeDays: 7 }),
  f("helado", "helado", "lacteo", 207, 3.5, 24, 11, 0.7, 0.70, { aliases: ["helados", "helado de vainilla", "helado de chocolate", "tarrina de helado", "cucurucho", "bombon helado"], perishable: false }),
  f("gominolas", "gominolas", "despensa", 340, 6, 77, 0, 0, 0.90, { aliases: ["gominola", "chuches", "chucherias", "golosinas", "caramelos de goma", "haribo", "nubes", "regaliz"], perishable: false }),
  f("chocolatina", "chocolatina", "despensa", 520, 6.5, 60, 28, 1.5, 1.60, { aliases: ["chocolatinas", "bombones", "bombon", "kitkat", "kinder", "barrita de chocolate", "nocilla", "nutella"], perishable: false }),
  f("barrita-cereales", "barrita de cereales", "cereal", 440, 7, 64, 17, 5, 1.20, { aliases: ["barrita", "barritas", "barrita energetica", "barrita de muesli", "barritas de cereales"], perishable: false }),
  f("barrita-proteina", "barrita de proteínas", "despensa", 360, 30, 35, 11, 5, 2.50, { aliases: ["barrita proteica", "barrita de proteina", "protein bar"], perishable: false }),
  f("cerveza", "cerveza", "despensa", 43, 0.5, 3.6, 0, 0, 0.25, { aliases: ["cervezas", "caña", "caña de cerveza", "tercio", "botellin", "cerveza rubia", "jarra de cerveza"], densityGPerMl: 1.01, perishable: false }),
  f("cerveza-sin", "cerveza sin alcohol", "despensa", 27, 0.3, 5.3, 0, 0, 0.25, { aliases: ["cerveza 0,0", "cerveza 0.0", "cerveza tostada 0,0"], densityGPerMl: 1.01, perishable: false }),
  f("destilado", "licor destilado", "despensa", 231, 0, 0, 0, 0, 1.50, { aliases: ["ginebra", "gin", "ron", "vodka", "whisky", "whiskey", "tequila", "licor"], densityGPerMl: 0.95, perishable: false }),
  f("refresco", "refresco azucarado", "despensa", 42, 0, 10.6, 0, 0, 0.15, { aliases: ["refresco", "refrescos", "coca cola", "cocacola", "refresco de cola", "fanta", "refresco de naranja", "refresco de limon", "tonica"], densityGPerMl: 1.04, perishable: false }),
  f("refresco-zero", "refresco sin azúcar", "despensa", 0, 0, 0, 0, 0, 0.15, { aliases: ["coca cola zero", "cola zero", "refresco zero", "refresco light", "coca cola light", "fanta zero"], densityGPerMl: 1.0, perishable: false }),
];

/**
 * "Ingrediente cualquiera" — el respaldo cuando el nombre no casa con nada y no
 * hay pista de categoría. Valores de un componente de plato cocinado medio
 * (algo entre una verdura y una proteína ligera). Marca `confidence: "low"`.
 */
export const GENERIC_FOOD: Food = {
  key: "__generico__",
  label: "ingrediente sin identificar",
  aliases: [],
  category: "despensa",
  kcal: 130,
  protein_g: 6,
  carbs_g: 14,
  fat_g: 5,
  fiber_g: 1.5,
  densityGPerMl: 1,
  perishable: false,
  shelfLifeDays: Infinity,
  pricePer100Eur: 0.5,
};

/** Todas las `key` válidas, para pasárselas al modelo en el prompt de descomposición. */
export const FOOD_KEYS: string[] = FOODS.map((food) => food.key);
