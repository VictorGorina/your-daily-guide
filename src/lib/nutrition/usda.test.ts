import { describe, expect, it } from "bun:test";

import { candidatesFromSearch, lookupUsdaFood, type UsdaDeps } from "./usda";

/** Respuesta de `/foods/search` recortada a lo que se lee (forma real de FDC). */
const lardSearch = {
  foods: [
    {
      fdcId: 171401,
      description: "Lard",
      dataType: "SR Legacy",
      foodNutrients: [
        { nutrientId: 1008, value: 902, unitName: "KCAL" },
        { nutrientId: 1003, value: 0, unitName: "G" },
        { nutrientId: 1004, value: 100, unitName: "G" },
        { nutrientId: 1005, value: 0, unitName: "G" },
      ],
    },
    {
      fdcId: 999999,
      description: "Shortening, household, lard and vegetable oil",
      dataType: "SR Legacy",
      foodNutrients: [
        { nutrientId: 1008, value: 900, unitName: "KCAL" },
        { nutrientId: 1003, value: 0, unitName: "G" },
        { nutrientId: 1004, value: 100, unitName: "G" },
        { nutrientId: 1005, value: 0, unitName: "G" },
      ],
    },
    // Sin energía: no es candidato.
    { fdcId: 1, description: "Lard, broken record", dataType: "SR Legacy", foodNutrients: [] },
  ],
};

const deps = (over: Partial<UsdaDeps> = {}): UsdaDeps => ({
  translate: async () => "lard",
  search: async () => lardSearch,
  pick: async () => 0,
  ...over,
});

describe("USDA (ticket 22)", () => {
  it("«manteca de cerdo» → la fila de lard de USDA (~900 kcal/100 g), con su fdcId", async () => {
    const found = await lookupUsdaFood({ name: "manteca de cerdo", category: "grasa" }, deps());
    expect(found?.candidate.fdcId).toBe(171401);
    expect(found?.food.key).toBe("usda-171401");
    expect(found?.food.kcal).toBe(902);
    expect(found?.food.fat_g).toBe(100);
    expect(found?.food.label).toBe("manteca de cerdo");
  });

  it("el modelo solo elige de la lista cerrada: un índice fuera de ella no vale", async () => {
    const found = await lookupUsdaFood(
      { name: "manteca de cerdo", category: "grasa" },
      deps({ pick: async () => 7 }),
    );
    expect(found).toBeNull();
  });

  it("sin respuesta de USDA, o sin resultados, no hay fila (queda el más parecido)", async () => {
    expect(
      await lookupUsdaFood({ name: "x", category: "grasa" }, deps({ search: async () => ({}) })),
    ).toBeNull();
    expect(
      await lookupUsdaFood({ name: "x", category: "grasa" }, deps({ translate: async () => null })),
    ).toBeNull();
  });

  it("la energía de Foundation (Atwater, 2047) y en kJ también se lee", () => {
    const [c] = candidatesFromSearch({
      foods: [
        {
          fdcId: 5,
          description: "Something, raw",
          dataType: "Foundation",
          foodNutrients: [
            { nutrientId: 2047, value: 418.4, unitName: "kJ" },
            { nutrientId: 1003, value: 10, unitName: "G" },
            { nutrientId: 1004, value: 1, unitName: "G" },
            { nutrientId: 1005, value: 5, unitName: "G" },
          ],
        },
      ],
    });
    expect(c?.per100.kcal).toBe(100);
  });
});
