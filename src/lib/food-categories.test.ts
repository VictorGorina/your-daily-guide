import { describe, expect, it } from "bun:test";

import { classifyDish, FOOD_CATEGORIES, foodCategoryAccent } from "./food-categories";

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
