/**
 * Reglas en código sobre la receta que propone el modelo (ticket 05 de
 * `precision-nutricional`, invariante 2: ninguna receta se usa sin pasar por
 * aquí). El eval del 02 midió que el modelo acierta la COMPOSICIÓN (densidad
 * 5,2 %) y se pasa en la CANTIDAD, así que las reglas no le piden otra opinión:
 * recortan lo que se sale de la ración de AESAN, ponen la grasa según el método
 * y, solo si falta algo que el nombre del plato dice, piden UN reintento.
 *
 * Calibradas contra el golden set: ninguna receta de referencia se recorta ni
 * se marca como incompleta (`validate-recipe.test.ts`). Si una regla nueva lo
 * hace, la regla está mal.
 *
 * Puro: sin I/O ni modelo.
 */

import { normName } from "@/lib/plan-shared";

import { cookingFatGrams, OIL_BY_METHOD, OIL_FOOD_KEYS, type CookingMethod } from "./cooking";
import {
  foodByKey,
  macrosOf,
  matchFood,
  RAW_TO_COOKED,
  type Food,
  type ResolvedIngredient,
} from "./nutrition";

/** Comida a la que pertenece el plato; `null` si no se sabe (un plato suelto). */
export type RecipeSlot = "desayuno" | "comida" | "cena" | "merienda" | "distinto" | null;

/** "Desayuno", "Comida", "Cena", "Merienda" (el `moment` de Hoy) → su comida. */
export function recipeSlotOfMoment(moment: string | null | undefined): RecipeSlot {
  const m = normName(String(moment ?? ""));
  if (m.startsWith("desayuno")) return "desayuno";
  if (m.startsWith("comida") || m.startsWith("almuerzo")) return "comida";
  if (m.startsWith("cena")) return "cena";
  if (m.startsWith("merienda") || m.startsWith("snack")) return "merienda";
  return null;
}

export type RecipeFlag =
  | "grasa_por_metodo"
  | "recortado"
  | "inventado"
  | "falta_ingrediente"
  | "masa_fuera_de_rango"
  | "fuera_de_banda";

export type ValidatedRecipe = {
  ingredients: ResolvedIngredient[];
  flags: RecipeFlag[];
  /** Qué detalles justifican el flag, para el log y la revisión manual. */
  notes: string[];
  /** Pista para UN reintento con el modelo (omisiones, masa imposible). */
  retryHint?: string;
};

// ---------------------------------------------------------------------------
// Familias: lo que cuenta como "el mismo ingrediente" al buscar omisiones
// ---------------------------------------------------------------------------

const FAMILY_GROUPS: Record<string, readonly string[]> = {
  pan: ["pan-blanco", "pan-integral", "pan-molde", "biscote", "pan-hamburguesa"],
  pollo: ["pechuga-pollo", "muslo-pollo"],
  pavo: ["pavo-pechuga", "pechuga-pavo-loncheada"],
  atun: ["atun-fresco", "atun-lata", "atun-lata-aceite"],
  leche: ["leche-entera", "leche-semi", "leche-desnatada"],
  yogur: ["yogur-natural", "yogur-griego", "yogur-desnatado"],
  queso: [
    "queso-curado",
    "queso-semicurado",
    "queso-fresco",
    "queso-batido",
    "queso-untar",
    "mozzarella",
    "parmesano",
    "feta",
    "requeson",
  ],
  tomate: ["tomate", "tomate-triturado", "tomate-frito"],
  huevo: ["huevo", "clara-huevo"],
  chorizo: ["chorizo", "chorizo-fresco"],
  arroz: ["arroz-blanco", "arroz-crudo", "arroz-integral", "arroz-integral-crudo"],
  pasta: ["pasta", "pasta-cruda", "pasta-integral", "pasta-integral-cruda"],
  alubias: ["alubias-blancas", "alubias-negras", "alubias-blancas-secas", "alubias-negras-secas"],
  patata: ["patata", "patata-frita"],
  aceite: [...OIL_FOOD_KEYS],
  chocolate: ["chocolate-negro", "chocolate-leche"],
  cerveza: ["cerveza", "cerveza-sin"],
};

const FAMILY_OF = new Map<string, string>();
for (const [family, keys] of Object.entries(FAMILY_GROUPS)) {
  for (const key of keys) FAMILY_OF.set(key, family);
}

/** Familia de una fila: su grupo, o la fila cocida de una en seco, o la propia clave. */
export function familyOf(food: Food): string {
  return FAMILY_OF.get(food.key) ?? RAW_TO_COOKED[food.key] ?? food.key;
}

/**
 * Filas que son un plato entero (pizza, tortilla, croquetas…): si el título las
 * nombra, la receta puede traerlas descompuestas en sus ingredientes, así que no
 * cuentan como omisión.
 */
const COMPOSITE_KEYS: ReadonlySet<string> = new Set([
  "pizza",
  "tortilla-patatas",
  "croqueta",
  "gazpacho",
  "salmorejo",
  "hummus",
  "sofrito",
  "pesto",
  "masa-pizza",
  "bolleria",
  "magdalena",
]);

/** Filas sin peso en kcal que un título puede nombrar sin que haga falta verlas. */
const NEGLIGIBLE_KEYS: ReadonlySet<string> = new Set([
  "especias",
  "sal",
  "hierba-fresca",
  "cafe",
  "vinagre",
  "caldo",
  "levadura",
]);

/** Palabras de un título que nombran un grupo, no un alimento ("fruta", "ensalada"). */
const GENERIC_TITLE_WORDS: ReadonlySet<string> = new Set([
  "fruta",
  "frutas",
  "fruta de temporada",
  "fruta fresca",
  "ensalada",
  "ensalada mixta",
  "verdura",
  "verduras",
  "carne",
  "pescado",
  "pescado blanco",
  "marisco",
  "legumbre",
  "legumbres",
  "cereales",
  "frutos rojos",
  "frutos del bosque",
]);

/** Trozos del título que nombran un componente: "A con B y C, D · E". */
const titleSegments = (title: string): string[] =>
  normName(title)
    .split(/\s*[,·:;+]\s*|\s+con\s+|\s+y\s+|\s+e\s+|\s+mas\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Un casado seguro para un trozo: la frase entera, o si no, alguna de sus palabras. */
function titleFoods(segment: string): Food[] {
  if (GENERIC_TITLE_WORDS.has(segment)) return [];
  const whole = matchFood(segment);
  if (whole?.confidence === "high") return [whole.food];
  const out: Food[] = [];
  for (const word of segment.split(/\s+/)) {
    if (word.length < 3 || GENERIC_TITLE_WORDS.has(word)) continue;
    const m = matchFood(word);
    if (m?.confidence === "high") out.push(m.food);
  }
  return out;
}

/**
 * Los alimentos que el título nombra y que la receta no trae (por familia).
 * Solo cuentan los casados seguros: un casado flojo nunca pide un reintento.
 */
export function missingTitleFoods(
  title: string,
  ingredients: readonly ResolvedIngredient[],
): Food[] {
  const present = new Set(ingredients.map((ing) => familyOf(ing.food)));
  const missing = new Map<string, Food>();
  for (const segment of titleSegments(title)) {
    for (const food of titleFoods(segment)) {
      if (COMPOSITE_KEYS.has(food.key) || NEGLIGIBLE_KEYS.has(food.key)) continue;
      const family = familyOf(food);
      // El aceite lo pone el código (`applyCookingFat`), no se le pide al modelo.
      if (family === "aceite") continue;
      if (!present.has(family)) missing.set(family, food);
    }
  }
  return [...missing.values()];
}

// ---------------------------------------------------------------------------
// Grasa de cocinar (invariante 14)
// ---------------------------------------------------------------------------

const isCookingFat = (ing: ResolvedIngredient, flaggedFat: boolean) =>
  OIL_FOOD_KEYS.has(ing.food.key) || (flaggedFat && ing.food.category === "grasa");

const OLIVE_OIL = foodByKey("aceite-oliva")!;

/**
 * Sustituye la grasa de cocinar que puso el modelo por la de `OIL_BY_METHOD`.
 * `fatFlags[i]` = el modelo marcó el ingrediente i como grasa de cocinar (una
 * mantequilla para untar o dorar). Se conserva el tipo de grasa (la primera que
 * nombró), pero la cantidad es de la tabla. Sin ningún método entendido, se deja
 * la del modelo: sin método no hay tabla que aplicar.
 */
export function applyCookingFat(
  ingredients: readonly ResolvedIngredient[],
  methods: readonly CookingMethod[],
  dishText: string,
  fatFlags: readonly boolean[] = [],
): { ingredients: ResolvedIngredient[]; changed: boolean } {
  if (!methods.length) return { ingredients: [...ingredients], changed: false };
  const fats: ResolvedIngredient[] = [];
  const rest: ResolvedIngredient[] = [];
  ingredients.forEach((ing, i) => (isCookingFat(ing, !!fatFlags[i]) ? fats : rest).push(ing));

  const allReady = rest.length > 0 && rest.every((ing) => ing.state === "listo");
  let grams = cookingFatGrams(methods, dishText, { allReady });
  // "Tostada con aceite" clasificada como cruda: el título manda.
  if (!grams && /\baceite\b/.test(normName(dishText)) && !/\bsin aceite\b/.test(normName(dishText)))
    grams = OIL_BY_METHOD.untada;

  const before = fats.reduce((sum, ing) => sum + ing.grams, 0);
  if (!grams) return { ingredients: rest, changed: before > 0 };
  const food = fats[0]?.food ?? OLIVE_OIL;
  const fat: ResolvedIngredient = {
    name: fats[0]?.name || "aceite de oliva",
    grams,
    gramsRaw: grams,
    state: "listo",
    food,
    confidence: "high",
  };
  return { ingredients: [...rest, fat], changed: Math.round(before) !== grams };
}

// ---------------------------------------------------------------------------
// Rangos por ingrediente, en crudo y por ración base (AESAN, punto medio)
// ---------------------------------------------------------------------------

type RangeRule = { id: string; max: number; applies: (food: Food) => boolean };

const DRY_STARCH = new Set([
  "arroz-crudo",
  "arroz-integral-crudo",
  "pasta-cruda",
  "pasta-integral-cruda",
  "couscous-seco",
  "quinoa-cruda",
]);
const DRY_LEGUME = new Set([
  "lentejas-secas",
  "garbanzos-secos",
  "alubias-blancas-secas",
  "alubias-negras-secas",
]);
const CURED_CHEESE = new Set(["queso-curado", "queso-semicurado", "parmesano"]);

/**
 * Techos por ración base (solo hacia abajo: el sesgo medido es de más, y una
 * cantidad pequeña puede ser un ingrediente secundario legítimo, como 40 g de
 * salmón en una ensalada). Van en gramos EN CRUDO o en seco: una fila cocida se
 * pasa a su equivalente en seco por la energía (`rawEquivalent`).
 */
const RANGE_RULES: RangeRule[] = [
  {
    id: "carne o pescado",
    max: 180,
    applies: (f) => f.category === "proteina" && !!f.cookedYield,
  },
  { id: "arroz o pasta en seco", max: 100, applies: (f) => DRY_STARCH.has(f.key) },
  { id: "legumbre en seco", max: 90, applies: (f) => DRY_LEGUME.has(f.key) },
  { id: "frutos secos", max: 40, applies: (f) => f.category === "fruto-seco" },
  { id: "queso curado", max: 50, applies: (f) => CURED_CHEESE.has(f.key) },
  { id: "huevo", max: 150, applies: (f) => f.key === "huevo" },
];

/** Gramos del ingrediente en crudo/seco, que es como están los techos. */
function rawEquivalent(ing: ResolvedIngredient): { food: Food; grams: number } {
  // Fila cocida con pareja en seco (arroz cocido): misma energía en seco.
  const dryKey = Object.entries(RAW_TO_COOKED).find(([, cooked]) => cooked === ing.food.key)?.[0];
  const dry = dryKey ? foodByKey(dryKey) : null;
  if (dry && dry.kcal > 0) return { food: dry, grams: (ing.grams * ing.food.kcal) / dry.kcal };
  if (ing.food.cookedYield && (ing.food.basis ?? "cocinado") === "cocinado") {
    return { food: ing.food, grams: ing.grams / ing.food.cookedYield };
  }
  return { food: ing.food, grams: ing.grams };
}

const scaleIngredient = (ing: ResolvedIngredient, factor: number): ResolvedIngredient => ({
  ...ing,
  grams: Math.max(1, Math.round(ing.grams * factor)),
  ...(ing.gramsRaw != null ? { gramsRaw: Math.max(1, Math.round(ing.gramsRaw * factor)) } : {}),
});

// ---------------------------------------------------------------------------
// Inventados
// ---------------------------------------------------------------------------

const CREAM = /\b(crema|pure|sopa fria|vichyssoise)\b/;
/** Fruta que se come entera al lado, no troceada encima. */
const WHOLE_FRUIT = new Set(["naranja", "mandarina"]);
/**
 * Media pieza: el golden set pone 60 g de plátano y 75 g de manzana troceada
 * sobre un yogur (el ticket decía 60; con 60 se recortaba la referencia). Lo
 * que el eval midió como error era la pieza entera, 150 g.
 */
const FRUIT_TOPPING_MAX = 80;

/**
 * AESAN: 1 huevo (50 g comestibles) por ración, salvo que el huevo SEA el plato
 * (tortilla, revuelto: el primer trozo del título) o el nombre diga cuántos. El
 * eval midió 2 huevos en "tostada con huevo revuelto", donde el huevo acompaña.
 */
const EGG_DISH = /\b(tortillas?|revueltos?|huevos?|shakshuka|frittata|pisto con huevos)\b/;
const EGG_COUNT = /\b(\d+|dos|tres|cuatro)\s+huevos?\b/;
const ONE_EGG_G = 50;

// ---------------------------------------------------------------------------
// Bandas por comida (kcal por ración base) y masa total
// ---------------------------------------------------------------------------

const KCAL_BAND: Record<Exclude<RecipeSlot, null | "distinto">, [number, number]> = {
  desayuno: [200, 550],
  comida: [400, 900],
  cena: [300, 800],
  merienda: [80, 400],
};

const MASS_RANGE: [number, number] = [150, 850];
const EATING_OUT = /\b(menu|restaurante|bar|tapas?|raciones)\b/;

/**
 * Valida y corrige una receta ya resuelta contra la tabla (ración base, gramos
 * en la base de cada fila). Devuelve la receta corregida, sus flags y, si hace
 * falta, la pista de UN reintento.
 *
 * - **Omisión**: un alimento que el título nombra y la receta no trae → reintento.
 * - **Inventado**: patata en una crema que no la nombra (fuera), caldo en una
 *   crema que no lo nombra (pasa a agua), fruta troceada encima por encima de
 *   media pieza (se recorta).
 * - **Rango**: techo por ingrediente (`RANGE_RULES`), se recorta.
 * - **Masa** de una comida o cena fuera de 150-850 g → reintento.
 * - **Banda** de kcal por comida: solo flag. No pide reintento a propósito: el
 *   golden set tiene cenas de verdad por debajo (una crema de 126 kcal), y
 *   pedirle al modelo "más" es justo lo que infla las raciones (D7). Cuadrar el
 *   día con el objetivo es cosa de la estructura de la comida (23) y del
 *   escalado (08), no de la receta de un plato.
 */
export function validateRecipe(
  input: readonly ResolvedIngredient[],
  dishName: string,
  slot: RecipeSlot,
): ValidatedRecipe {
  const title = normName(dishName);
  const flags = new Set<RecipeFlag>();
  const notes: string[] = [];
  const hints: string[] = [];
  let ingredients = [...input];

  // Inventados.
  if (CREAM.test(title)) {
    const before = ingredients.length;
    if (!/\bpatatas?\b/.test(title)) {
      ingredients = ingredients.filter((ing) => familyOf(ing.food) !== "patata");
    }
    if (ingredients.length !== before) {
      flags.add("inventado");
      notes.push("patata en una crema que no la nombra");
    }
    if (!/\bcaldo\b/.test(title)) {
      const water = foodByKey("sal")!;
      ingredients = ingredients.map((ing) => {
        if (ing.food.key !== "caldo") return ing;
        flags.add("inventado");
        notes.push("caldo en una crema que no lo nombra: agua");
        return { ...ing, food: water, name: "agua" };
      });
    }
  }
  const head = titleSegments(title)[0] ?? "";
  const headFoods = titleFoods(head).map(familyOf);
  ingredients = ingredients.map((ing) => {
    const food = ing.food;
    if (food.category !== "fruta" || WHOLE_FRUIT.has(food.key)) return ing;
    if (headFoods.includes(familyOf(food)) || !headFoods.length) return ing;
    if (ing.grams <= FRUIT_TOPPING_MAX) return ing;
    flags.add("inventado");
    notes.push(`${food.key}: fruta troceada ${ing.grams} → ${FRUIT_TOPPING_MAX} g`);
    return scaleIngredient(ing, FRUIT_TOPPING_MAX / ing.grams);
  });

  // Un huevo si acompaña.
  const eggIsDish = EGG_DISH.test(head) || EGG_COUNT.test(title);
  if (!eggIsDish) {
    ingredients = ingredients.map((ing) => {
      if (ing.food.key !== "huevo" || ing.grams <= ONE_EGG_G + 10) return ing;
      flags.add("recortado");
      notes.push(`huevo: ${ing.grams} → ${ONE_EGG_G} g (acompaña: 1 huevo)`);
      return scaleIngredient(ing, ONE_EGG_G / ing.grams);
    });
  }

  // Rangos.
  ingredients = ingredients.map((ing) => {
    const rule = RANGE_RULES.find((r) => r.applies(rawEquivalent(ing).food));
    if (!rule) return ing;
    const raw = rawEquivalent(ing).grams;
    if (raw <= rule.max) return ing;
    flags.add("recortado");
    notes.push(`${ing.food.key}: ${Math.round(raw)} g → ${rule.max} g (${rule.id})`);
    return scaleIngredient(ing, rule.max / raw);
  });

  // Omisiones.
  const missing = missingTitleFoods(dishName, ingredients);
  if (missing.length) {
    flags.add("falta_ingrediente");
    const names = missing.map((f) => f.label);
    notes.push(`falta: ${names.join(", ")}`);
    hints.push(
      `El nombre del plato dice ${names.join(", ")} y no está entre los ingredientes: añádelo.`,
    );
  }

  // Masa de una comida principal.
  if (slot === "comida" || slot === "cena") {
    const mass = ingredients.reduce((sum, ing) => sum + ing.grams, 0);
    if (mass < MASS_RANGE[0] || mass > MASS_RANGE[1]) {
      flags.add("masa_fuera_de_rango");
      notes.push(`masa ${Math.round(mass)} g`);
      hints.push(
        `La ración suma ${Math.round(mass)} g; una ración de ${slot} para un adulto pesa entre ` +
          `${MASS_RANGE[0]} y ${MASS_RANGE[1]} g: revisa las cantidades.`,
      );
    }
  }

  // Banda de kcal: solo flag (ver arriba).
  if (slot && slot !== "distinto") {
    const [low, high] = KCAL_BAND[slot];
    const widen = EATING_OUT.test(title) ? 1.25 : 1;
    const kcal = macrosOf(ingredients).kcal;
    if (kcal < low || kcal > high * widen) {
      flags.add("fuera_de_banda");
      notes.push(`${kcal} kcal para ${slot}`);
    }
  }

  return {
    ingredients,
    flags: [...flags],
    notes,
    ...(hints.length ? { retryHint: hints.join(" ") } : {}),
  };
}
