import { describe, expect, it } from "bun:test";

import { cleanCanonicalIngredients, type CanonicalIngredient } from "./recipe";

const ok: CanonicalIngredient = {
  foodKey: "garbanzos",
  name: "garbanzos",
  gramsRaw: 60,
  state: "crudo",
  confidence: "high",
};

describe("cleanCanonicalIngredients (ticket 36, punto 6)", () => {
  it("una receta bien guardada sale idéntica, claves desconocidas incluidas", () => {
    const raw = [ok, { ...ok, foodKey: "aceite-oliva", gramsRaw: 5, fallback: "usda", nuevo: 1 }];
    expect(cleanCanonicalIngredients(raw)).toEqual(raw as never);
  });

  it("si no es una lista, no hay receta", () => {
    expect(cleanCanonicalIngredients(null)).toBeNull();
    expect(cleanCanonicalIngredients({ 0: ok })).toBeNull();
    expect(cleanCanonicalIngredients("[]")).toBeNull();
  });

  it("un ingrediente que no se puede sumar tira la receta entera: no se usa a medias", () => {
    for (const broken of [
      null,
      "garbanzos",
      [ok],
      { ...ok, foodKey: "" },
      { ...ok, gramsRaw: "60" },
      { ...ok, gramsRaw: Number.NaN },
      { ...ok, gramsRaw: -1 },
      { ...ok, state: "cocido" },
      { ...ok, confidence: "media" },
    ]) {
      expect(cleanCanonicalIngredients([ok, broken])).toBeNull();
    }
  });

  it("lo que solo informa se arregla: sin nombre vale la clave, y un fallback raro se quita", () => {
    const { name: _name, ...noName } = ok;
    expect(cleanCanonicalIngredients([noName, { ...ok, fallback: "otro" }])).toEqual([
      { ...ok },
      { ...ok },
    ]);
  });

  it("una lista vacía es una lista vacía (quien la lee decide)", () => {
    expect(cleanCanonicalIngredients([])).toEqual([]);
  });
});
