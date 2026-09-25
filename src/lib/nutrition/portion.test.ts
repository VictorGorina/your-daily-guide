import { describe, expect, it } from "bun:test";

import {
  eatenPortion,
  learnedPortionSize,
  portionFactors,
  sharedPortion,
  showsSizeChips,
} from "./portion";

/** Solo lo que usa `portionFactors`: el objetivo y el mantenimiento. */
const targets = (kcal: number, tdee: number) => ({ kcal, basis: { tdee } }) as never;

describe("portionFactors (ticket 21)", () => {
  it("mujer, 32 años, 62 kg, sedentaria, perder: 1.312 / 1.574", () => {
    expect(portionFactors(targets(1312, 1574), { sex: "Mujer" })).toEqual({
      plan: 0.66,
      habitual: 0.79,
      basis: "objetivo",
    });
  });

  it("hombre, 40 años, 85 kg, ligero, mantener: 2.448 / 2.448", () => {
    const f = portionFactors(targets(2448, 2448), { sex: "Hombre" });
    expect(f.plan).toBe(1.22);
    expect(f.habitual).toBe(1.22);
  });

  it("hombre, 24 años, 78 kg, alto, ganar: el plan topa en 1,7", () => {
    const f = portionFactors(targets(3442, 3142), { sex: "Hombre" });
    expect(f.plan).toBe(1.7);
    expect(f.habitual).toBe(1.57);
  });

  it("topa por abajo en 0,6", () => {
    expect(portionFactors(targets(1000, 1100), { sex: "Mujer" }).plan).toBe(0.6);
  });

  it("sin objetivo (falta la altura): por sexo", () => {
    expect(portionFactors(null, { sex: "Hombre" })).toEqual({
      plan: 1.25,
      habitual: 1.25,
      basis: "sexo",
    });
    expect(portionFactors(null, { sex: "Mujer" }).plan).toBe(1);
    expect(portionFactors(null, { sex: null }).plan).toBe(1.12);
  });
});

describe("sharedPortion (D4)", () => {
  it("una comida compartida entre 0,66 y 1,22 es 0,94 para los dos", () => {
    expect(sharedPortion([0.66, 1.22])).toBe(0.94);
  });

  it("sin nadie que la coma, no hay ración compartida", () => {
    expect(sharedPortion([])).toBeNull();
  });
});

describe("eatenPortion — 'comí distinto' (ticket 17, D10)", () => {
  it("un plato de pasta: más a quien gasta más, en proporción a su factor", () => {
    const small = eatenPortion({ servingKind: "plato", textQuantity: null, habitual: 0.69 });
    const big = eatenPortion({ servingKind: "plato", textQuantity: null, habitual: 1.54 });
    expect(big / small).toBeCloseTo(1.54 / 0.69, 2);
  });

  it("una pizza es una pizza para todos; media pizza, media", () => {
    const pizza = (habitual: number, textQuantity: number | null = null) =>
      eatenPortion({ servingKind: "unidad", textQuantity, habitual });
    expect(pizza(0.69)).toBe(1);
    expect(pizza(1.54)).toBe(1);
    expect(pizza(1.54, 0.5)).toBe(0.5);
  });

  it("dos platos de lentejas: dos de SU plato", () => {
    expect(eatenPortion({ servingKind: "plato", textQuantity: 2, habitual: 1.2 })).toBe(2.4);
  });

  it("el chip grande multiplica por 1,3; con cantidad en el texto, no hay chips", () => {
    expect(
      eatenPortion({ servingKind: "plato", textQuantity: null, habitual: 1, size: "grande" }),
    ).toBe(1.3);
    expect(
      eatenPortion({ servingKind: "plato", textQuantity: 2, habitual: 1, size: "grande" }),
    ).toBe(2);
    expect(showsSizeChips(0.5)).toBe(false);
    expect(showsSizeChips(null)).toBe(true);
  });
});

describe("learnedPortionSize", () => {
  it("tras 5 'grande' seguidos, 'grande' viene preseleccionado", () => {
    expect(learnedPortionSize(["grande", "grande", "grande", "grande", "grande"])).toBe("grande");
  });

  it("con menos de 5, o mezclados, 'normal'", () => {
    expect(learnedPortionSize(["grande", "grande", "grande", "grande"])).toBe("normal");
    expect(learnedPortionSize(["grande", "grande", "normal", "grande", "grande"])).toBe("normal");
  });

  it("cuentan las 5 más recientes", () => {
    expect(
      learnedPortionSize(["normal", "pequena", "pequena", "pequena", "pequena", "pequena"]),
    ).toBe("pequena");
  });
});
