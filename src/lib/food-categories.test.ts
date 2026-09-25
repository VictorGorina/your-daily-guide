import { describe, expect, it } from "bun:test";

import {
  classifyDish,
  dishAsset,
  FOOD_CATEGORIES,
  foodCategoryAccent,
  ingredientIcon,
} from "./food-categories";

describe("classifyDish", () => {
  it("clasifica por palabras clave en español", () => {
    expect(classifyDish("Ensalada de tomate")).toBe("verdura");
    expect(classifyDish("Lentejas estofadas")).toBe("legumbre");
    expect(classifyDish("Salmón a la plancha")).toBe("pescado");
  });

  it("ignora acentos y mayúsculas", () => {
    expect(classifyDish("SALMÓN")).toBe(classifyDish("salmon"));
  });

  it("cae en 'otro' cuando nada encaja", () => {
    expect(classifyDish("")).toBe("otro");
    expect(classifyDish("qwerty zxcvb")).toBe("otro");
  });

  it("las palabras clave de varias palabras se comprueban antes que las sueltas", () => {
    // "tortilla de patata" está en la lista de verdura a propósito; una
    // coincidencia suelta posterior no debe ganarle.
    expect(classifyDish("Tortilla de patata")).toBe("verdura");
  });

  it("respeta los límites de palabra (no 'pan' dentro de 'empanada')", () => {
    // el plato lleva atún → pescado; lo que NO debe pasar es que clasifique por
    // un 'pan' incrustado en 'empanada'
    expect(classifyDish("Empanada de atún")).toBe("pescado");
  });

  it("casa las palabras clave con ñ (el plato pierde la tilde al normalizarse)", () => {
    // Regresión: se normalizaba el plato ("lasaña" → "lasana") pero no la
    // palabra clave, así que ninguna con ñ podía casar nunca.
    expect(classifyDish("Lasaña")).toBe("pasta");
    expect(classifyDish("Piña")).toBe("fruta");
    expect(classifyDish("Champiñones salteados")).toBe("verdura");
    expect(classifyDish("Revuelto de champiñones")).toBe("verdura");
  });
});

describe("ingredientIcon", () => {
  it("casa las palabras clave con ñ", () => {
    expect(ingredientIcon("Lasaña")).toBe("/food/icon-pasta.svg");
    expect(ingredientIcon("Champiñones salteados")).toBe("/food/icon-champinon.svg");
    expect(dishAsset("Lasaña")).toBe("/food/icon-pasta.svg");
  });
});

describe("foodCategoryAccent", () => {
  it("devuelve el hex de la categoría (paleta de design-guidelines §2)", () => {
    expect(foodCategoryAccent("qwerty zxcvb")).toBe("#83796C"); // otro
    expect(foodCategoryAccent("Ensalada verde")).toBe("#6DBE7B"); // verdura
  });

  it("todo acento es un hex de 6 dígitos", () => {
    for (const { accent } of Object.values(FOOD_CATEGORIES)) {
      expect(accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
