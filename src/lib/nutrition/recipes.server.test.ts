import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeRow } from "@/test/fake-supabase";

import { resolveIngredient, ZERO } from "./nutrition";
import { FOODS_VERSION, PIPELINE_VERSION } from "./recipe";
import { getRecipes } from "./recipes.server";
import type { DishBreakdown, decomposeDishes } from "./resolve-dish.server";

type Decompose = typeof decomposeDishes;

/** Una receta calculada de un solo ingrediente, como la deja `decomposeDishes`. */
function calculated(dish: string, key: string, grams: number): DishBreakdown {
  const ing = resolveIngredient({ key, name: key, grams, state: "crudo" });
  return {
    dish,
    servings: 1,
    ingredients: [ing],
    macros: { ...ZERO },
    perServing: { ...ZERO },
    price: 0,
    quality: 1,
    isFood: true,
    vague: false,
    source: "model",
    methods: ["guiso"],
    servingKind: "plato",
    textQuantity: null,
    flags: [],
  };
}

const unresolved = (dish: string): DishBreakdown => ({
  ...calculated(dish, "lentejas", 60),
  ingredients: [],
  source: "unresolved",
  failure: "tiempo",
});

/** `decompose` falso: devuelve lo que diga `answers` y apunta qué se le pidió. */
function fakeDecompose(answers: Record<string, DishBreakdown>) {
  const asked: string[][] = [];
  const decompose: Decompose = async (dishes) => {
    asked.push([...dishes]);
    return new Map(dishes.filter((d) => answers[d]).map((d) => [d, answers[d]!]));
  };
  return { decompose, asked };
}

const cachedRow = (dishKey: string, label: string): FakeRow => ({
  dish_key: dishKey,
  dish_label: label,
  ingredients: [
    { foodKey: "garbanzos", name: "garbanzos", gramsRaw: 60, state: "crudo", confidence: "high" },
  ],
  methods: ["guiso"],
  serving_kind: "plato",
  unit_label: null,
  text_quantity: null,
  quality: 1,
  flags: [],
  pipeline_version: PIPELINE_VERSION,
  foods_version: FOODS_VERSION,
  reviewed: false,
});

describe("getRecipes — caché global de recetas", () => {
  it("sirve de la caché lo guardado y descompone solo lo que falta", async () => {
    const fake = createFakeSupabase(
      { dish_recipes: [cachedRow("cocido", "Cocido")] },
      { rpc: { increment_dish_recipe_hits: () => null } },
    );
    setFakeAdmin(fake.client);
    const { decompose, asked } = fakeDecompose({
      "Lentejas estofadas": calculated("Lentejas estofadas", "lentejas", 60),
    });

    const out = await getRecipes(["Cocido", "Lentejas estofadas"], { userId: "u1", decompose });

    expect(asked).toEqual([["Lentejas estofadas"]]);
    expect(out.get("Cocido")?.fromCache).toBe(true);
    expect(out.get("Cocido")?.recipe?.ingredients[0]?.foodKey).toBe("garbanzos");
    expect(out.get("Lentejas estofadas")?.fromCache).toBe(false);
    // En crudo, la fila en seco.
    expect(out.get("Lentejas estofadas")?.recipe?.ingredients[0]?.foodKey).toBe("lentejas-secas");
  });

  it("apunta un uso de cada receta servida de la caché", async () => {
    const hits: unknown[] = [];
    const fake = createFakeSupabase(
      { dish_recipes: [cachedRow("cocido", "Cocido")] },
      { rpc: { increment_dish_recipe_hits: (args) => void hits.push(args) } },
    );
    setFakeAdmin(fake.client);

    await getRecipes(["Cocido"], { userId: "u1", decompose: fakeDecompose({}).decompose });
    await new Promise((resolve) => setTimeout(resolve, 0)); // el contador va sin esperar

    expect(hits).toEqual([{ _keys: ["cocido"] }]);
  });

  it("guarda lo calculado y no guarda lo que se quedó sin calcular", async () => {
    const fake = createFakeSupabase({ dish_recipes: [] });
    setFakeAdmin(fake.client);
    const { decompose } = fakeDecompose({
      "Merluza al horno": calculated("Merluza al horno", "merluza", 135),
      "Pisto manchego": unresolved("Pisto manchego"),
    });

    const out = await getRecipes(["Merluza al horno", "Pisto manchego"], {
      userId: "u1",
      decompose,
    });

    expect(fake.tables.dish_recipes!.map((r) => r.dish_label)).toEqual(["Merluza al horno"]);
    expect(out.get("Pisto manchego")?.recipe).toBeNull();
    expect(out.get("Pisto manchego")?.failure).toBe("tiempo");
  });

  it("lo que llega antes de un paso que lanza queda guardado", async () => {
    const fake = createFakeSupabase({ dish_recipes: [] });
    setFakeAdmin(fake.client);
    const decompose: Decompose = async (_dishes, opts) => {
      await opts.onCalculated?.([calculated("Garbanzos con espinacas", "garbanzos", 60)]);
      throw new Error("la función se cortó");
    };

    await expect(
      getRecipes(["Garbanzos con espinacas", "Pisto"], { userId: "u1", decompose }),
    ).rejects.toThrow("la función se cortó");

    expect(fake.tables.dish_recipes!.map((r) => r.dish_label)).toEqual(["Garbanzos con espinacas"]);
  });

  it("lo guardado por el camino no se vuelve a escribir al final", async () => {
    const fake = createFakeSupabase({ dish_recipes: [] });
    setFakeAdmin(fake.client);
    const early = calculated("Arroz con pollo", "arroz", 70);
    const late = calculated("Sopa de fideos", "fideos", 40);
    const decompose: Decompose = async (_dishes, opts) => {
      await opts.onCalculated?.([early]);
      return new Map([
        [early.dish, early],
        [late.dish, late],
      ]);
    };

    await getRecipes(["Arroz con pollo", "Sopa de fideos"], { userId: "u1", decompose });

    const upserts = fake.calls.filter((c) => c.table === "dish_recipes" && c.op === "upsert");
    expect(
      upserts.map((c) => (c.payload as { dish_label: string }[]).map((r) => r.dish_label)),
    ).toEqual([["Arroz con pollo"], ["Sopa de fideos"]]);
  });

  it("sin nada que descomponer no llama al modelo", async () => {
    const fake = createFakeSupabase(
      { dish_recipes: [cachedRow("cocido", "Cocido")] },
      { rpc: { increment_dish_recipe_hits: () => null } },
    );
    setFakeAdmin(fake.client);
    const { decompose, asked } = fakeDecompose({});

    await getRecipes(["Cocido"], { userId: "u1", decompose });

    expect(asked).toEqual([]);
  });
});
