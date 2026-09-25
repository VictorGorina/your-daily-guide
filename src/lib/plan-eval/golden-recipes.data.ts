/**
 * Golden set de recetas — la referencia contra la que `bun run eval:recipes`
 * mide el ERROR de la descomposición (`precision-nutricional`, ticket 02).
 *
 * Cada receta es UNA ración base de un plato que la app propone de verdad (los
 * más frecuentes en producción, consulta agregada del 2026-09-24), sacada de
 * recetas publicadas con pesos (`sources`). Reglas para escribirlas (las
 * comprueba `validateGolden`):
 *
 * - Gramos tal como se PESAN: arroz, pasta y legumbre en seco (`arroz-crudo`,
 *   `pasta-cruda`, `lentejas-secas`, `garbanzos-secos`), carne y pescado en
 *   crudo. Lo que en la tabla solo existe cocido (quinoa, cuscús, alubias,
 *   arroz y pasta integrales) va con `state: "cocinado"` y su peso cocido,
 *   calculado conservando la energía del peso en seco (se dice en `notes`).
 * - Aceite: el que se COME. En una fritura, el retenido, no el de la sartén.
 * - Solo ingredientes con peso real: una pizca de sal o de especias no cuenta.
 *   El agua que queda en el plato (una crema) va con la fila `sal` (0 kcal),
 *   que es a la que la tabla casa "agua" hoy.
 * - `reviewedBy`: quién la revisó a mano. Un borrador va con `null` y el eval
 *   lo puede excluir con `--reviewed`.
 *
 * Ración base: las PROPORCIONES salen de la receta publicada; la CANTIDAD de
 * almidón, proteína, fruta, lácteo y aceite se ajusta a las raciones de AESAN
 * (2022), a mitad de su rango: legumbre 60 g en seco (50-60), arroz o pasta
 * 70 g en seco (60-80), carne 110 g en crudo (100-125), pescado 135 g en crudo
 * (120-150), hortaliza 150-200 g, patata 150-200 g, fruta 150 g (120-200),
 * frutos secos 25 g (20-30), pan 50 g (40-60), yogur 125 g, leche 200 ml,
 * huevo M ≈ 50 g comestibles, aceite 10 g. Las recetas publicadas dan raciones
 * muy dispares entre sí; la de AESAN es la única referencia común.
 */

import type { GoldenRecipe } from "./golden";

const AESAN =
  "https://www.riojasalud.es/files/content/ciudadanos/escuela-salud/cuida-tu-salud/alimentacion/profesionales/2022_AESAN_INFORME_recomend_dieteticas_sostenibles_AF.pdf";
/** Resumen de la tabla de raciones del informe de AESAN (el PDF no se deja leer como texto). */
const AESAN_RACIONES = "https://mieducadornutricional.com/recomendaciones-dieteticas-aesan/";
/**
 * Sin receta publicada con pesos que respalde las cifras (platos de "comí
 * distinto", composiciones de sentido común): se dice así en vez de citar una
 * URL que no las respalda. Son las primeras que hay que revisar a mano.
 */
const CONVENCION = "sin fuente: composición convencional, revisar a mano";

const LENTEJAS_HOGARMANIA =
  "https://www.hogarmania.com/cocina/recetas/legumbres/lentejas-estofadas.html";
const TORTILLA_CALIRO = "https://caliro.dev/blog/calorias-tortilla-espanola";
const PASTA_ATUN_NUTRIUM = "https://nutrium.com/p/perales_nutricion/recipes/379856";
const ARROZ_POLLO_MYREALFOOD = "https://www.myrealfood.app/es/recipe/jxz1D6Wg9I71BmBzgqch";
const CREMA_PEQUERECETAS = "https://www.pequerecetas.com/receta/crema-de-calabacin-y-zanahoria/";
const GARBANZOS_ESPINACAS_COOKIDOO = "https://cookidoo.es/recipes/recipe/es-ES/r47649";
const CURRY_GUISANDORICO =
  "https://guisandorico.com/curry-de-garbanzos-con-leche-de-coco-y-verduras/";
const PAELLA_GALLINABLANCA =
  "https://www.gallinablanca.es/receta/paella-de-pollo-y-verduras-180830-61959/";
const PIMIENTOS_BONVIVEUR = "https://bonviveur.com/es/recetas/pimientos-rellenos-arroz";
const PISTO_EROSKI = "https://www.eroski.es/inspirate/recetas/pisto-manchego-con-huevo/";
const TOFU_DIETFARMA = "https://www.dietfarma.com/receta/tofu-salteado-con-brocoli-y-salsa-de-soja";
const MERLUZA_HOGARMANIA =
  "https://www.hogarmania.com/cocina/recetas/pescados-mariscos/guiso-de-merluza-con-patatas.html";

export const GOLDEN_RECIPES: GoldenRecipe[] = [
  // --- Meriendas --------------------------------------------------------------
  {
    dish: "Manzana",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "manzana", grams: 150 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Pieza mediana, porción comestible (AESAN fruta 120-200 g).",
  },
  {
    dish: "Puñado de frutos secos",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "frutos-secos-mix", grams: 25 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "AESAN frutos secos 20-30 g por ración.",
  },
  {
    dish: "Yogur natural",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "yogur-natural", grams: 125 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },

  // --- Desayunos --------------------------------------------------------------
  {
    dish: "Tostada integral con tomate y aceite",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "tomate", grams: 40 },
      { foodKey: "aceite-oliva", grams: 5 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Pan 50 g (AESAN 40-60), medio tomate pequeño rallado, una cucharadita de aceite.",
  },
  {
    dish: "Tostada integral con aguacate y tomate",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "aguacate", grams: 50 },
      { foodKey: "tomate", grams: 40 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Un tercio de aguacate mediano. Sin aceite: el aguacate ya aporta la grasa.",
  },
  {
    dish: "Gachas de avena con fruta y frutos secos",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "avena", grams: 40 },
      { foodKey: "leche-semi", grams: 200 },
      { foodKey: "platano", grams: 60 },
      { foodKey: "frutos-secos-mix", grams: 15 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Leche 200 ml (AESAN 200-250). 'Fruta' sin especificar → medio plátano. Frutos secos como " +
      "topping: media ración.",
  },

  // --- Comidas ----------------------------------------------------------------
  {
    dish: "Lentejas estofadas con verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "lentejas-secas", grams: 60 },
      { foodKey: "pimiento", grams: 60 },
      { foodKey: "zanahoria", grams: 35 },
      { foodKey: "puerro", grams: 20 },
      { foodKey: "cebolla", grams: 19 },
      { foodKey: "tomate-frito", grams: 8 },
      { foodKey: "aceite-oliva", grams: 7 },
      { foodKey: "caldo", grams: 150 },
    ],
    sources: [
      "https://www.hogarmania.com/cocina/recetas/legumbres/lentejas-estofadas.html",
      AESAN_RACIONES,
    ],
    reviewedBy: null,
    notes:
      "Hogarmanía para 4 (250 g lentejas, 1/2 cebolla, 3 medios pimientos, 1 puerro, 2 zanahorias, " +
      "2 cda tomate frito, 3 cda aceite, 1 l caldo) ÷ 4; lentejas a 60 g (AESAN). Caldo: el que " +
      "queda en el plato, no el litro entero.",
  },
  {
    dish: "Arroz integral con pollo y verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "arroz-integral", grams: 229, state: "cocinado" },
      { foodKey: "pechuga-pollo", grams: 110 },
      { foodKey: "pimiento", grams: 50 },
      { foodKey: "cebolla", grams: 40 },
      { foodKey: "zanahoria", grams: 40 },
      { foodKey: "tomate", grams: 40 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: ["https://www.myrealfood.app/es/recipe/jxz1D6Wg9I71BmBzgqch", AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Verduras en la proporción de la receta (cebolla, pimiento, tomate, zanahoria). Arroz: 70 g " +
      "en seco (AESAN) = 229 g cocido (70 × 367 kcal/100 g en seco ÷ 112 kcal/100 g cocido). La " +
      "receta no da un peso fiable por ración: la cantidad es la de AESAN.",
  },
  {
    dish: "Pasta integral con tomate y atún",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "pasta-integral", grams: 164, state: "cocinado" },
      { foodKey: "tomate-triturado", grams: 200 },
      { foodKey: "atun-lata", grams: 100 },
      { foodKey: "ajo", grams: 4 },
      { foodKey: "aceite-oliva", grams: 9 },
    ],
    sources: ["https://nutrium.com/p/perales_nutricion/recipes/379856", AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Receta por persona de Nutrium sin el parmesano (el plato no lo nombra). Pasta: 70 g en seco " +
      "(AESAN) = 164 g cocida (70 × 350 ÷ 149). Atún: 2 latas pequeñas al natural escurridas.",
  },

  // --- Cenas ------------------------------------------------------------------
  {
    dish: "Tortilla de patatas y cebolla",
    slot: "cena",
    coccion: "frito_rebozado",
    ingredients: [
      { foodKey: "patata", grams: 150 },
      { foodKey: "huevo", grams: 90 },
      { foodKey: "cebolla", grams: 38 },
      { foodKey: "aceite-oliva", grams: 14 },
    ],
    sources: [
      "https://caliro.dev/blog/calorias-tortilla-espanola",
      "https://www.centrosaludnutricional.com/valor-energetico-tortilla-de-patatas-valor-calorico-tortilla-patatas-energia-tortilla-de-patatas-cal-215.html",
    ],
    reviewedBy: null,
    notes:
      "Caliro, con BEDCA: 600 g patata, 6 huevos L, 150 g cebolla y 57 g de aceite RETENIDO para " +
      "4 raciones (~145 kcal/100 g). Descartado a revisar: el centro de salud nutricional calcula " +
      "147 g de aceite absorbido para la misma patata (~37 g/ración), muy por encima de lo habitual " +
      "en patata frita casera (10-15 % de grasa). El pipeline impone hoy un suelo de 25 g.",
  },
  {
    dish: "Crema de calabacín y zanahoria",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "calabacin", grams: 110 },
      { foodKey: "zanahoria", grams: 60 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 8 },
      { foodKey: "sal", grams: 150 },
    ],
    sources: [
      "https://www.pequerecetas.com/receta/crema-de-calabacin-y-zanahoria/",
      AESAN_RACIONES,
    ],
    reviewedBy: null,
    notes:
      "Proporciones de PequeRecetas (1 calabacín, 2 zanahorias, 1/2 cebolla, 2 cda aceite), escaladas " +
      "a 200 g de hortaliza (AESAN 150-200). `sal` = 150 g de agua de cocción que queda en la crema.",
  },
  {
    dish: "Pechuga de pollo a la plancha con ensalada",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "pechuga-pollo", grams: 110 },
      { foodKey: "lechuga", grams: 50 },
      { foodKey: "tomate", grams: 80 },
      { foodKey: "cebolla", grams: 20 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Pollo 110 g en crudo (AESAN 100-125). Aceite: 5 g de plancha + 5 g de aliño.",
  },

  // --- Desayunos (2.ª tanda) --------------------------------------------------
  {
    dish: "Tostada integral con huevo revuelto",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "huevo", grams: 50 },
      { foodKey: "aceite-oliva", grams: 3 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Un huevo M (la ración de AESAN) revuelto con una cucharadita escasa de aceite. Si lo " +
      "normal son dos huevos, subir a 100 g.",
  },
  {
    dish: "Tostada integral con tomate y huevo revuelto",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "tomate", grams: 40 },
      { foodKey: "huevo", grams: 50 },
      { foodKey: "aceite-oliva", grams: 3 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Yogur con avena y fruta",
    slot: "desayuno",
    coccion: "cruda",
    ingredients: [
      { foodKey: "yogur-natural", grams: 125 },
      { foodKey: "avena", grams: 30 },
      { foodKey: "platano", grams: 60 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "'Fruta' sin especificar → medio plátano, como en las gachas.",
  },
  {
    dish: "Yogur con manzana troceada",
    slot: "desayuno",
    coccion: "cruda",
    ingredients: [
      { foodKey: "yogur-natural", grams: 125 },
      { foodKey: "manzana", grams: 75 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Media manzana.",
  },
  {
    dish: "Café con bebida de avena y tostada integral con aguacate",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "bebida-avena", grams: 150 },
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "aguacate", grams: 50 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Café sin azúcar (≈ 0 kcal, no cuenta) con 150 ml de bebida de avena.",
  },
  {
    dish: "Tostada integral con aguacate y huevo",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "aguacate", grams: 50 },
      { foodKey: "huevo", grams: 50 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Huevo cocido o a la plancha sin aceite añadido.",
  },
  {
    dish: "Yogur natural con naranja",
    slot: "desayuno",
    coccion: "cruda",
    ingredients: [
      { foodKey: "yogur-natural", grams: 125 },
      { foodKey: "naranja", grams: 140 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Una naranja mediana, porción comestible.",
  },
  {
    dish: "Tostada integral con hummus y tomate",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 50 },
      { foodKey: "hummus", grams: 40 },
      { foodKey: "tomate", grams: 40 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Dos cucharadas colmadas de hummus.",
  },
  {
    dish: "Tortilla francesa de dos huevos con pan",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "huevo", grams: 100 },
      { foodKey: "pan-blanco", grams: 50 },
      { foodKey: "aceite-oliva", grams: 3 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "'Pan' sin especificar → pan blanco de barra, 50 g (AESAN 40-60).",
  },
  {
    dish: "Café con leche y bocadillo pequeño de jamón serrano",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "leche-semi", grams: 150 },
      { foodKey: "pan-blanco", grams: 60 },
      { foodKey: "jamon-serrano", grams: 25 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Bocadillo pequeño ≈ 1/4 de barra (60 g) con 2-3 lonchas de jamón. Café con 150 ml de " +
      "leche semidesnatada, sin azúcar.",
  },
  {
    dish: "Porridge de avena con leche, manzana y canela",
    slot: "desayuno",
    coccion: "otra",
    ingredients: [
      { foodKey: "avena", grams: 40 },
      { foodKey: "leche-semi", grams: 200 },
      { foodKey: "manzana", grams: 75 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Canela: una pizca, no cuenta.",
  },
  {
    dish: "Batido de plátano, leche y crema de cacahuete",
    slot: "desayuno",
    coccion: "cruda",
    ingredients: [
      { foodKey: "platano", grams: 120 },
      { foodKey: "leche-semi", grams: 200 },
      { foodKey: "crema-cacahuete", grams: 15 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Un plátano mediano (120 g comestibles) y una cucharada de crema de cacahuete.",
  },

  // --- Meriendas (2.ª tanda) --------------------------------------------------
  {
    dish: "Plátano",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "platano", grams: 120 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Pieza mediana, porción comestible. En fruta de pieza manda el peso de la pieza, dentro del " +
      "rango de AESAN (120-200 g).",
  },
  {
    dish: "Naranja",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "naranja", grams: 140 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Pieza mediana, porción comestible.",
  },
  {
    dish: "Manzana con un puñado de nueces",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [
      { foodKey: "manzana", grams: 150 },
      { foodKey: "nuez", grams: 25 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Puñado de almendras",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "almendra", grams: 25 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Yogur natural con manzana",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [
      { foodKey: "yogur-natural", grams: 125 },
      { foodKey: "manzana", grams: 75 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Yogur natural con plátano",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [
      { foodKey: "yogur-natural", grams: 125 },
      { foodKey: "platano", grams: 60 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Yogur sin lactosa",
    slot: "merienda",
    coccion: "cruda",
    ingredients: [{ foodKey: "yogur-natural", grams: 125 }],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Sin lactosa no cambia las macros de forma apreciable: mide que el casado no se pierda.",
  },

  // --- Comidas (2.ª tanda) ----------------------------------------------------
  {
    dish: "Garbanzos con espinacas",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "garbanzos-secos", grams: 60 },
      { foodKey: "espinaca", grams: 150 },
      { foodKey: "pan-blanco", grams: 20 },
      { foodKey: "ajo", grams: 4 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [GARBANZOS_ESPINACAS_COOKIDOO, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Thermomix para 4 (400 g de garbanzos cocidos, 600 g de espinaca escurrida, 4 rebanadas de " +
      "pan, 75 g de aceite) ÷ 4. Garbanzos a 60 g en seco (AESAN; la receta da ~45). Aceite a " +
      "10 g (AESAN); la receta pone 19 g por ración, en parte para freír el pan.",
  },
  {
    dish: "Pasta integral con tomate y verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "pasta-integral", grams: 164, state: "cocinado" },
      { foodKey: "tomate-triturado", grams: 150 },
      { foodKey: "calabacin", grams: 60 },
      { foodKey: "pimiento", grams: 40 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [PASTA_ATUN_NUTRIUM, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Base de la pasta con tomate de Nutrium sin atún, con 130 g de verdura salteada. Pasta 70 g " +
      "en seco = 164 g cocida.",
  },
  {
    dish: "Garbanzos con espinacas y huevo",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "garbanzos-secos", grams: 60 },
      { foodKey: "espinaca", grams: 150 },
      { foodKey: "pan-blanco", grams: 20 },
      { foodKey: "huevo", grams: 50 },
      { foodKey: "ajo", grams: 4 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [GARBANZOS_ESPINACAS_COOKIDOO, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Como 'Garbanzos con espinacas' más un huevo duro entero (la receta lo pone de adorno, medio " +
      "por ración; el nombre del plato lo hace protagonista).",
  },
  {
    dish: "Lentejas guisadas con zanahoria y patata",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "lentejas-secas", grams: 60 },
      { foodKey: "patata", grams: 75 },
      { foodKey: "zanahoria", grams: 40 },
      { foodKey: "cebolla", grams: 20 },
      { foodKey: "pimiento", grams: 20 },
      { foodKey: "ajo", grams: 3 },
      { foodKey: "aceite-oliva", grams: 7 },
      { foodKey: "caldo", grams: 150 },
    ],
    sources: [LENTEJAS_HOGARMANIA, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Base de las lentejas estofadas de Hogarmanía con media ración de patata y sin puerro.",
  },
  {
    dish: "Arroz integral con verduras salteadas",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "arroz-integral", grams: 229, state: "cocinado" },
      { foodKey: "calabacin", grams: 60 },
      { foodKey: "pimiento", grams: 50 },
      { foodKey: "cebolla", grams: 40 },
      { foodKey: "zanahoria", grams: 40 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [ARROZ_POLLO_MYREALFOOD, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Arroz 70 g en seco = 229 g cocido, con 190 g de verdura salteada.",
  },
  {
    dish: "Macarrones con tomate y atún",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "pasta-cruda", grams: 70 },
      { foodKey: "tomate-frito", grams: 80 },
      { foodKey: "atun-lata", grams: 100 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 5 },
    ],
    sources: [PASTA_ATUN_NUTRIUM, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "El clásico lleva tomate frito. Atún 'a secas' → al natural, 2 latas escurridas, igual que la " +
      "pasta integral (pendiente de revisión: el modelo suele elegir atún en aceite).",
  },
  {
    dish: "Pasta integral con salsa de tomate y tofu",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "pasta-integral", grams: 164, state: "cocinado" },
      { foodKey: "tomate-triturado", grams: 150 },
      { foodKey: "tofu", grams: 125 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [TOFU_DIETFARMA, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Tofu 125 g como proteína del plato, la cantidad por ración de la receta de Dietfarma.",
  },
  {
    dish: "Garbanzos guisados con verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "garbanzos-secos", grams: 60 },
      { foodKey: "pimiento", grams: 40 },
      { foodKey: "zanahoria", grams: 40 },
      { foodKey: "tomate", grams: 40 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "ajo", grams: 3 },
      { foodKey: "aceite-oliva", grams: 8 },
      { foodKey: "caldo", grams: 150 },
    ],
    sources: [LENTEJAS_HOGARMANIA, AESAN_RACIONES],
    reviewedBy: null,
    notes: "El guiso de verduras de las lentejas estofadas, con garbanzos (60 g en seco, AESAN).",
  },
  {
    dish: "Lentejas guisadas con arroz integral",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "lentejas-secas", grams: 50 },
      { foodKey: "arroz-integral", grams: 66, state: "cocinado" },
      { foodKey: "zanahoria", grams: 30 },
      { foodKey: "cebolla", grams: 20 },
      { foodKey: "pimiento", grams: 20 },
      { foodKey: "aceite-oliva", grams: 7 },
      { foodKey: "caldo", grams: 150 },
    ],
    sources: [LENTEJAS_HOGARMANIA, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Con arroz, la legumbre baja al mínimo de AESAN (50 g) y el arroz es un complemento: 20 g en " +
      "seco = 66 g cocido.",
  },
  {
    dish: "Curry de garbanzos y verduras con arroz integral",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "garbanzos-secos", grams: 50 },
      { foodKey: "leche-coco", grams: 100 },
      { foodKey: "zanahoria", grams: 40 },
      { foodKey: "cebolla", grams: 35 },
      { foodKey: "pimiento", grams: 30 },
      { foodKey: "calabacin", grams: 30 },
      { foodKey: "espinaca", grams: 40 },
      { foodKey: "especias", grams: 3 },
      { foodKey: "aceite-oliva", grams: 5 },
      { foodKey: "arroz-integral", grams: 164, state: "cocinado" },
    ],
    sources: [CURRY_GUISANDORICO, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Guisando Rico para 4 (400 g de garbanzos en conserva, 1 lata de leche de coco de 400 ml, 1 " +
      "cebolla, 1 pimiento, 2 zanahorias, 1/2 calabacín, 1 bolsa de espinacas) ÷ 4. Garbanzos al " +
      "mínimo de AESAN (50 g) porque va con arroz: 50 g en seco = 164 g cocido.",
  },
  {
    dish: "Arroz con pollo y pimiento",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "arroz-crudo", grams: 70 },
      { foodKey: "muslo-pollo", grams: 110 },
      { foodKey: "pimiento", grams: 80 },
      { foodKey: "cebolla", grams: 40 },
      { foodKey: "tomate", grams: 40 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [PAELLA_GALLINABLANCA, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Pollo de muslo, lo habitual en arroz con pollo: 110 g en crudo sin hueso. El caldo lo absorbe " +
      "el arroz (ya está en la fila de arroz cocido): no se suma aparte.",
  },
  {
    dish: "Arroz integral con verduras y atún",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "arroz-integral", grams: 229, state: "cocinado" },
      { foodKey: "atun-lata", grams: 100 },
      { foodKey: "pimiento", grams: 50 },
      { foodKey: "calabacin", grams: 50 },
      { foodKey: "cebolla", grams: 40 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [ARROZ_POLLO_MYREALFOOD, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Atún al natural, 2 latas escurridas como proteína del plato.",
  },
  {
    dish: "Garbanzos con pimiento y cebolla",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "garbanzos-secos", grams: 60 },
      { foodKey: "pimiento", grams: 80 },
      { foodKey: "cebolla", grams: 60 },
      { foodKey: "ajo", grams: 3 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Garbanzos cocidos salteados con la verdura.",
  },
  {
    dish: "Pasta integral con tomate y espinacas",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "pasta-integral", grams: 164, state: "cocinado" },
      { foodKey: "tomate-triturado", grams: 150 },
      { foodKey: "espinaca", grams: 80 },
      { foodKey: "ajo", grams: 4 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [PASTA_ATUN_NUTRIUM, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Pollo al curry con arroz integral",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "pechuga-pollo", grams: 110 },
      { foodKey: "arroz-integral", grams: 164, state: "cocinado" },
      { foodKey: "leche-coco", grams: 50 },
      { foodKey: "cebolla", grams: 50 },
      { foodKey: "tomate-triturado", grams: 50 },
      { foodKey: "especias", grams: 3 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [CURRY_GUISANDORICO, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Salsa de curry con la mitad de leche de coco que el curry de garbanzos. Arroz de " +
      "acompañamiento: 50 g en seco = 164 g cocido.",
  },
  {
    dish: "Ensalada de garbanzos, tomate y atún",
    slot: "comida",
    coccion: "cruda",
    ingredients: [
      { foodKey: "garbanzos-secos", grams: 60 },
      { foodKey: "tomate", grams: 100 },
      { foodKey: "atun-lata", grams: 56 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "pimiento", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Garbanzos cocidos en frío (60 g en seco). Una lata de atún al natural escurrida: aquí la " +
      "legumbre es la base del plato.",
  },
  {
    dish: "Paella de pollo y verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "arroz-crudo", grams: 70 },
      { foodKey: "muslo-pollo", grams: 110 },
      { foodKey: "coliflor", grams: 140 },
      { foodKey: "pimiento", grams: 40 },
      { foodKey: "cebolla", grams: 20 },
      { foodKey: "tomate-frito", grams: 50 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [PAELLA_GALLINABLANCA, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Gallina Blanca para 4 (350 g de arroz, 300 g de pollo, 250 g de tomate frito, 1 cebolla, " +
      "300 g de pimiento, 1 kg de coliflor) ÷ 4, con la verdura escalada a 200 g y arroz (70 g) y " +
      "pollo (110 g) a AESAN. Aceite sin cantidad en la receta: 10 g.",
  },
  {
    dish: "Arroz integral con verduras y huevo",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "arroz-integral", grams: 229, state: "cocinado" },
      { foodKey: "huevo", grams: 50 },
      { foodKey: "pimiento", grams: 40 },
      { foodKey: "calabacin", grams: 40 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "zanahoria", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [ARROZ_POLLO_MYREALFOOD, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Patatas guisadas con merluza y verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "patata", grams: 175 },
      { foodKey: "merluza", grams: 135 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "pimiento", grams: 30 },
      { foodKey: "ajo", grams: 3 },
      { foodKey: "aceite-oliva", grams: 10 },
      { foodKey: "caldo", grams: 200 },
    ],
    sources: [MERLUZA_HOGARMANIA, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Hogarmanía para 4 (3 patatas grandes, 750 g de merluza, 1 cebolleta, 1/4 de pimiento, 800 ml " +
      "de caldo de pescado) ÷ 4. Merluza a 135 g en crudo (AESAN; la receta da 187 g). Aceite sin " +
      "cantidad en la receta: 10 g.",
  },
  {
    dish: "Pollo al horno con boniato y verduras",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "muslo-pollo", grams: 110 },
      { foodKey: "boniato", grams: 175 },
      { foodKey: "pimiento", grams: 50 },
      { foodKey: "cebolla", grams: 50 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Pollo al horno de muslo sin hueso; boniato como la patata (AESAN 150-200 g).",
  },
  {
    dish: "Ensalada de lentejas con tomate y cebolla",
    slot: "comida",
    coccion: "cruda",
    ingredients: [
      { foodKey: "lentejas-secas", grams: 60 },
      { foodKey: "tomate", grams: 100 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "pimiento", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Pollo al horno con patatas y pimiento",
    slot: "comida",
    coccion: "otra",
    ingredients: [
      { foodKey: "muslo-pollo", grams: 110 },
      { foodKey: "patata", grams: 175 },
      { foodKey: "pimiento", grams: 80 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },

  // --- Cenas (2.ª tanda) ------------------------------------------------------
  {
    dish: "Tortilla de calabacín y cebolla",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "calabacin", grams: 150 },
      { foodKey: "huevo", grams: 100 },
      { foodKey: "cebolla", grams: 50 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Dos huevos. El calabacín se pocha con poco aceite: no es una fritura.",
  },
  {
    dish: "Tortilla de espinacas y cebolla",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "espinaca", grams: 100 },
      { foodKey: "huevo", grams: 100 },
      { foodKey: "cebolla", grams: 50 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Revuelto de calabacín y huevo",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "calabacin", grams: 150 },
      { foodKey: "huevo", grams: 100 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Sopa de verduras con huevo cocido",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "caldo", grams: 300 },
      { foodKey: "zanahoria", grams: 40 },
      { foodKey: "calabacin", grams: 40 },
      { foodKey: "puerro", grams: 30 },
      { foodKey: "judia-verde", grams: 30 },
      { foodKey: "apio", grams: 20 },
      { foodKey: "patata", grams: 50 },
      { foodKey: "huevo", grams: 50 },
      { foodKey: "aceite-oliva", grams: 5 },
    ],
    sources: [CONVENCION, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Plato de 300 ml de caldo con 160 g de verdura, algo de patata y un huevo duro.",
  },
  {
    dish: "Pechuga de pollo a la plancha con espinacas salteadas",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "pechuga-pollo", grams: 110 },
      { foodKey: "espinaca", grams: 150 },
      { foodKey: "ajo", grams: 3 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Pimientos rellenos de arroz y verduras",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "pimiento", grams: 150 },
      { foodKey: "arroz-crudo", grams: 50 },
      { foodKey: "tomate", grams: 80 },
      { foodKey: "cebolla", grams: 33 },
      { foodKey: "zanahoria", grams: 25 },
      { foodKey: "apio", grams: 15 },
      { foodKey: "aceite-oliva", grams: 4 },
    ],
    sources: [PIMIENTOS_BONVIVEUR, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Bonviveur para 3 (3 pimientos, 150 g de arroz, 100 g de cebolla, 1 zanahoria, 2 tomates, 1 " +
      "rama de apio, 1 cda de aceite) ÷ 3: un pimiento relleno por ración. El arroz se queda en los " +
      "50 g de la receta (es un relleno, por debajo de AESAN); el caldo lo absorbe el arroz.",
  },
  {
    dish: "Crema de calabacín con picatostes de pan integral",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "calabacin", grams: 170 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 11 },
      { foodKey: "sal", grams: 150 },
      { foodKey: "pan-integral", grams: 20 },
    ],
    sources: [CREMA_PEQUERECETAS, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Crema de 200 g de hortaliza como la de calabacín y zanahoria, con 20 g de pan integral en " +
      "picatostes tostados con 3 g de aceite (aceite total 11 g). `sal` = agua de la crema.",
  },
  {
    dish: "Merluza al horno con patatas y pimiento",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "merluza", grams: 135 },
      { foodKey: "patata", grams: 150 },
      { foodKey: "pimiento", grams: 60 },
      { foodKey: "cebolla", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Pizza casera con base de pan integral, tomate y verduras",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-integral", grams: 80 },
      { foodKey: "tomate-triturado", grams: 50 },
      { foodKey: "mozzarella", grams: 40 },
      { foodKey: "calabacin", grams: 40 },
      { foodKey: "pimiento", grams: 30 },
      { foodKey: "champinon", grams: 30 },
      { foodKey: "cebolla", grams: 20 },
      { foodKey: "aceite-oliva", grams: 5 },
    ],
    sources: [CONVENCION, AESAN_RACIONES],
    reviewedBy: null,
    notes: "'Base de pan integral': una rebanada grande o un pan de pita integral (80 g).",
  },
  {
    dish: "Pinchos de pollo y verduras a la plancha",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "pechuga-pollo", grams: 110 },
      { foodKey: "pimiento", grams: 60 },
      { foodKey: "calabacin", grams: 60 },
      { foodKey: "cebolla", grams: 40 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Revuelto de espinacas y champiñones",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "espinaca", grams: 100 },
      { foodKey: "champinon", grams: 100 },
      { foodKey: "huevo", grams: 100 },
      { foodKey: "ajo", grams: 3 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Tofu salteado con brócoli y salsa de soja",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "tofu", grams: 125 },
      { foodKey: "brocoli", grams: 200 },
      { foodKey: "salsa-soja", grams: 30 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [TOFU_DIETFARMA, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Dietfarma, receta para 1 (125 g de tofu, 300 g de brócoli, 30 g de salsa de soja, 10 g de " +
      "aceite), con el brócoli bajado a 200 g (máximo de AESAN).",
  },
  {
    dish: "Salmón al horno con brócoli",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "salmon", grams: 135 },
      { foodKey: "brocoli", grams: 175 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
  },
  {
    dish: "Sardinas con pimiento asado",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "sardina", grams: 135 },
      { foodKey: "pimiento", grams: 150 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Sardinas frescas limpias, 135 g en crudo (AESAN pescado).",
  },
  {
    dish: "Pisto con huevo escalfado",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "pimiento", grams: 88 },
      { foodKey: "calabacin", grams: 75 },
      { foodKey: "cebolla", grams: 38 },
      { foodKey: "tomate-triturado", grams: 100 },
      { foodKey: "huevo", grams: 50 },
      { foodKey: "aceite-oliva", grams: 11 },
    ],
    sources: [PISTO_EROSKI, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Eroski para 4 (1 cebolla, 1 pimiento verde, 1 rojo, 1 calabacín, 400 g de tomate triturado, " +
      "50 ml de aceite ≈ 46 g, 4 huevos) ÷ 4.",
  },
  {
    dish: "Muslos de pollo al horno con patatas y cebolla",
    slot: "cena",
    coccion: "otra",
    ingredients: [
      { foodKey: "muslo-pollo", grams: 110 },
      { foodKey: "patata", grams: 175 },
      { foodKey: "cebolla", grams: 60 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "110 g de muslo en crudo, sin hueso ni piel.",
  },
  {
    dish: "Ensalada de tomate, cebolla y atún",
    slot: "cena",
    coccion: "cruda",
    ingredients: [
      { foodKey: "tomate", grams: 200 },
      { foodKey: "cebolla", grams: 40 },
      { foodKey: "atun-lata", grams: 56 },
      { foodKey: "aceite-oliva", grams: 10 },
    ],
    sources: [AESAN, AESAN_RACIONES],
    reviewedBy: null,
    notes: "Una lata de atún al natural escurrida.",
  },

  // --- Comí distinto ----------------------------------------------------------
  // Texto libre como lo escribiría alguien. "Menú del día" y "tapas" a secas no
  // tienen una composición que medir, así que el plato dice qué se comió.
  {
    dish: "Pizza margarita y una caña",
    slot: "distinto",
    coccion: "otra",
    ingredients: [
      { foodKey: "masa-pizza", grams: 150 },
      { foodKey: "tomate-frito", grams: 40 },
      { foodKey: "mozzarella", grams: 80 },
      { foodKey: "aceite-oliva", grams: 5 },
      { foodKey: "cerveza", grams: 200 },
    ],
    sources: [CONVENCION],
    reviewedBy: null,
    notes: "Pizza margarita individual (~275 g) y una caña de 200 ml (la misma ancla del prompt).",
  },
  {
    dish: "Menú del día: ensalada mixta, filete con patatas fritas, pan y fruta",
    slot: "distinto",
    coccion: "otra",
    ingredients: [
      { foodKey: "lechuga", grams: 60 },
      { foodKey: "tomate", grams: 80 },
      { foodKey: "cebolla", grams: 20 },
      { foodKey: "atun-lata", grams: 30 },
      { foodKey: "huevo", grams: 25 },
      { foodKey: "ternera-magra", grams: 120 },
      { foodKey: "patata-frita", grams: 150, state: "cocinado" },
      { foodKey: "pan-blanco", grams: 60 },
      { foodKey: "naranja", grams: 140 },
      { foodKey: "aceite-oliva", grams: 15 },
    ],
    sources: [CONVENCION, AESAN_RACIONES],
    reviewedBy: null,
    notes:
      "Primero: ensalada mixta con media lata de atún y medio huevo. Segundo: filete de ternera de " +
      "120 g en crudo con 150 g de patatas fritas (la fila ya lleva su aceite). Pan 60 g y una " +
      "naranja. Aceite: 10 g del aliño + 5 g de la plancha.",
  },
  {
    dish: "Hamburguesa con patatas",
    slot: "distinto",
    coccion: "otra",
    ingredients: [
      { foodKey: "pan-hamburguesa", grams: 70 },
      { foodKey: "carne-picada", grams: 120 },
      { foodKey: "lechuga", grams: 15 },
      { foodKey: "tomate", grams: 20 },
      { foodKey: "ketchup", grams: 15 },
      { foodKey: "patata-frita", grams: 150, state: "cocinado" },
      { foodKey: "aceite-oliva", grams: 3 },
    ],
    sources: [CONVENCION],
    reviewedBy: null,
    notes:
      "Pan de 70 g, 120 g de carne picada en crudo, ketchup, lechuga y tomate; 150 g de patatas " +
      "fritas (la fila ya lleva su aceite).",
  },
  {
    dish: "Bocadillo de tortilla",
    slot: "distinto",
    coccion: "frito_rebozado",
    ingredients: [
      { foodKey: "pan-blanco", grams: 100 },
      { foodKey: "patata", grams: 86 },
      { foodKey: "huevo", grams: 51 },
      { foodKey: "cebolla", grams: 22 },
      { foodKey: "aceite-oliva", grams: 8 },
    ],
    sources: [TORTILLA_CALIRO, CONVENCION],
    reviewedBy: null,
    notes:
      "Media barra pequeña (100 g) con ~165 g de tortilla de patatas en las proporciones de Caliro " +
      "(la misma referencia que la tortilla de la cena).",
  },
  {
    dish: "Tapas: patatas bravas y croquetas",
    slot: "distinto",
    coccion: "frito_rebozado",
    ingredients: [
      { foodKey: "patata-frita", grams: 150, state: "cocinado" },
      { foodKey: "tomate-frito", grams: 20 },
      { foodKey: "harina", grams: 12 },
      { foodKey: "leche-entera", grams: 50 },
      { foodKey: "mantequilla", grams: 6 },
      { foodKey: "jamon-serrano", grams: 8 },
      { foodKey: "huevo", grams: 6 },
      { foodKey: "pan-rallado", grams: 8 },
      { foodKey: "aceite-oliva", grams: 15 },
    ],
    sources: [CONVENCION],
    reviewedBy: null,
    notes:
      "Ración de bravas (150 g de patata frita; salsa con 20 g de tomate frito y 5 g de aceite) y 3 " +
      "croquetas de jamón de ~30 g (bechamel de harina, leche entera y mantequilla, jamón, rebozado " +
      "de huevo y pan rallado, ~10 g de aceite retenido).",
  },
];
