import { describe, expect, test } from "bun:test";

import { GOLDEN_RECIPES } from "@/lib/plan-eval/golden-recipes.data";

import { cookingFatGrams, parseCookingMethods } from "./cooking";
import {
  foodByKey,
  gramsInRowBasis,
  resolveIngredient,
  type ResolvedIngredient,
} from "./nutrition";
import {
  applyCookingFat,
  missingTitleFoods,
  validateRecipe,
  type RecipeSlot,
} from "./validate-recipe";

/** Una receta de referencia como la resolvería el pipeline si el modelo la clavara. */
function goldenAsResolved(recipe: (typeof GOLDEN_RECIPES)[number]): ResolvedIngredient[] {
  return recipe.ingredients.map((ing) => {
    const food = foodByKey(ing.foodKey)!;
    const state = ing.state === "cocinado" ? "listo" : "crudo";
    return {
      name: food.label,
      grams: gramsInRowBasis(ing.grams, food, state),
      gramsRaw: ing.grams,
      state,
      food,
      confidence: "high",
    };
  });
}

const ing = (key: string, grams: number, state: "crudo" | "listo" = "crudo") =>
  resolveIngredient({ key, grams, state });

describe("validateRecipe contra el golden set", () => {
  test("ninguna receta de referencia se recorta, se toca ni pide reintento", () => {
    const wrong: string[] = [];
    for (const recipe of GOLDEN_RECIPES) {
      const out = validateRecipe(goldenAsResolved(recipe), recipe.dish, recipe.slot as RecipeSlot);
      // La banda de kcal es solo un aviso: hay cenas de referencia por debajo.
      const bad = out.flags.filter((f) => f !== "fuera_de_banda");
      if (bad.length || out.retryHint) wrong.push(`${recipe.dish}: ${out.notes.join("; ")}`);
    }
    expect(wrong).toEqual([]);
  });

  test("ningún título del golden set echa en falta algo que su referencia trae", () => {
    const wrong = GOLDEN_RECIPES.flatMap((recipe) =>
      missingTitleFoods(recipe.dish, goldenAsResolved(recipe)).map(
        (food) => `${recipe.dish}: ${food.key}`,
      ),
    );
    expect(wrong).toEqual([]);
  });
});

describe("omisiones", () => {
  test("lentejas con chorizo sin chorizo pide reintento con pista", () => {
    const out = validateRecipe(
      [ing("lentejas-secas", 60), ing("cebolla", 30), ing("zanahoria", 40)],
      "Lentejas con chorizo",
      "comida",
    );
    expect(out.flags).toContain("falta_ingrediente");
    expect(out.retryHint).toContain("chorizo");
  });

  test("el muslo cuenta como pollo y el atún de lata como atún", () => {
    expect(
      missingTitleFoods("Arroz con pollo", [ing("arroz-crudo", 70), ing("muslo-pollo", 110)]),
    ).toEqual([]);
    expect(
      missingTitleFoods("Ensalada de atún", [ing("lechuga", 80), ing("atun-lata", 60, "listo")]),
    ).toEqual([]);
  });
});

describe("rangos (techos por ración base)", () => {
  test("300 g de muslo crudo se recortan a 180 g crudos", () => {
    const out = validateRecipe(
      [ing("muslo-pollo", 300), ing("patata", 175)],
      "Muslo de pollo con patatas",
      "comida",
    );
    expect(out.flags).toContain("recortado");
    const muslo = out.ingredients.find((i) => i.food.key === "muslo-pollo")!;
    expect(muslo.gramsRaw).toBe(180);
  });

  test("el arroz cocido se mide en su equivalente en seco", () => {
    // 400 g de arroz cocido ≈ 144 g en seco: por encima del techo de 100.
    const out = validateRecipe([ing("arroz-blanco", 400, "listo")], "Arroz blanco", null);
    const rice = out.ingredients[0]!;
    expect(rice.grams).toBeLessThan(400);
    expect(Math.round((rice.grams * 130) / 360)).toBe(100);
  });

  test("fruta troceada encima de un yogur: media pieza como mucho", () => {
    const out = validateRecipe(
      [ing("yogur-natural", 125, "listo"), ing("platano", 150)],
      "Yogur con plátano",
      "merienda",
    );
    expect(out.ingredients.find((i) => i.food.key === "platano")!.grams).toBe(80);
    // Pero un plátano como plato es un plátano entero.
    const whole = validateRecipe([ing("platano", 120)], "Plátano", "merienda");
    expect(whole.ingredients[0]!.grams).toBe(120);
  });

  test("una crema que no nombra la patata no la lleva", () => {
    const out = validateRecipe(
      [ing("calabacin", 200), ing("patata", 60), ing("cebolla", 30)],
      "Crema de calabacín",
      "cena",
    );
    expect(out.ingredients.some((i) => i.food.key === "patata")).toBe(false);
    expect(out.flags).toContain("inventado");
  });
});

describe("grasa por método (ticket 14 §2)", () => {
  test("el código sustituye el aceite del modelo por el de la tabla", () => {
    const out = applyCookingFat(
      [ing("pechuga-pollo", 110), ing("aceite-oliva", 20, "listo")],
      parseCookingMethods(["plancha"]),
      "Pechuga a la plancha",
    );
    const oil = out.ingredients.filter((i) => i.food.key === "aceite-oliva");
    expect(oil).toHaveLength(1);
    expect(oil[0]!.grams).toBe(5);
    expect(out.changed).toBe(true);
  });

  test("sin aceite en el nombre: 0 g", () => {
    expect(cookingFatGrams(parseCookingMethods(["plancha"]), "Pollo a la plancha sin aceite")).toBe(
      0,
    );
    const out = applyCookingFat(
      [ing("merluza", 135), ing("aceite-oliva", 10, "listo")],
      parseCookingMethods(["hervido"]),
      "Merluza al vapor",
    );
    expect(out.ingredients.some((i) => i.food.key === "aceite-oliva")).toBe(false);
  });

  test("dos métodos: el aliño se suma al calor (ensalada aliñada con pollo a la plancha)", () => {
    expect(cookingFatGrams(parseCookingMethods(["alinada", "plancha"]), "Ensalada con pollo")).toBe(
      13,
    );
  });

  test("dos métodos de calor no se suman: cuenta el mayor (misma sartén)", () => {
    expect(cookingFatGrams(parseCookingMethods(["guiso", "horno"]), "Pimientos rellenos")).toBe(10);
  });

  test("una tostada con un revuelto encima no se unta además", () => {
    expect(
      cookingFatGrams(parseCookingMethods(["untada", "salteado"]), "Tostada con huevo revuelto"),
    ).toBe(8);
  });

  test("en freidora de aire, un frito cuenta como plancha", () => {
    expect(
      cookingFatGrams(parseCookingMethods(["frito_rebozado"]), "Croquetas en freidora de aire"),
    ).toBe(5);
  });

  test("un plato solo de productos hechos no suma grasa de horno", () => {
    const out = applyCookingFat(
      [ing("pizza", 300, "listo")],
      parseCookingMethods(["horno"]),
      "Pizza",
    );
    expect(out.ingredients.some((i) => i.food.category === "grasa")).toBe(false);
  });

  test("la mantequilla marcada como grasa de cocinar se queda como tipo, con la cantidad de la tabla", () => {
    const out = applyCookingFat(
      [ing("pan-blanco", 50, "listo"), ing("mantequilla", 20, "listo")],
      parseCookingMethods(["untada"]),
      "Tostada con mantequilla",
      [false, true],
    );
    const fat = out.ingredients.find((i) => i.food.category === "grasa")!;
    expect(fat.food.key).toBe("mantequilla");
    expect(fat.grams).toBe(5);
  });

  test("tostada con aceite clasificada como cruda: el título manda", () => {
    const out = applyCookingFat(
      [ing("pan-integral", 50, "listo")],
      parseCookingMethods(["cruda"]),
      "Tostada con aceite",
    );
    expect(out.ingredients.find((i) => i.food.key === "aceite-oliva")?.grams).toBe(5);
  });
});
