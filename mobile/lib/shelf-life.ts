// Copia de `src/lib/shopping/shelf-life.ts` de la web (no hay código compartido,
// ver AGENTS.md). Si cambia allí, hay que replicarlo aquí.

// Mismo resultado que `normName` de plan-shared: no se importa de allí porque
// plan-shared usa este módulo (cadencia optimizada) y sería un ciclo.
const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Cuántos días aguanta en casa un ingrediente antes de estropearse. Se usa para
 * avisar cuando una compra tiene que cubrir más días de los que un fresco
 * resiste (p. ej. pescado en una compra bisemanal o mensual): la lista no se
 * reestructura — se sesga el plan hacia larga vida y se avisa de lo que no
 * llega. `Infinity` = despensa/congelado/conserva, no caduca a efectos de plan.
 *
 * Los valores son deliberadamente conservadores (nevera doméstica normal, sin
 * congelar) y aproximados: el objetivo es decidir "esto no aguanta dos semanas",
 * no gestionar caducidades reales.
 *
 * Lo decide el código, no la IA (2026-10-27): la IA marcaba `perishable: false`
 * frescos de verdad (la zanahoria de noviembre) y, como esa marca mandaba, la
 * cadencia optimizada metía la del mes entero en la primera compra. La marca
 * de la IA solo decide cuando el código no reconoce el ingrediente.
 *
 * No sale de la tabla de alimentos (`foods.data.ts`): esa tabla describe el
 * alimento tal como se come (arroz cocido: 3 días; espinaca: 4 aunque se
 * compre congelada), no como se compra.
 */

/** Palabra clave del nombre → días que aguanta. El primer match gana. */
const SHELF_LIFE_BY_KEYWORD: { match: string[]; days: number }[] = [
  {
    match: ["pescado", "merluza", "salmon", "atun fresco", "dorada", "lubina", "bacalao fresco"],
    days: 2,
  },
  {
    match: ["marisco", "gamba", "langostino", "mejillon", "almeja", "calamar", "sepia", "pulpo"],
    days: 2,
  },
  { match: ["carne picada", "pollo", "pavo", "higado"], days: 2 },
  { match: ["ternera", "cerdo", "cordero", "filete", "solomillo", "carne"], days: 3 },
  {
    match: [
      "espinaca",
      "acelga",
      "canonigo",
      "rucula",
      "lechuga",
      "escarola",
      "brote",
      "hoja",
      "berro",
    ],
    days: 4,
  },
  { match: ["fresa", "frambuesa", "mora", "arandano", "cereza", "higo", "frutos rojos"], days: 4 },
  {
    match: ["champinon", "seta", "brocoli", "esparrago", "guisante fresco", "haba fresca"],
    days: 5,
  },
  {
    match: [
      "aguacate",
      "platano",
      "pera",
      "melocoton",
      "nectarina",
      "ciruela",
      "albaricoque",
      "kiwi",
      "mango",
    ],
    days: 5,
  },
  { match: ["tomate", "pepino", "calabacin", "pimiento", "berenjena", "judia verde"], days: 7 },
  {
    match: ["leche fresca", "nata", "yogur", "queso fresco", "requeson", "queso de burgos"],
    days: 7,
  },
  { match: ["pan", "pan de molde"], days: 4 },
  {
    match: [
      "manzana",
      "naranja",
      "mandarina",
      "pomelo",
      "limon",
      "zanahoria",
      "remolacha",
      "col",
      "puerro",
      "apio",
    ],
    days: 15,
  },
  { match: ["huevo"], days: 21 },
  // Larga vida en despensa fresca: no deberían saltar el aviso ni en una compra mensual.
  { match: ["patata", "cebolla", "ajo", "boniato", "calabaza", "nabo"], days: 32 },
];

/** Vida útil por categoría de la lista de la compra, cuando el nombre no da pistas. */
const SHELF_LIFE_BY_CATEGORY: Record<string, number> = {
  "Verdura y fruta": 6,
  Proteína: 3,
  Lácteos: 7,
  Despensa: Infinity,
  Otros: 10,
};

/**
 * Forma de compra que no caduca a efectos del plan aunque el alimento sea
 * fresco: "Merluza congelada", "Tomate triturado en conserva", "Leche UHT",
 * "Garbanzo seco". Manda sobre todo lo demás.
 */
const LONG_LIFE_WORDS = [
  ...["conserva", "lata", "bote", "tarro", "brick", "uht", "seco", "seca", "polvo", "almibar"],
];
const LONG_LIFE_PREFIXES = ["congelad", "enlatad", "deshidratad", "esteriliz", "liofiliz"];

/**
 * Elaborado a partir de un fresco: "Tomate frito", "Pan rallado", "Caldo de
 * pollo", "Mermelada de fresa". El fresco del nombre no dice cuánto dura, así
 * que se salta la tabla de frescos y decide la marca de la IA.
 */
const PROCESSED_WORDS = [
  ...["frito", "frita", "rallado", "rallada", "tostado", "tostada", "triturado", "triturada"],
];
const PROCESSED_HEADS = ["caldo", "salsa", "mermelada", "zumo", "sopa", "pure", "harina", "bebida"];

/** Palabras del nombre, sin acentos ni signos ("Judías verdes" → judias, verdes). */
const nameWords = (name: string): string[] =>
  norm(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** La misma palabra o su plural ("huevo"/"huevos", "limon"/"limones"). */
const sameWord = (word: string, key: string) =>
  word === key || word === `${key}s` || word === `${key}es`;

/**
 * ¿Aparece la palabra clave en el nombre, como palabras enteras y seguidas?
 * Por trozos de texto, "col" casaba con "chocolate" y "lata" con "plátano".
 */
const hasKeyword = (words: string[], keyword: string): boolean => {
  const parts = keyword.split(" ");
  for (let i = 0; i + parts.length <= words.length; i++) {
    if (parts.every((part, j) => sameWord(words[i + j]!, part))) return true;
  }
  return false;
};

const isLongLifeWord = (word: string) =>
  LONG_LIFE_WORDS.some((key) => sameWord(word, key)) ||
  LONG_LIFE_PREFIXES.some((prefix) => word.startsWith(prefix));

/**
 * Días que un ingrediente aguanta en casa. En este orden:
 *
 * 1. Forma de compra de larga vida (congelado, conserva, UHT, seco…): nunca caduca.
 * 2. Fresco conocido por su nombre: sus días, diga lo que diga la IA. Salvo si
 *    es un elaborado ("tomate frito", "caldo de pollo"), que pasa al paso 3.
 * 3. La marca de la IA: `perishable === false` es despensa.
 * 4. La categoría, y si tampoco se reconoce, 10 días (fresco genérico prudente).
 */
export const shelfLifeDays = (name: string, category: string, perishable: boolean): number => {
  const words = nameWords(name);
  if (words.some(isLongLifeWord)) return Infinity;
  const processed =
    words.some((word) => PROCESSED_WORDS.includes(word)) ||
    PROCESSED_HEADS.some((head) => sameWord(words[0] ?? "", head));
  if (!processed) {
    for (const entry of SHELF_LIFE_BY_KEYWORD) {
      if (entry.match.some((keyword) => hasKeyword(words, keyword))) return entry.days;
    }
  }
  if (!perishable) return Infinity;
  return SHELF_LIFE_BY_CATEGORY[category] ?? 10;
};

/**
 * Frescos que la cadencia optimizada compra de una vez con la despensa: duran
 * semanas en un sitio fresco y seco. Solo si dan nombre al artículo ("Patatas",
 * "Cebolla morada", "Cabeza de ajo"), no si son un ingrediente más de otra cosa.
 */
const STOCK_UP_PRODUCE = ["patata", "cebolla", "ajo"];
const GARLIC_UNITS = ["cabeza", "diente"];

/**
 * ¿Se compra de una vez para el mes en la cadencia optimizada? Lo que no caduca
 * (despensa, conservas, congelados, legumbre seca, arroz, pasta…) y patata,
 * cebolla y ajo. Todo lo demás fresco va en la compra de los días en que se
 * come (decisión del usuario, 2026-10-27): adelantar la fruta o los huevos que
 * "aguantan" dos semanas se leía como comprar perecederos antes de tiempo.
 */
export const stocksUp = (name: string, category: string, perishable: boolean): boolean => {
  if (shelfLifeDays(name, category, perishable) === Infinity) return true;
  const words = nameWords(name);
  const head = words[0] ?? "";
  if (STOCK_UP_PRODUCE.some((key) => sameWord(head, key))) return true;
  return (
    GARLIC_UNITS.some((unit) => sameWord(head, unit)) &&
    words[1] === "de" &&
    sameWord(words[2] ?? "", "ajo")
  );
};

/**
 * Lo que se congela en casa sin estropearse: carne, pescado, pan y la verdura
 * que se cocina. La hoja de ensalada, la fruta, el tomate o el yogur no, y un
 * nombre que no se reconoce tampoco: el aviso de frescos solo propone congelar
 * cuando tiene sentido.
 */
const FREEZES_WELL = [
  ...["pescado", "merluza", "salmon", "atun fresco", "dorada", "lubina", "bacalao"],
  ...["marisco", "gamba", "langostino", "mejillon", "almeja", "calamar", "sepia", "pulpo"],
  ...["carne", "pollo", "pavo", "higado", "ternera", "cerdo", "cordero", "filete", "solomillo"],
  ...["pan", "espinaca", "acelga", "brocoli", "judia verde", "guisante", "haba"],
];

export const freezesWell = (name: string): boolean => {
  const words = nameWords(name);
  return FREEZES_WELL.some((keyword) => hasKeyword(words, keyword));
};
