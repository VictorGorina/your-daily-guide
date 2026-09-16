import { describe, expect, it } from "bun:test";

import { COMPENSATION_THRESHOLDS, compensationNeed } from "./compensation";

// ---------------------------------------------------------------------------
// compensationNeed — la tabla de umbrales aprobada (D5), en cada límite
// ---------------------------------------------------------------------------

const decide = (deltaKcal: number, goal: string | null, extra: object = {}) =>
  compensationNeed({ deltaKcal, goal, ...extra });

describe("compensationNeed", () => {
  it("perder: compensa desde +200 y desde −400", () => {
    expect(decide(199, "perder").compensate).toBe(false);
    expect(decide(200, "perder")).toEqual({ compensate: true, kcalDelta: 200, proteinDelta: null });
    expect(decide(-399, "perder").compensate).toBe(false);
    expect(decide(-400, "perder")).toEqual({
      compensate: true,
      kcalDelta: -400,
      proteinDelta: null,
    });
  });

  it("mantener: ±200", () => {
    expect(decide(199, "mantener").compensate).toBe(false);
    expect(decide(200, "mantener").compensate).toBe(true);
    expect(decide(-199, "mantener").compensate).toBe(false);
    expect(decide(-200, "mantener").compensate).toBe(true);
  });

  it("ganar: compensa desde +400 y desde −200", () => {
    expect(decide(399, "ganar").compensate).toBe(false);
    expect(decide(400, "ganar").compensate).toBe(true);
    expect(decide(-199, "ganar").compensate).toBe(false);
    expect(decide(-200, "ganar").compensate).toBe(true);
  });

  it("sin objetivo, o con uno desconocido, usa la fila de mantener", () => {
    for (const goal of [null, "habitos", "salud"]) {
      expect(decide(199, goal).compensate).toBe(false);
      expect(decide(200, goal).compensate).toBe(true);
      expect(decide(-200, goal).compensate).toBe(true);
    }
    expect(COMPENSATION_THRESHOLDS.mantener).toEqual({ above: 200, below: -200 });
  });

  it("por debajo del umbral dice por qué no compensa", () => {
    expect(decide(120, "perder")).toEqual({ compensate: false, reason: "below-threshold" });
  });

  it("una bajada de proteína de 20 g compensa aunque las kcal no lleguen", () => {
    expect(decide(50, "perder", { deltaProtein: -19 }).compensate).toBe(false);
    expect(decide(50, "perder", { deltaProtein: -20 })).toEqual({
      compensate: true,
      kcalDelta: 50,
      proteinDelta: -20,
    });
  });

  it("embarazo o lactancia: nunca quita energía por un exceso", () => {
    for (const pregnancyStatus of ["embarazada", "lactancia"]) {
      expect(decide(600, "perder", { pregnancyStatus })).toEqual({
        compensate: false,
        reason: "pregnancy",
      });
      // Un déficit sí se repone: eso añade energía.
      expect(decide(-400, "perder", { pregnancyStatus }).compensate).toBe(true);
      // Con proteína baja, se repone la proteína sin tocar la energía.
      expect(decide(600, "perder", { pregnancyStatus, deltaProtein: -25 })).toEqual({
        compensate: true,
        kcalDelta: 0,
        proteinDelta: -25,
      });
    }
    expect(decide(600, "perder", { pregnancyStatus: "no" }).compensate).toBe(true);
  });

  it("redondea el desvío", () => {
    expect(decide(199.6, "perder")).toEqual({
      compensate: true,
      kcalDelta: 200,
      proteinDelta: null,
    });
  });
});
