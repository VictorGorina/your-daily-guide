// ---------------------------------------------------------------------------
// Food-category colour system for Peppers
// One accent hex per category (spec §4) + keyword-based dish classifier (Spanish).
// Card/badge backgrounds are derived from `accent` at 10–20% opacity at the
// point of use (see food-category-bg.tsx), never stored pre-mixed — that way
// they automatically respect whichever theme/surface is active.
// ---------------------------------------------------------------------------

export type FoodCategory =
  "verdura" | "pescado" | "carne" | "pollo" | "pasta" | "fruta" | "lacteo" | "legumbre" | "otro";

export const FOOD_CATEGORIES: Record<
  FoodCategory,
  { label: string; accent: string; icon: string; asset: string | null }
> = {
  verdura: { label: "Verduras", accent: "#6DBE7B", icon: "🥬", asset: "/food/cat-verduras.png" },
  pescado: { label: "Pescado", accent: "#4C9BD6", icon: "🐟", asset: "/food/icon-pescado.svg" },
  carne: { label: "Carne", accent: "#E57373", icon: "🥩", asset: "/food/cat-carne.png" },
  pollo: { label: "Aves", accent: "#F2C14E", icon: "🍗", asset: "/food/icon-aves.svg" },
  pasta: { label: "Cereales", accent: "#D7B58A", icon: "🌾", asset: "/food/icon-cereales.svg" },
  fruta: { label: "Fruta", accent: "#FF8A3D", icon: "🍊", asset: "/food/cat-fruta.png" },
  lacteo: { label: "Lácteos", accent: "#F5E6C8", icon: "🥛", asset: "/food/cat-lacteos.png" },
  legumbre: {
    label: "Legumbres",
    accent: "#9A7655",
    icon: "🫘",
    asset: "/food/icon-legumbres.svg",
  },
  otro: { label: "Otro", accent: "#83796C", icon: "🍽️", asset: null },
};

// ---------------------------------------------------------------------------
// Keyword lists — multi-word entries MUST come before their single-word parts
// so "crema de verduras" matches before "crema".
// ---------------------------------------------------------------------------

const KEYWORDS: [FoodCategory, string[]][] = [
  [
    "verdura",
    [
      // multi-word first
      "crema de verduras",
      "crema de calabacin",
      "crema de calabaza",
      "crema de espinacas",
      "crema de brocoli",
      "crema de puerro",
      "crema de zanahoria",
      "wok de verduras",
      "salteado de verduras",
      "revuelto de verduras",
      "revuelto de espinacas",
      "revuelto de champiñones",
      "revuelto de setas",
      "judias verdes",
      "pimientos rellenos",
      "pimientos del padron",
      "pimientos asados",
      "tomate frito",
      "pure de patata",
      "pure de verduras",
      "tortilla de patata",
      "tortilla de espinacas",
      "tortilla francesa",
      // single words
      "ensalada",
      "verdura",
      "verduras",
      "brocoli",
      "espinaca",
      "espinacas",
      "calabacin",
      "calabaza",
      "tomate",
      "pimiento",
      "pimientos",
      "berenjena",
      "coliflor",
      "acelga",
      "acelgas",
      "lechuga",
      "pepino",
      "zanahoria",
      "zanahorias",
      "remolacha",
      "alcachofa",
      "alcachofas",
      "esparrago",
      "esparragos",
      "champiñon",
      "champiñones",
      "seta",
      "setas",
      "guisante",
      "guisantes",
      "menestra",
      "pisto",
      "gazpacho",
      "salmorejo",
      "escalivada",
      "ratatouille",
      "vichyssoise",
      "borraja",
      "cardo",
      "nabo",
      "rabano",
      "puerro",
      "apio",
      "endivia",
      "berro",
      "rucula",
      "canonigo",
      "canonigos",
      "col",
      "repollo",
      "lombarda",
      "boniato",
    ],
  ],
  [
    "pescado",
    [
      // multi-word
      "poke bowl",
      "fish and chips",
      "ceviche de pescado",
      "ceviche de gambas",
      "ceviche de salmon",
      "tataki de atun",
      "tartar de salmon",
      "tartar de atun",
      // single words
      "pescado",
      "salmon",
      "atun",
      "merluza",
      "bacalao",
      "lubina",
      "dorada",
      "sardina",
      "sardinas",
      "boqueron",
      "boquerones",
      "anchoa",
      "anchoas",
      "trucha",
      "rape",
      "lenguado",
      "rodaballo",
      "gamba",
      "gambas",
      "langostino",
      "langostinos",
      "mejillon",
      "mejillones",
      "calamar",
      "calamares",
      "pulpo",
      "sepia",
      "marisco",
      "mariscos",
      "ceviche",
      "sushi",
      "sashimi",
      "poke",
      "chirla",
      "chirlas",
      "almeja",
      "almejas",
      "berberecho",
      "berberechos",
      "langosta",
      "bogavante",
      "centollo",
      "percebe",
      "percebes",
      "vieira",
      "navaja",
      "navajas",
      "caballa",
      "pez espada",
      "emperador",
      "mero",
      "besugo",
      "jurel",
      "bonito",
      "palometa",
    ],
  ],
  [
    "carne",
    [
      // multi-word
      "carne picada",
      "guiso de carne",
      "estofado de carne",
      "estofado de ternera",
      "secreto iberico",
      "pluma iberica",
      "presa iberica",
      "rabo de toro",
      "chuleton de buey",
      "entrecot de ternera",
      "ragout de ternera",
      "filete de ternera",
      "filete de cerdo",
      "solomillo de cerdo",
      "solomillo de ternera",
      "lomo de cerdo",
      "costilla de cerdo",
      "costillas de cerdo",
      "chuleta de cerdo",
      "chuleta de cordero",
      "pierna de cordero",
      "paletilla de cordero",
      // single words
      "carne",
      "ternera",
      "cerdo",
      "cordero",
      "res",
      "filete",
      "solomillo",
      "costilla",
      "costillas",
      "chuleta",
      "chuletas",
      "hamburguesa",
      "estofado",
      "albondiga",
      "albondigas",
      "lomo",
      "carrillera",
      "carrilleras",
      "entrecot",
      "chuleton",
      "jarrete",
      "osobuco",
      "morcilla",
      "chorizo",
      "jamon",
      "salchicha",
      "salchichon",
      "tocino",
      "panceta",
      "bacon",
      "chistorra",
      "cecina",
      "embutido",
    ],
  ],
  [
    "pollo",
    [
      // multi-word
      "pechuga de pollo",
      "muslo de pollo",
      "alitas de pollo",
      "pollo asado",
      "pollo al horno",
      "pollo al curry",
      "pollo a la plancha",
      "hamburguesa de pollo",
      "hamburguesa de pavo",
      "pechuga de pavo",
      "conejo al ajillo",
      "conejo guisado",
      // single words
      "pollo",
      "pavo",
      "pechuga",
      "muslo",
      "muslos",
      "alitas",
      "nugget",
      "nuggets",
      "ave",
      "conejo",
    ],
  ],
  [
    "pasta",
    [
      // multi-word
      "arroz con leche",
      "arroz con pollo",
      "arroz caldoso",
      "arroz negro",
      "arroz a la cubana",
      "arroz tres delicias",
      "pan integral",
      "tostada con tomate",
      "tostada de aguacate",
      // single words
      "pasta",
      "espagueti",
      "espaguetis",
      "spaghetti",
      "macarron",
      "macarrones",
      "lasaña",
      "tallarin",
      "tallarines",
      "fideo",
      "fideos",
      "fideua",
      "arroz",
      "risotto",
      "paella",
      "cuscus",
      "quinoa",
      "pan",
      "pizza",
      "tostada",
      "bocadillo",
      "sandwich",
      "cereal",
      "cereales",
      "avena",
      "tortita",
      "tortitas",
      "gofre",
      "gofres",
      "crepe",
      "crepes",
      "galleta",
      "galletas",
      "croissant",
      "bagel",
      "wrap",
      "burrito",
      "taco",
      "tacos",
      "noodles",
      "ramen",
      "udon",
      "soba",
      "penne",
      "fusilli",
      "ravioli",
      "tortellini",
      "gnocchi",
      "croqueta",
      "croquetas",
      "empanadilla",
      "empanadillas",
      "empanada",
    ],
  ],
  [
    "fruta",
    [
      // multi-word
      "batido de fruta",
      "batido de fresa",
      "batido de platano",
      "ensalada de frutas",
      "zumo de naranja",
      "zumo natural",
      "bowl de acai",
      // single words
      "fruta",
      "frutas",
      "manzana",
      "platano",
      "banana",
      "naranja",
      "fresa",
      "fresas",
      "kiwi",
      "piña",
      "mango",
      "melon",
      "sandia",
      "uva",
      "uvas",
      "pera",
      "melocoton",
      "cereza",
      "cerezas",
      "arandano",
      "arandanos",
      "smoothie",
      "macedonia",
      "compota",
      "frambuesa",
      "frambuesas",
      "mora",
      "moras",
      "higo",
      "higos",
      "granada",
      "papaya",
      "coco",
      "mandarina",
      "pomelo",
      "lima",
      "limon",
      "ciruela",
      "albaricoque",
      "nectarina",
      "caqui",
      "chirimoya",
      "guayaba",
      "maracuya",
      "acai",
      "zumo",
    ],
  ],
  [
    "lacteo",
    [
      // multi-word
      "queso fresco",
      "queso manchego",
      "queso de cabra",
      "queso de burgos",
      "leche con cereales",
      // single words
      "yogur",
      "queso",
      "leche",
      "requeson",
      "kefir",
      "cuajada",
      "natilla",
      "natillas",
      "flan",
      "helado",
      "quesadilla",
      "fondue",
      "bechamel",
      "nata",
    ],
  ],
  [
    "legumbre",
    [
      // multi-word
      "guiso de lentejas",
      "potaje de garbanzos",
      "potaje de lentejas",
      "alubias con chorizo",
      "garbanzos con espinacas",
      "ensalada de garbanzos",
      "ensalada de lentejas",
      "pure de guisantes",
      // single words
      "lenteja",
      "lentejas",
      "garbanzo",
      "garbanzos",
      "alubia",
      "alubias",
      "judia",
      "judias",
      "frijol",
      "frijoles",
      "potaje",
      "fabada",
      "hummus",
      "cocido",
      "soja",
      "edamame",
      "azuki",
    ],
  ],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip diacritics so "salmón" → "salmon", "plátano" → "platano", etc. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Classify a dish name (in Spanish) into a food category using keyword
 * matching. Multi-word keywords are checked first so "crema de verduras"
 * wins over a hypothetical single-word match on "crema".
 */
export function classifyDish(dishName: string): FoodCategory {
  const normalized = stripAccents(dishName.toLowerCase().trim());

  // First pass: multi-word keywords (length > 1 word)
  for (const [category, keywords] of KEYWORDS) {
    for (const kw of keywords) {
      if (kw.includes(" ") && normalized.includes(kw)) {
        return category;
      }
    }
  }

  // Second pass: single-word keywords — match as whole word boundary
  for (const [category, keywords] of KEYWORDS) {
    for (const kw of keywords) {
      if (!kw.includes(" ")) {
        // Use word-boundary-style check so "pan" doesn't match inside "empanada"
        const re = new RegExp(`(?:^|\\s|[,;.()/-])${kw}(?:$|\\s|[,;.()/-])`, "i");
        if (re.test(normalized)) {
          return category;
        }
      }
    }
  }

  return "otro";
}

// ---------------------------------------------------------------------------
// Ingredient-level SVG icons (public/food/icon-*.svg)
// Ordered by priority: specific proteins > specific fish > legumes > grains >
// vegetables > fruit > dairy > condiments/extras — the "star" ingredient wins.
// Each entry: [keyword(s) to match, SVG filename without path/extension].
// Multi-word entries come first within each group so they match before their
// single-word parts (same logic as category keywords above).
// ---------------------------------------------------------------------------

const INGREDIENT_ICONS: [string[], string][] = [
  // --- Proteins (meat & poultry — highest priority) ---
  [
    [
      "pechuga de pollo",
      "muslo de pollo",
      "alitas de pollo",
      "pollo asado",
      "pollo al horno",
      "pollo al curry",
      "pollo a la plancha",
      "pollo",
    ],
    "pollo",
  ],
  [["pechuga de pavo", "hamburguesa de pavo", "pavo"], "pavo-carne"],
  [["pato"], "pato"],
  [
    [
      "solomillo de ternera",
      "filete de ternera",
      "entrecot de ternera",
      "estofado de ternera",
      "ragout de ternera",
      "chuleton de buey",
      "ternera",
    ],
    "ternera",
  ],
  [
    [
      "solomillo de cerdo",
      "lomo de cerdo",
      "costilla de cerdo",
      "costillas de cerdo",
      "filete de cerdo",
      "chuleta de cerdo",
      "secreto iberico",
      "pluma iberica",
      "presa iberica",
      "cerdo",
    ],
    "cerdo",
  ],
  [["chuleta de cordero", "pierna de cordero", "paletilla de cordero", "cordero"], "cordero"],
  [["jamon"], "jamon"],

  // --- Fish & seafood ---
  [["salmon", "tartar de salmon", "ceviche de salmon"], "salmon"],
  [["atun", "tataki de atun", "tartar de atun"], "atun"],
  [["merluza"], "merluza"],
  [["sardina", "sardinas"], "sardina"],
  [["gamba", "gambas", "ceviche de gambas", "langostino", "langostinos"], "gambas"],
  [["pulpo"], "pulpo"],
  [["calamar", "calamares"], "calamar"],
  [["mejillon", "mejillones"], "mejillon"],
  [["almeja", "almejas", "chirla", "chirlas"], "almeja"],

  // --- Legumes ---
  [
    ["lenteja", "lentejas", "guiso de lentejas", "potaje de lentejas", "ensalada de lentejas"],
    "lentejas",
  ],
  [
    [
      "garbanzo",
      "garbanzos",
      "potaje de garbanzos",
      "garbanzos con espinacas",
      "ensalada de garbanzos",
    ],
    "garbanzos",
  ],
  [["alubia", "alubias", "alubias con chorizo", "fabada", "frijol", "frijoles"], "alubias"],
  [["hummus"], "hummus"],

  // --- Grains & starches ---
  [
    [
      "arroz",
      "arroz con leche",
      "arroz con pollo",
      "arroz caldoso",
      "arroz negro",
      "arroz a la cubana",
      "arroz tres delicias",
      "paella",
      "risotto",
    ],
    "arroz",
  ],
  [
    [
      "pasta",
      "espagueti",
      "espaguetis",
      "spaghetti",
      "macarron",
      "macarrones",
      "lasaña",
      "tallarin",
      "tallarines",
      "fideo",
      "fideos",
      "fideua",
      "penne",
      "fusilli",
      "ravioli",
      "tortellini",
      "gnocchi",
      "noodles",
      "ramen",
      "udon",
      "soba",
    ],
    "pasta",
  ],
  [["quinoa"], "quinoa"],
  [["pan", "tostada", "bocadillo", "sandwich", "bagel"], "pan"],
  [["patata", "patatas", "pure de patata", "tortilla de patata"], "patata"],
  [["batata", "boniato"], "batata"],

  // --- Eggs ---
  [["huevo", "huevos", "tortilla francesa", "revuelto"], "huevo"],

  // --- Vegetables ---
  [["brocoli"], "brocoli"],
  [
    [
      "espinaca",
      "espinacas",
      "crema de espinacas",
      "revuelto de espinacas",
      "tortilla de espinacas",
    ],
    "espinaca",
  ],
  [["tomate", "tomate frito", "tostada con tomate", "gazpacho", "salmorejo"], "tomate"],
  [["zanahoria", "zanahorias", "crema de zanahoria"], "zanahoria"],
  [["berenjena"], "berenjena"],
  [["calabacin", "crema de calabacin"], "calabacin"],
  [
    ["pimiento", "pimientos", "pimientos rellenos", "pimientos del padron", "pimientos asados"],
    "pimiento",
  ],
  [
    ["champiñon", "champiñones", "seta", "setas", "revuelto de champiñones", "revuelto de setas"],
    "champinon",
  ],
  [["judias verdes"], "judias-verdes"],
  [["lechuga", "ensalada"], "lechuga"],
  [["cebolla"], "cebolla"],

  // --- Fruit ---
  [["manzana"], "manzana"],
  [["naranja", "zumo de naranja"], "naranja"],
  [["platano", "banana", "batido de platano"], "platano"],
  [["limon", "lima"], "limon"],
  [
    [
      "fresa",
      "fresas",
      "batido de fresa",
      "frambuesa",
      "frambuesas",
      "mora",
      "moras",
      "arandano",
      "arandanos",
    ],
    "frutos-rojos",
  ],
  [["uva", "uvas"], "uvas"],
  [["coco"], "coco"],

  // --- Dairy ---
  [["yogur", "kefir"], "yogur"],
  [
    [
      "queso",
      "queso fresco",
      "queso manchego",
      "queso de cabra",
      "queso de burgos",
      "fondue",
      "quesadilla",
    ],
    "queso",
  ],
  [["leche", "leche con cereales"], "leche"],
  [["requeson", "cuajada"], "requeson"],

  // --- Nuts & seeds ---
  [["almendra", "almendras"], "almendras"],
  [["nuez", "nueces"], "nueces"],
  [["avellana", "avellanas"], "avellanas"],
  [["semilla", "semillas"], "semillas"],

  // --- Extras / condiments ---
  [["tofu"], "tofu"],
  [["chocolate"], "chocolate"],
  [["miel"], "miel"],
  [["aguacate", "tostada de aguacate"], "aguacate"],
  [["aceite de oliva", "aceite oliva"], "aceite-oliva"],
  [["aceite de aguacate"], "aceite-aguacate"],
  [["ajo", "al ajillo"], "ajo"],
  [["pimienta"], "pimienta"],
  [["sal"], "sal"],
  [["especias", "curry"], "especias"],
  [["hierbas", "albahaca", "perejil", "cilantro", "oregano", "romero", "tomillo"], "hierbas"],
];

/**
 * Find the most specific ingredient SVG icon for a dish name.
 * Returns the path `/food/icon-{name}.svg` of the first matching ingredient,
 * or `null` if nothing matches at ingredient level.
 */
export function ingredientIcon(dishName: string): string | null {
  const normalized = stripAccents(dishName.toLowerCase().trim());

  // Multi-word keywords first (across all entries)
  for (const [keywords, icon] of INGREDIENT_ICONS) {
    for (const kw of keywords) {
      if (kw.includes(" ") && normalized.includes(kw)) {
        return `/food/icon-${icon}.svg`;
      }
    }
  }

  // Single-word keywords — whole-word match
  for (const [keywords, icon] of INGREDIENT_ICONS) {
    for (const kw of keywords) {
      if (!kw.includes(" ")) {
        const re = new RegExp(`(?:^|\\s|[,;.()/-])${kw}(?:$|\\s|[,;.()/-])`, "i");
        if (re.test(normalized)) {
          return `/food/icon-${icon}.svg`;
        }
      }
    }
  }

  return null;
}

/**
 * Best available illustration for a dish: specific ingredient SVG first,
 * then category-level asset, then null.
 */
export function dishAsset(dishName: string): string | null {
  return ingredientIcon(dishName) ?? FOOD_CATEGORIES[classifyDish(dishName)].asset;
}

/** Return the category accent color for a dish, looked up via `classifyDish`. */
export function foodCategoryAccent(dish: string): string {
  return FOOD_CATEGORIES[classifyDish(dish)].accent;
}
