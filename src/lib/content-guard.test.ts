import { describe, expect, test } from "bun:test";

import { blockedTermIn, isCleanFood, normalizeForMatch } from "./content-guard";

/**
 * Lo que estos tests fijan es la INTENCIÓN documentada en el módulo: la lista
 * corta la broma evidente sin llevarse por delante comida de verdad. El bloque
 * de "comida real" es el que importa — un falso positivo le impide a alguien
 * apuntar lo que ha comido, y eso es peor que una broma que luego caza el
 * modelo en `resolveDish`.
 */
describe("blockedTermIn", () => {
  describe("comida real que se parece a algo bloqueado", () => {
    // Cada uno de estos existía como regresión antes de escribir el módulo.
    const REAL_FOOD = [
      "cacahuetes con miel",
      "crema de cacao",
      "cacahuate tostado",
      "queso de tetilla",
      // `penne` colapsa a un término bloqueado si se quitan las letras repetidas.
      "penne al pesto",
      "pennes con tomate",
      "rabo de toro",
      "revuelto de cagarrias",
      "chochos con vinagre",
      "espaguetis a la puttanesca",
      "culantro picado",
      "pollo al horno",
      "pena de no cenar",
      "cocktail de gambas",
      "berberechos al natural",
      "leche con galletas",
      "huevos revueltos",
      "polvo de hornear",
    ];
    for (const dish of REAL_FOOD) {
      test(`deja pasar "${dish}"`, () => {
        expect(blockedTermIn(dish)).toBeNull();
        expect(isCleanFood(dish)).toBe(true);
      });
    }
  });

  describe("bromas", () => {
    const JOKES: [string, string][] = [
      ["caca", "caca"],
      ["CACA!!", "caca"],
      ["caaaacaaa", "caca"],
      ["c4c4", "caca"],
      ["una caca con patatas", "caca"],
      ["cacas", "caca"],
      ["penes", "pene"],
      ["pene con salsa", "pene"],
      ["p3n3", "pene"],
      ["mierda", "mierda"],
      ["plato de heces", "heces"],
      ["sopa de polla", "polla"],
      ["shit sandwich", "shit"],
    ];
    for (const [text, term] of JOKES) {
      test(`bloquea "${text}"`, () => {
        expect(blockedTermIn(text)).toBe(term);
        expect(isCleanFood(text)).toBe(false);
      });
    }
  });

  test("compara por token entero, nunca por subcadena", () => {
    // El bug clásico: "caca" dentro de "cacahuete", "cock" dentro de "cocktail".
    expect(blockedTermIn("cacahuete")).toBeNull();
    expect(blockedTermIn("cocktail")).toBeNull();
    // Pero el mismo término suelto sí cae.
    expect(blockedTermIn("caca huete")).toBe("caca");
  });

  test("texto vacío o raro no revienta", () => {
    expect(blockedTermIn("")).toBeNull();
    expect(blockedTermIn("   ")).toBeNull();
    expect(blockedTermIn("123 456")).toBeNull();
  });
});

describe("normalizeForMatch", () => {
  test("quita tildes y deshace el leet", () => {
    expect(normalizeForMatch("Melocotón")).toBe("melocoton");
    expect(normalizeForMatch("P3N3")).toBe("pene");
    expect(normalizeForMatch("C@C@")).toBe("caca");
  });

  test("no colapsa letras repetidas (penne tiene que llegar entero)", () => {
    expect(normalizeForMatch("penne")).toBe("penne");
  });
});
