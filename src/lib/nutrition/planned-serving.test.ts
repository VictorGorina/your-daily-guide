import { describe, expect, it } from "bun:test";

import { resolveEatenServing, resolveServing, type ServingContext } from "./planned-serving.server";

const ctx = (over: Partial<ServingContext> = {}): ServingContext => ({
  own: { plan: 0.9, habitual: 1.1 },
  energy: {
    kcal: 1800,
    basis: { tdee: 2200 },
    perSlot: {
      desayuno: { kcal: 450, protein_g: 20 },
      comida: { kcal: 630, protein_g: 35 },
      cena: { kcal: 500, protein_g: 30 },
      snack: { kcal: 220, protein_g: 10 },
    },
  },
  shared: {},
  kcalAdjust: null,
  ...over,
});

describe("resolveServing", () => {
  it("comida propia: su ración y el objetivo de esa comida", () => {
    expect(resolveServing("Comida", ctx())).toEqual({
      serving: { base: 0.9, target: { kcal: 630, protein_g: 35 } },
      shared: false,
    });
  });

  it("la merienda va contra el objetivo de `snack`", () => {
    expect(resolveServing("Merienda", ctx()).serving.target).toEqual({ kcal: 220, protein_g: 10 });
  });

  it("suma lo que la compensación movió a esa comida, y solo a esa", () => {
    const c = ctx({ kcalAdjust: { cena: -140 } });
    expect(resolveServing("Cena", c).serving.target).toEqual({ kcal: 360, protein_g: 30 });
    expect(resolveServing("Comida", c).serving.target).toEqual({ kcal: 630, protein_g: 35 });
  });

  it("comida compartida: la ración y el objetivo medios, sin el ajuste propio (D4)", () => {
    const c = ctx({
      shared: { cena: { factor: 1.05, target: { kcal: 610, protein_g: 33 } } },
      kcalAdjust: { cena: -140 },
    });
    expect(resolveServing("Cena", c)).toEqual({
      serving: { base: 1.05, target: { kcal: 610, protein_g: 33 } },
      shared: true,
    });
  });

  it("sin objetivo (menor de edad o faltan datos): la ración personal sin escalar", () => {
    expect(resolveServing("Comida", ctx({ energy: null })).serving).toEqual({
      base: 0.9,
      target: null,
    });
  });

  it("un momento que no es una comida del plan no tiene objetivo", () => {
    expect(resolveServing("Otro", ctx()).serving.target).toBeNull();
  });
});

describe("resolveEatenServing", () => {
  it("la ración habitual y el objetivo de la comida a mantenimiento", () => {
    // 630 × 2.200 / 1.800 = 770.
    expect(resolveEatenServing("Comida", ctx())).toEqual({
      base: 1.1,
      target: { kcal: 770, protein_g: 35 },
    });
  });

  it("siempre la propia: ni la del hogar ni el ajuste de otro día", () => {
    const c = ctx({
      shared: { comida: { factor: 1.3, target: { kcal: 900, protein_g: 40 } } },
      kcalAdjust: { comida: -200 },
    });
    expect(resolveEatenServing("Comida", c).target).toEqual({ kcal: 770, protein_g: 35 });
  });

  it("sin objetivo, la ración habitual sin escalar", () => {
    expect(resolveEatenServing("Cena", ctx({ energy: null }))).toEqual({
      base: 1.1,
      target: null,
    });
  });
});
