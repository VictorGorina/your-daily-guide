import { beforeEach, describe, expect, it } from "bun:test";

import { _resetRecipeWarm, warmPlanRecipes, type WarmFn } from "./recipe-warm";

// `localStorage` en memoria: el runner de Bun no trae uno.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const dishes = Array.from({ length: 20 }, (_, i) => `Plato número ${i + 1}`);

describe("warmPlanRecipes (ticket 06)", () => {
  beforeEach(() => {
    store.clear();
    _resetRecipeWarm();
  });

  it("manda los platos en trozos de 8 y recuerda los calculados", async () => {
    const calls: string[][] = [];
    const warm: WarmFn = async (chunk) => {
      calls.push(chunk);
      return { results: chunk.map((dish) => ({ dish, status: "calculado" })) };
    };
    await warmPlanRecipes(dishes, warm);
    expect(calls.map((c) => c.length).sort()).toEqual([4, 8, 8]);
    // La segunda vez no queda nada que mandar.
    calls.length = 0;
    await warmPlanRecipes(dishes, warm);
    expect(calls).toEqual([]);
  });

  it("si se corta a medias, al volver solo manda lo que faltaba", async () => {
    let n = 0;
    const flaky: WarmFn = async (chunk) => {
      n += 1;
      if (n === 2) throw new Error("se cerró la app");
      return { results: chunk.map((dish) => ({ dish, status: "calculado" })) };
    };
    await warmPlanRecipes(dishes, flaky);

    const resent: string[] = [];
    await warmPlanRecipes(dishes, async (chunk) => {
      resent.push(...chunk);
      return { results: chunk.map((dish) => ({ dish, status: "calculado" })) };
    });
    // Solo el trozo que falló (el de 8 o el de 4, según el orden de los workers).
    expect([4, 8]).toContain(resent.length);
    expect(new Set(resent).size).toBe(resent.length);
  });

  it("un plato que sigue calculándose se vuelve a pedir la próxima vez", async () => {
    await warmPlanRecipes(["Pizza"], async (chunk) => ({
      results: chunk.map((dish) => ({ dish, status: "calculando" })),
    }));
    const again: string[] = [];
    await warmPlanRecipes(["Pizza"], async (chunk) => {
      again.push(...chunk);
      return { results: chunk.map((dish) => ({ dish, status: "calculado" })) };
    });
    expect(again).toEqual(["Pizza"]);
  });
});
