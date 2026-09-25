import { describe, expect, it } from "bun:test";

import { dishKey } from "./dish-key";

describe("dishKey — mismo plato, misma receta (ticket 06)", () => {
  const same: [string, string][] = [
    ["Arroz con pollo", "Pollo con arroz"],
    ["Lentejas estofadas con verdura", "Lentejas estofadas con verduras"],
    ["  Crema de CALABACÍN ", "crema de calabacin"],
    ["Tostada integral con tomate y aceite", "tostada integral con aceite y tomate"],
  ];
  for (const [a, b] of same) it(`${a} = ${b}`, () => expect(dishKey(a)).toBe(dishKey(b)));

  const different: [string, string][] = [
    ["Pollo al curry", "Curry de garbanzos"],
    ["Cerveza sin alcohol", "Cerveza"],
    ["Queso fresco", "Queso"],
    ["Media pizza", "Pizza"],
    ["Yogur natural", "Yogur griego"],
  ];
  for (const [a, b] of different) it(`${a} ≠ ${b}`, () => expect(dishKey(a)).not.toBe(dishKey(b)));

  it("no queda vacía con un plato normal", () => {
    expect(dishKey("Manzana")).toBe("manzana");
  });
});
