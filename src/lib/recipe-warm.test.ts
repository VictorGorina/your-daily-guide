import { beforeEach, describe, expect, it } from "bun:test";

import { dishKey } from "./nutrition/dish-key";
import type { MonthlyPlan } from "./plan-shared";
import {
  _resetRecipeWarm,
  getRecipeWarmProgress,
  warmingDates,
  warmPlanRecipes,
  type WarmFn,
} from "./recipe-warm";

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

describe("qué se está calculando (calendario de Plan)", () => {
  beforeEach(() => {
    store.clear();
    _resetRecipeWarm();
  });

  it("`pending` pierde cada tanda al volver y queda vacío al acabar", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = dishKey("Plato número 1");
    const run = warmPlanRecipes(dishes, async (chunk) => {
      // La tanda del plato 1 vuelve enseguida; las otras esperan.
      if (!chunk.includes("Plato número 1")) await gate;
      return { results: chunk.map((dish) => ({ dish, status: "calculado" })) };
    });
    expect(getRecipeWarmProgress().pending.size).toBe(20);

    await new Promise((r) => setTimeout(r, 0));
    const mid = getRecipeWarmProgress();
    expect(mid.running).toBe(true);
    expect(mid.pending.has(first)).toBe(false);
    expect(mid.pending.size).toBe(12);
    expect(mid.done).toBe(8);

    release();
    await run;
    const end = getRecipeWarmProgress();
    expect(end.running).toBe(false);
    expect(end.pending.size).toBe(0);
  });

  it("un plato que falla deja de contar como «calculándose» al volver su tanda", async () => {
    await warmPlanRecipes(["Pizza"], async () => {
      throw new Error("sin red");
    });
    expect(getRecipeWarmProgress().pending.size).toBe(0);
  });

  const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const plan: MonthlyPlan = {
    intro: "intro",
    focus: ["foco"],
    weeks: Array.from({ length: 4 }, (_, wi) => ({
      label: `Semana ${wi + 1}`,
      focus: "",
      breakfasts: ["Avena"],
      snacks: ["Fruta"],
      days: DAY_NAMES.map((day, di) => ({
        day,
        lunch: `Comida S${wi}D${di}`,
        dinner: `Cena S${wi}D${di}`,
      })),
    })),
  };

  it("marca los días con algún plato pendiente, de hoy en adelante", () => {
    // 2026-08-05 es miércoles → semana 0, día 2 (ver plan-shared.test.ts).
    const pending = new Set([dishKey("Comida S0D2"), dishKey("Comida S0D1")]);
    const dates = warmingDates(plan, "2026-08", "2026-08-05", pending);
    expect(dates.has("2026-08-05")).toBe(true);
    // El martes 4 también lleva un plato pendiente, pero ya ha pasado.
    expect(dates.has("2026-08-04")).toBe(false);
    expect(dates.has("2026-08-06")).toBe(false);
  });

  it("un plato que se repite (el desayuno) marca todos sus días", () => {
    const dates = warmingDates(plan, "2026-08", "2026-08-25", new Set([dishKey("Avena")]));
    expect([...dates].sort()).toEqual(
      Array.from({ length: 7 }, (_, i) => `2026-08-${String(25 + i).padStart(2, "0")}`),
    );
  });

  it("sin pasada en curso no marca nada", () => {
    expect(warmingDates(plan, "2026-08", "2026-08-05", new Set()).size).toBe(0);
    expect(warmingDates(null, "2026-08", "2026-08-05", new Set(["x"])).size).toBe(0);
  });
});
