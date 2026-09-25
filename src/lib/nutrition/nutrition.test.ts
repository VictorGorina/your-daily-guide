import { describe, expect, it } from "bun:test";

import { FOODS, GENERIC_FOOD } from "./foods.data";
import {
  categoryMedianFood,
  clampGrams,
  heavyUnmatched,
  macrosOf,
  matchFood,
  parseFoodCategory,
  priceOf,
  resolutionQuality,
  resolveIngredient,
} from "./nutrition";

// ---------------------------------------------------------------------------
// matchFood — casar un nombre libre con la tabla de composición
// ---------------------------------------------------------------------------

describe("matchFood", () => {
  it("casa un alias exacto", () => {
    expect(matchFood("pollo")?.food.key).toBe("pechuga-pollo");
    expect(matchFood("aceite de oliva")?.food.key).toBe("aceite-oliva");
    expect(matchFood("AOVE")?.food.key).toBe("aceite-oliva");
  });

  it("ignora acentos y plural", () => {
    expect(matchFood("lentejas")?.food.key).toBe("lentejas");
    expect(matchFood("plátanos")?.food.key).toBe("platano");
    expect(matchFood("Champiñón")?.food.key).toBe("champinon");
  });

  it("casa por solape de tokens con un plato descrito", () => {
    expect(matchFood("pechuga de pollo a la plancha")?.food.key).toBe("pechuga-pollo");
    expect(matchFood("arroz integral basmati")?.food.key).toBe("arroz-integral");
    expect(matchFood("filete de ternera")?.food.key).toBe("ternera-magra");
  });

  it("da confianza alta con ≥2 tokens y baja con uno", () => {
    expect(matchFood("pechuga de pollo a la plancha")?.confidence).toBe("high");
    // "estofadas" no está en la tabla; solo "lentejas" solapa
    expect(matchFood("lentejas estofadas de la abuela")?.food.key).toBe("lentejas");
  });

  it("devuelve null cuando no hay ni un token en común", () => {
    expect(matchFood("xyzzy plutonio azul")).toBeNull();
    expect(matchFood("")).toBeNull();
  });

  // Picoteo (feature `picoteo-hoy`): sin estas filas caía todo en el genérico,
  // y las patatas de bolsa casaban con las fritas caseras (190 vs 536 kcal).
  it("casa lo típico de un picoteo", () => {
    const cases: [string, string][] = [
      ["bolsa de patatas fritas", "patatas-chips"],
      ["patatas fritas de bolsa", "patatas-chips"],
      ["nachos", "aperitivo-maiz"],
      ["palomitas", "palomitas"],
      ["frutos secos", "frutos-secos-mix"],
      ["galletas", "galleta"],
      ["galletas de avena", "galleta"],
      ["oreo", "galleta-chocolate"],
      ["croissant", "bolleria"],
      ["napolitana de chocolate", "bolleria"],
      ["magdalenas", "magdalena"],
      ["helado de fresa", "helado"],
      ["chuches", "gominolas"],
      ["chocolatinas", "chocolatina"],
      ["barrita de cereales", "barrita-cereales"],
      ["barrita proteica", "barrita-proteina"],
      ["una cerveza", "cerveza"],
      ["caña", "cerveza"],
      ["cerveza sin alcohol", "cerveza-sin"],
      ["gin", "destilado"],
      ["coca cola", "refresco"],
      ["coca cola zero", "refresco-zero"],
    ];
    for (const [name, key] of cases) expect([name, matchFood(name)?.food.key]).toEqual([name, key]);
  });

  // Embutidos (issue de precisión, 2026-09-17): compartían todos la fila de
  // "chorizo" (350 kcal, 24 g proteína) aunque sus macros reales difieren
  // mucho — la salchicha tipo frankfurt tiene casi la mitad de proteína, y la
  // morcilla y la butifarra son mucho más bajas en kcal y grasa.
  it("distingue cada embutido de chorizo, con su propia proteína", () => {
    const cases: [string, string][] = [
      ["chorizo", "chorizo"],
      ["chorizo fresco", "chorizo-fresco"],
      ["chorizo crudo", "chorizo-fresco"],
      ["salchichón", "salchichon"],
      ["butifarra", "butifarra"],
      ["botifarra", "butifarra"],
      ["salchichas", "salchicha"],
      ["frankfurt", "salchicha"],
      ["morcilla de burgos", "morcilla"],
      ["moronga", "morcilla"],
    ];
    for (const [name, key] of cases) expect([name, matchFood(name)?.food.key]).toEqual([name, key]);

    // La proteína no puede quedar igualada entre ellos: eso era el bug.
    const proteinOf = (key: string) => FOODS.find((food) => food.key === key)?.protein_g;
    expect(proteinOf("chorizo")).toBe(24);
    expect(proteinOf("salchicha")).toBeLessThan(proteinOf("chorizo")! - 5);
    expect(proteinOf("chorizo-fresco")).toBeLessThan(proteinOf("chorizo")! - 5);
  });

  it("las filas de picoteo no roban alias que ya existían", () => {
    // En un plato, "patatas fritas" siguen siendo las caseras.
    expect(matchFood("patatas fritas")?.food.key).toBe("patata-frita");
    expect(matchFood("almendras")?.food.key).toBe("almendra");
    expect(matchFood("chocolate")?.food.key).toBe("chocolate-negro");
    expect(matchFood("vino tinto")?.food.key).toBe("vino-cocinar");
    expect(matchFood("zumo de naranja")?.food.key).toBe("naranja");
    expect(matchFood("leche con cacao")?.food.key).toBe("leche-entera");
  });
});

// ---------------------------------------------------------------------------
// resolveIngredient — lo que devuelve el modelo → fila de la tabla
// ---------------------------------------------------------------------------

describe("resolveIngredient", () => {
  it("usa la key explícita del modelo cuando existe", () => {
    const r = resolveIngredient({ key: "salmon", name: "salmón salvaje", grams: 150 });
    expect(r.food.key).toBe("salmon");
    expect(r.confidence).toBe("high");
    expect(r.grams).toBe(150);
  });

  it("cae al nombre si la key no existe en la tabla", () => {
    const r = resolveIngredient({ key: "inventada-99", name: "tomate", grams: 100 });
    expect(r.food.key).toBe("tomate");
  });

  it("cae a GENERIC_FOOD con confianza baja si nada casa", () => {
    const r = resolveIngredient({ name: "salsa secreta marciana", grams: 40 });
    expect(r.food).toBe(GENERIC_FOOD);
    expect(r.confidence).toBe("low");
  });

  it("sanea los gramos", () => {
    expect(resolveIngredient({ name: "tomate", grams: "abc" }).grams).toBe(0);
    expect(resolveIngredient({ name: "tomate", grams: -5 }).grams).toBe(0);
    expect(resolveIngredient({ name: "tomate", grams: 9000 }).grams).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// macrosOf / priceOf — la suma
// ---------------------------------------------------------------------------

describe("macrosOf", () => {
  it("suma por ingrediente escalando por gramos", () => {
    const ingredients = [
      resolveIngredient({ key: "pechuga-pollo", name: "pollo", grams: 200 }),
      resolveIngredient({ key: "arroz-blanco", name: "arroz", grams: 150 }),
    ];
    const m = macrosOf(ingredients);
    // pollo 200g → 330 kcal, 62 P · arroz 150g → 195 kcal, 4 P
    expect(m.kcal).toBe(525);
    expect(m.protein_g).toBe(66);
    expect(m.carbs_g).toBe(42);
  });

  it("una lista vacía da todo a cero", () => {
    expect(macrosOf([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  });
});

describe("priceOf", () => {
  it("suma el precio orientativo por gramos", () => {
    const ingredients = [
      resolveIngredient({ key: "pechuga-pollo", name: "pollo", grams: 200 }), // 0.75/100g → 1.5
      resolveIngredient({ key: "arroz-blanco", name: "arroz", grams: 100 }), // 0.15/100g → 0.15
    ];
    const price = priceOf(ingredients);
    expect(price).toBeGreaterThan(1.5);
    expect(price).toBeLessThan(1.8);
  });
});

describe("clampGrams", () => {
  it("redondea y acota", () => {
    expect(clampGrams(50.6)).toBe(51);
    expect(clampGrams(-1)).toBe(0);
    expect(clampGrams(NaN)).toBe(0);
    expect(clampGrams(5000)).toBe(2000);
  });
});

describe("resolutionQuality", () => {
  it("es la proporción de KCAL identificadas, no de gramos (ticket 14 §5)", () => {
    const ingredients = [
      resolveIngredient({ key: "pechuga-pollo", name: "pollo", grams: 150 }), // 247,5 kcal, high
      resolveIngredient({ name: "salsa marciana", grams: 50 }), // 65 kcal, genérico
    ];
    expect(resolutionQuality(ingredients)).toBeCloseTo(247.5 / 312.5, 3);
  });

  it("300 g de caldo bien casado no tapan 30 g de manteca sin casar", () => {
    const ingredients = [
      resolveIngredient({ key: "caldo", name: "caldo", grams: 300 }),
      resolveIngredient({ name: "manteca de cerdo", grams: 30, category: "grasa" }),
    ];
    // Por gramos daría 0,91; por kcal, casi nada está identificado.
    expect(resolutionQuality(ingredients)).toBeLessThan(0.1);
  });

  it("lo resuelto con el alimento más parecido cuenta como identificado", () => {
    const [manteca] = [
      resolveIngredient({ name: "manteca de cerdo", grams: 30, category: "grasa" }),
    ];
    expect(resolutionQuality([{ ...manteca!, fallback: "closest" }])).toBe(1);
  });

  it("es 0 sin gramos", () => {
    expect(resolutionQuality([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ingredientes sin casar: categoría antes que genérico (ticket 13, D13)
// ---------------------------------------------------------------------------

describe("ingrediente que no casa con la tabla", () => {
  it("la manteca de cerdo de la auditoría deja de valer 130 kcal/100 g: casa con una grasa", () => {
    const ing = resolveIngredient({ name: "manteca de cerdo", grams: 30, category: "grasa" });
    expect(ing.food.key).not.toBe(GENERIC_FOOD.key);
    expect(ing.food.category).toBe("grasa");
    expect(ing.food.kcal).toBeGreaterThanOrEqual(700);
    expect(ing).toMatchObject({ confidence: "low", fallback: "category", category: "grasa" });
  });

  it("sin categoría sigue cayendo en el genérico, marcado", () => {
    const ing = resolveIngredient({ name: "ingrediente inexistente xyz", grams: 5 });
    expect(ing.food).toBe(GENERIC_FOOD);
    expect(ing.fallback).toBe("generic");
  });

  it("un ingrediente que casa no lleva marca de respaldo aunque traiga categoría", () => {
    const ing = resolveIngredient({ name: "lentejas", grams: 180, category: "legumbre" });
    expect(ing.food.key).toBe("lentejas");
    expect(ing.fallback).toBeUndefined();
  });

  it("entiende la categoría con tildes, plural o espacios", () => {
    expect(parseFoodCategory("Proteína")).toBe("proteina");
    expect(parseFoodCategory("lácteos")).toBe("lacteo");
    expect(parseFoodCategory("frutos secos")).toBe("fruto-seco");
    expect(parseFoodCategory("cereales")).toBe("cereal");
    expect(parseFoodCategory("verduras")).toBe("verdura");
    expect(parseFoodCategory("bebida")).toBeNull();
    expect(parseFoodCategory(null)).toBeNull();
  });

  it("la mediana de una categoría es una fila real de esa categoría, con key propia", () => {
    const grasa = categoryMedianFood("grasa");
    expect(grasa.key).toBe("__grasa__");
    expect(FOODS.some((f) => f.category === "grasa" && f.kcal === grasa.kcal)).toBe(true);
  });

  it("solo pesa lo que aporta ≥ 5 % de las kcal del plato", () => {
    const ingredients = [
      resolveIngredient({ key: "pasta", name: "pasta", grams: 180 }),
      resolveIngredient({ name: "manteca de cerdo", grams: 30, category: "grasa" }),
      resolveIngredient({ name: "hierba rara", grams: 1, category: "verdura" }),
    ];
    expect(heavyUnmatched(ingredients)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// Ticket 14 (§3, §4) y 05 (D8): filas nuevas, base de cada fila y estado
// ---------------------------------------------------------------------------

describe("casado de los nombres de la auditoría (H22)", () => {
  const expected: [string, string][] = [
    ["fuet", "salchichon"],
    ["bacon", "bacon"],
    ["panceta", "bacon"],
    ["tortilla de patatas", "tortilla-patatas"],
    ["tortilla francesa", "huevo"],
    ["pizza margarita", "pizza"],
    ["croquetas de jamón", "croqueta"],
    ["bebida de soja", "bebida-soja"],
    ["leche de almendras", "bebida-almendra"],
    ["pechuga de pavo loncheada", "pechuga-pavo-loncheada"],
    ["sobrasada", "sobrasada"],
    ["granola", "granola"],
    ["corn flakes", "cereales-desayuno"],
    ["leche condensada", "leche-condensada"],
    ["harina de garbanzo", "harina-garbanzo"],
  ];
  for (const [name, key] of expected) {
    it(`${name} → ${key}`, () => expect(matchFood(name)?.food.key).toBe(key));
  }

  it("la tortilla francesa ya no casa con el wrap", () => {
    expect(matchFood("tortilla francesa")?.food.key).not.toBe("wrap");
  });
});

describe("base de las filas con rendimiento (ticket 14 §4)", () => {
  it("toda fila con cookedYield dice si su valor es crudo o cocinado", () => {
    const missing = FOODS.filter((f) => f.cookedYield && !f.basis).map((f) => f.key);
    expect(missing).toEqual([]);
  });
});

describe("estado de los gramos (D8)", () => {
  const kcal = (r: ReturnType<typeof resolveIngredient>) => (r.food.kcal * r.grams) / 100;

  it("70 g de arroz en crudo van contra la fila en seco, no contra el cocido", () => {
    const r = resolveIngredient({ name: "arroz", grams: 70, state: "crudo" });
    expect(r.food.key).toBe("arroz-crudo");
    expect(Math.round(kcal(r))).toBe(252);
  });

  it("la legumbre de bote, tal cual, va contra la fila cocida", () => {
    expect(
      resolveIngredient({ name: "lentejas de bote", grams: 200, state: "listo" }).food.key,
    ).toBe("lentejas");
  });

  it("carne cruda sobre una fila cocinada: × rendimiento", () => {
    const r = resolveIngredient({ key: "pechuga-pollo", grams: 100, state: "crudo" });
    expect(r.grams).toBe(75);
    expect(r.gramsRaw).toBe(100);
  });

  it("pescado ya hecho sobre una fila cruda: ÷ rendimiento (la merluza es valor crudo)", () => {
    const r = resolveIngredient({ key: "merluza", grams: 85, state: "listo" });
    expect(r.grams).toBe(100);
  });

  it("el salmón cuenta igual crudo que a la plancha (USDA casi no cambia)", () => {
    const raw = resolveIngredient({ key: "salmon", grams: 100, state: "crudo" });
    const cooked = resolveIngredient({ key: "salmon", grams: 100, state: "listo" });
    expect(raw.grams).toBe(100);
    expect(cooked.grams).toBe(100);
  });

  it("patatas fritas en crudo son patata: el aceite lo pone el método", () => {
    expect(resolveIngredient({ name: "patatas fritas", grams: 150, state: "crudo" }).food.key).toBe(
      "patata",
    );
  });
});
