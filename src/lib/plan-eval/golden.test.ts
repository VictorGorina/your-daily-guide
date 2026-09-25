import { describe, expect, it } from "bun:test";

import { FOODS, GENERIC_FOOD, resolveIngredient } from "@/lib/nutrition/nutrition";

import { accuracyOf, OIL_ID } from "./accuracy";
import {
  COOKED_ONLY,
  DRY_TO_COOKED,
  foodIdentity,
  fromResolved,
  tableErrorOf,
  toTableBasis,
  validateGolden,
  type GoldenRecipe,
} from "./golden";
import { GOLDEN_RECIPES } from "./golden-recipes.data";

const KEYS = new Set(FOODS.map((f) => f.key));

const recipe = (ingredients: GoldenRecipe["ingredients"]): GoldenRecipe => ({
  dish: "Plato de prueba",
  slot: "comida",
  coccion: "otra",
  ingredients,
  sources: ["https://example.com/receta"],
  reviewedBy: null,
});

describe("tabla de parejas seco/cocido", () => {
  it("todas las filas nombradas existen en la tabla (un renombrado rompería el eval)", () => {
    for (const [dry, cooked] of Object.entries(DRY_TO_COOKED)) {
      expect(KEYS.has(dry)).toBe(true);
      expect(KEYS.has(cooked)).toBe(true);
    }
    for (const key of COOKED_ONLY) expect(KEYS.has(key)).toBe(true);
  });
});

describe("toTableBasis", () => {
  it("pasa el arroz en seco a la fila cocida conservando las kcal", () => {
    const [arroz] = toTableBasis(recipe([{ foodKey: "arroz-crudo", grams: 70 }]));
    const crudo = FOODS.find((f) => f.key === "arroz-crudo")!;
    expect(arroz.id).toBe("arroz-blanco");
    expect(arroz.kcal).toBeCloseTo((crudo.kcal * 70) / 100, 6);
    // El arroz gana agua al cocerse: pesa más de lo que se pesó en seco.
    expect(arroz.grams).toBeGreaterThan(150);
  });

  it("convierte carne en crudo igual que el pipeline con wasRaw", () => {
    const ref = toTableBasis(recipe([{ foodKey: "pechuga-pollo", grams: 120 }]));
    const pipeline = fromResolved([
      resolveIngredient({
        key: "pechuga-pollo",
        name: "pechuga de pollo",
        grams: 120,
        wasRaw: true,
      }),
    ]);
    const a = accuracyOf(ref, pipeline);
    expect(a.kcalErr).toBeCloseTo(0, 6);
    expect(a.densityErr).toBeCloseTo(0, 6);
  });

  it("no convierte lo que se pesó ya cocinado", () => {
    const [pollo] = toTableBasis(
      recipe([{ foodKey: "pechuga-pollo", grams: 100, state: "cocinado" }]),
    );
    expect(pollo.grams).toBe(100);
  });

  it("deja tal cual lo que no tiene conversión (verdura, aceite)", () => {
    const items = toTableBasis(
      recipe([
        { foodKey: "aceite-oliva", grams: 10 },
        { foodKey: "tomate", grams: 150 },
      ]),
    );
    expect(items.map((i) => [i.id, i.grams])).toEqual([
      [OIL_ID, 10],
      ["tomate", 150],
    ]);
  });

  it("lanza con una receta inválida en vez de medir con ella", () => {
    expect(() => toTableBasis(recipe([{ foodKey: "no-existe", grams: 10 }]))).toThrow(/no-existe/);
  });
});

describe("validateGolden", () => {
  it("acepta una receta bien formada", () => {
    expect(
      validateGolden(
        recipe([
          { foodKey: "lentejas-secas", grams: 70 },
          { foodKey: "aceite-oliva", grams: 8 },
        ]),
      ),
    ).toEqual([]);
  });

  it("rechaza pesar en crudo una fila que solo existe cocida", () => {
    const [problem] = validateGolden(recipe([{ foodKey: "quinoa", grams: 70 }]));
    expect(problem).toMatch(/solo existe cocido/);
  });

  it("indica la fila en seco cuando existe", () => {
    const [problem] = validateGolden(recipe([{ foodKey: "arroz-blanco", grams: 70 }]));
    expect(problem).toMatch(/arroz-crudo/);
  });

  it("rechaza una fila en seco marcada como cocinada", () => {
    const [problem] = validateGolden(
      recipe([{ foodKey: "pasta-cruda", grams: 180, state: "cocinado" }]),
    );
    expect(problem).toMatch(/fila en seco/);
  });

  it("exige fuentes", () => {
    const sinFuentes = { ...recipe([{ foodKey: "tomate", grams: 100 }]), sources: [] };
    expect(validateGolden(sinFuentes)).toContain("sin fuentes");
  });
});

describe("foodIdentity", () => {
  it("los tres aceites son el mismo ingrediente", () => {
    const girasol = FOODS.find((f) => f.key === "aceite-girasol")!;
    const oliva = FOODS.find((f) => f.key === "aceite-oliva")!;
    expect(foodIdentity(girasol)).toBe(foodIdentity(oliva));
  });

  it("un ingrediente sin identificar no coincide con nada de la tabla", () => {
    expect(foodIdentity(GENERIC_FOOD, "picatostes")).toBe("?picatostes");
  });
});

describe("GOLDEN_RECIPES", () => {
  it("todas las recetas son válidas (un renombrado en la tabla no rompe el eval en silencio)", () => {
    const broken = GOLDEN_RECIPES.flatMap((r) => validateGolden(r).map((p) => `${r.dish}: ${p}`));
    expect(broken).toEqual([]);
  });

  it("no repite platos", () => {
    const dishes = GOLDEN_RECIPES.map((r) => r.dish.toLowerCase());
    expect(new Set(dishes).size).toBe(dishes.length);
  });

  it("tiene el reparto por momento del día que pide el ticket 02", () => {
    const count = (slot: GoldenRecipe["slot"]) =>
      GOLDEN_RECIPES.filter((r) => r.slot === slot).length;
    expect(count("desayuno")).toBe(15);
    expect(count("comida")).toBe(25);
    expect(count("cena")).toBe(20);
    expect(count("merienda")).toBe(10);
    expect(count("distinto")).toBe(5);
  });
});

describe("tableErrorOf", () => {
  it("mide la fila casada y dice si es la esperada", () => {
    const e = tableErrorOf({
      name: "pechuga de pollo",
      expectedKey: "pechuga-pollo",
      per100: { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
      source: "prueba",
      reviewedBy: null,
    });
    expect(e.matchedRight).toBe(true);
    expect(e.kcalErr).toBeCloseTo(0, 6);
  });

  it("señala un casado a la fila equivocada", () => {
    const e = tableErrorOf({
      name: "pechuga de pollo",
      expectedKey: "pavo-pechuga",
      per100: { kcal: 135, protein_g: 29, carbs_g: 0, fat_g: 1.5 },
      source: "prueba",
      reviewedBy: null,
    });
    expect(e.matchedRight).toBe(false);
    expect(e.expectedExists).toBe(true);
    expect(e.kcalErr).toBeGreaterThan(0.2);
  });

  it("sin fila que case, mide el genérico que sumaría producción y avisa de la fila que falta", () => {
    const e = tableErrorOf({
      name: "fuet",
      expectedKey: "fuet",
      per100: { kcal: 438, protein_g: 27, carbs_g: 3.2, fat_g: 36 },
      source: "prueba",
      reviewedBy: null,
    });
    expect(e.matchedKey).toBeNull();
    expect(e.expectedExists).toBe(false);
    expect(e.kcalErr).toBeCloseTo((GENERIC_FOOD.kcal - 438) / 438, 6);
  });
});
