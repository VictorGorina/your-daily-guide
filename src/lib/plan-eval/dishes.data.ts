/**
 * Platos representativos de lo que el plan mensual propone de verdad — cocina
 * mediterránea de casa, española, sencilla y repetible. Sirven para medir la
 * cobertura de la tabla de composición (`src/lib/nutrition/foods.data.ts`):
 * cuántos platos se descomponen y con qué calidad, y qué ingredientes se quedan
 * sin identificar (candidatos a entrar en la tabla).
 *
 * `kcalMin`/`kcalMax` es el rango razonable de kcal POR RACIÓN — no una verdad
 * exacta, un cordón para detectar descomposiciones absurdas.
 */

export type EvalDish = {
  dish: string;
  slot: "desayuno" | "comida" | "cena" | "merienda";
  kcalMin: number;
  kcalMax: number;
};

export const EVAL_DISHES: EvalDish[] = [
  // --- Desayunos
  {
    dish: "Tostadas de pan integral con tomate y aceite de oliva",
    slot: "desayuno",
    kcalMin: 200,
    kcalMax: 450,
  },
  {
    dish: "Yogur natural con avena, plátano y nueces",
    slot: "desayuno",
    kcalMin: 250,
    kcalMax: 500,
  },
  { dish: "Tortilla francesa de dos huevos con pan", slot: "desayuno", kcalMin: 250, kcalMax: 500 },
  {
    dish: "Café con leche y bocadillo pequeño de jamón serrano",
    slot: "desayuno",
    kcalMin: 250,
    kcalMax: 500,
  },
  {
    dish: "Porridge de avena con leche, manzana y canela",
    slot: "desayuno",
    kcalMin: 250,
    kcalMax: 500,
  },
  {
    dish: "Batido de plátano, leche y crema de cacahuete",
    slot: "desayuno",
    kcalMin: 300,
    kcalMax: 600,
  },

  // --- Comidas
  {
    dish: "Lentejas estofadas con zanahoria, patata y chorizo",
    slot: "comida",
    kcalMin: 350,
    kcalMax: 750,
  },
  { dish: "Garbanzos con espinacas y huevo duro", slot: "comida", kcalMin: 350, kcalMax: 700 },
  { dish: "Arroz con pollo y verduras", slot: "comida", kcalMin: 400, kcalMax: 800 },
  { dish: "Macarrones con tomate y atún", slot: "comida", kcalMin: 400, kcalMax: 800 },
  {
    dish: "Ensalada de pasta con tomate, pepino, maíz y huevo",
    slot: "comida",
    kcalMin: 350,
    kcalMax: 700,
  },
  {
    dish: "Pechuga de pollo a la plancha con arroz integral y ensalada",
    slot: "comida",
    kcalMin: 400,
    kcalMax: 750,
  },
  {
    dish: "Filete de ternera con patatas y pimientos asados",
    slot: "comida",
    kcalMin: 450,
    kcalMax: 850,
  },
  {
    dish: "Merluza al horno con patata panadera y cebolla",
    slot: "comida",
    kcalMin: 350,
    kcalMax: 700,
  },
  {
    dish: "Guiso de garbanzos con bacalao y espinacas",
    slot: "comida",
    kcalMin: 400,
    kcalMax: 750,
  },
  { dish: "Paella de verduras", slot: "comida", kcalMin: 350, kcalMax: 700 },
  {
    dish: "Lentejas con arroz y verduras (potaje vegetariano)",
    slot: "comida",
    kcalMin: 350,
    kcalMax: 700,
  },
  {
    dish: "Salteado de arroz integral con tofu, brócoli y salsa de soja",
    slot: "comida",
    kcalMin: 400,
    kcalMax: 750,
  },
  { dish: "Alubias blancas con verduras", slot: "comida", kcalMin: 350, kcalMax: 700 },
  { dish: "Pollo al curry con arroz basmati", slot: "comida", kcalMin: 450, kcalMax: 850 },
  {
    dish: "Lomo de cerdo a la plancha con puré de patata y judías verdes",
    slot: "comida",
    kcalMin: 450,
    kcalMax: 850,
  },
  {
    dish: "Ensalada de garbanzos, tomate, cebolla y atún",
    slot: "comida",
    kcalMin: 350,
    kcalMax: 700,
  },
  { dish: "Fideuá de marisco", slot: "comida", kcalMin: 400, kcalMax: 800 },
  { dish: "Cuscús con pollo y verduras asadas", slot: "comida", kcalMin: 400, kcalMax: 800 },

  // --- Cenas
  {
    dish: "Crema de calabacín con un huevo cocido y pan",
    slot: "cena",
    kcalMin: 250,
    kcalMax: 550,
  },
  { dish: "Revuelto de champiñones y gambas", slot: "cena", kcalMin: 250, kcalMax: 550 },
  { dish: "Tortilla de patata y cebolla con ensalada", slot: "cena", kcalMin: 350, kcalMax: 800 },
  { dish: "Salmón a la plancha con espárragos y quinoa", slot: "cena", kcalMin: 400, kcalMax: 750 },
  { dish: "Sopa de verduras con fideos y pollo", slot: "cena", kcalMin: 250, kcalMax: 550 },
  { dish: "Dorada al horno con verduras", slot: "cena", kcalMin: 300, kcalMax: 600 },
  {
    dish: "Ensalada templada de lentejas con queso feta y nueces",
    slot: "cena",
    kcalMin: 350,
    kcalMax: 700,
  },
  { dish: "Wrap integral de pollo, lechuga y tomate", slot: "cena", kcalMin: 350, kcalMax: 700 },
  { dish: "Pisto de verduras con huevo escalfado", slot: "cena", kcalMin: 200, kcalMax: 550 },
  { dish: "Berenjenas rellenas de carne picada y queso", slot: "cena", kcalMin: 350, kcalMax: 700 },
  { dish: "Calabacín relleno de atún y tomate", slot: "cena", kcalMin: 150, kcalMax: 550 },
  { dish: "Pollo al horno con boniato", slot: "cena", kcalMin: 400, kcalMax: 750 },
  { dish: "Ensalada César con pollo", slot: "cena", kcalMin: 350, kcalMax: 700 },
  { dish: "Gazpacho con picatostes y huevo duro", slot: "cena", kcalMin: 200, kcalMax: 500 },
  { dish: "Coliflor asada con garbanzos especiados", slot: "cena", kcalMin: 300, kcalMax: 600 },
  {
    dish: "Tosta de pan con aguacate, tomate y huevo poché",
    slot: "cena",
    kcalMin: 300,
    kcalMax: 600,
  },

  // --- Meriendas
  {
    dish: "Fruta de temporada y un puñado de almendras",
    slot: "merienda",
    kcalMin: 120,
    kcalMax: 350,
  },
  { dish: "Yogur griego con arándanos", slot: "merienda", kcalMin: 100, kcalMax: 300 },
  { dish: "Tostada con queso fresco y miel", slot: "merienda", kcalMin: 150, kcalMax: 400 },
  { dish: "Puñado de nueces y una mandarina", slot: "merienda", kcalMin: 120, kcalMax: 350 },
  {
    dish: "Hummus con crudités de zanahoria y pimiento",
    slot: "merienda",
    kcalMin: 120,
    kcalMax: 350,
  },

  // --- Platos algo menos habituales (prueba de descomposición de lo "raro")
  {
    dish: "Shakshuka (huevos en salsa de tomate y pimiento)",
    slot: "cena",
    kcalMin: 250,
    kcalMax: 550,
  },
  {
    dish: "Poke bowl de salmón, arroz, edamame y aguacate",
    slot: "comida",
    kcalMin: 400,
    kcalMax: 800,
  },
  { dish: "Dal de lentejas rojas con leche de coco", slot: "comida", kcalMin: 350, kcalMax: 700 },
  {
    dish: "Buddha bowl de quinoa, garbanzos, remolacha y tahini",
    slot: "comida",
    kcalMin: 400,
    kcalMax: 800,
  },
  {
    dish: "Tabulé de cuscús con hierbabuena, tomate y limón",
    slot: "cena",
    kcalMin: 250,
    kcalMax: 550,
  },
];
