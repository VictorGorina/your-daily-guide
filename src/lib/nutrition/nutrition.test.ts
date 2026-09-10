import { describe, expect, it } from "bun:test";

import { GENERIC_FOOD } from "./foods.data";
import {
  clampGrams,
  macrosOf,
  matchFood,
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
  it("es la proporción de gramos identificados con confianza alta", () => {
    const ingredients = [
      resolveIngredient({ key: "pechuga-pollo", name: "pollo", grams: 150 }), // high
      resolveIngredient({ name: "salsa marciana", grams: 50 }), // low → genérico
    ];
    expect(resolutionQuality(ingredients)).toBeCloseTo(0.75, 2);
  });

  it("es 0 sin gramos", () => {
    expect(resolutionQuality([])).toBe(0);
  });
});
