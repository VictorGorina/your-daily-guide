import { describe, expect, it } from "bun:test";

import {
  accuracyOf,
  accuracyReason,
  ingredientDiff,
  meanAccuracy,
  OIL_ID,
  percentile,
  referenceMainCount,
  spreadOf,
  summarize,
  type PortionItem,
} from "./accuracy";

/** Un ingrediente a partir de sus valores por 100 g, como hace `golden.ts`. */
const item = (
  id: string,
  grams: number,
  per100: { kcal: number; p: number; c: number; f: number },
): PortionItem => ({
  id,
  grams,
  kcal: (per100.kcal * grams) / 100,
  protein_g: (per100.p * grams) / 100,
  carbs_g: (per100.c * grams) / 100,
  fat_g: (per100.f * grams) / 100,
});

const LENTEJA = { kcal: 116, p: 9, c: 20, f: 0.4 };
const CHORIZO = { kcal: 350, p: 24, c: 2, f: 28 };
const ACEITE = { kcal: 884, p: 0, c: 0, f: 100 };
const ZANAHORIA = { kcal: 41, p: 0.9, c: 10, f: 0.2 };

const lentejasRef = [
  item("lentejas", 200, LENTEJA),
  item("chorizo", 30, CHORIZO),
  item(OIL_ID, 10, ACEITE),
  item("zanahoria", 50, ZANAHORIA),
];

describe("accuracyOf", () => {
  it("da error cero cuando la salida es la referencia", () => {
    const a = accuracyOf(lentejasRef, lentejasRef);
    expect(a.kcalErr).toBe(0);
    expect(a.densityErr).toBe(0);
    expect(a.splitPts).toBe(0);
    expect(a.omitted).toEqual([]);
    expect(a.invented).toEqual([]);
    expect(a.oilGramsDiff).toBe(0);
  });

  it("detecta un ingrediente principal omitido (el chorizo de las lentejas)", () => {
    const sinChorizo = lentejasRef.filter((i) => i.id !== "chorizo");
    const a = accuracyOf(lentejasRef, sinChorizo);
    expect(a.omitted).toEqual(["chorizo"]);
    expect(a.kcalErr).toBeLessThan(-0.2);
  });

  it("no cuenta como omitido un ingrediente menor", () => {
    const ref = [...lentejasRef, item("laurel", 1, { kcal: 300, p: 8, c: 50, f: 8 })];
    expect(accuracyOf(ref, lentejasRef).omitted).toEqual([]);
  });

  it("cuenta como principal algo que pesa mucho aunque aporte pocas kcal", () => {
    const crema = [
      item("calabacin", 300, { kcal: 17, p: 1.2, c: 3, f: 0.3 }),
      item(OIL_ID, 10, ACEITE),
    ];
    const sinCalabacin = [item(OIL_ID, 10, ACEITE)];
    expect(accuracyOf(crema, sinCalabacin).omitted).toEqual(["calabacin"]);
  });

  it("agrupa por identidad: dos filas del mismo ingrediente no son un invento", () => {
    const out = [
      item("lentejas", 150, LENTEJA),
      item("lentejas", 50, LENTEJA),
      item("chorizo", 30, CHORIZO),
      item(OIL_ID, 10, ACEITE),
      item("zanahoria", 50, ZANAHORIA),
    ];
    const a = accuracyOf(lentejasRef, out);
    expect(a.invented).toEqual([]);
    expect(a.mainGramsErr).toBe(0);
  });

  it("señala un ingrediente principal inventado", () => {
    const out = [...lentejasRef, item("patata", 150, { kcal: 87, p: 2, c: 20, f: 0.1 })];
    expect(accuracyOf(lentejasRef, out).invented).toEqual(["patata"]);
  });

  it("mide la diferencia de aceite en gramos", () => {
    const out = lentejasRef.map((i) => (i.id === OIL_ID ? item(OIL_ID, 25, ACEITE) : i));
    expect(accuracyOf(lentejasRef, out).oilGramsDiff).toBe(15);
  });

  it("la densidad no cambia si solo cambia el tamaño de la ración", () => {
    const doble = lentejasRef.map((i) => ({
      ...i,
      grams: i.grams * 2,
      kcal: i.kcal * 2,
      protein_g: i.protein_g * 2,
      carbs_g: i.carbs_g * 2,
      fat_g: i.fat_g * 2,
    }));
    const a = accuracyOf(lentejasRef, doble);
    expect(a.kcalErr).toBeCloseTo(1, 6);
    expect(a.densityErr).toBeCloseTo(0, 6);
    expect(a.splitPts).toBeCloseTo(0, 6);
  });

  it("mide el error de un macro contra un suelo para no inflar valores diminutos", () => {
    const fruta = [item("manzana", 150, { kcal: 52, p: 0.3, c: 14, f: 0.2 })];
    const conMasGrasa = [item("manzana", 150, { kcal: 52, p: 0.3, c: 14, f: 1 })];
    // 0,3 g → 1,5 g de grasa: sin suelo sería +400 %; con suelo de 5 g, +24 %.
    expect(accuracyOf(fruta, conMasGrasa).fatErr).toBeCloseTo((1.5 - 0.3) / 5, 6);
  });

  it("mide el reparto de macros en puntos de % de kcal", () => {
    const soloGrasa = [item(OIL_ID, 10, ACEITE)];
    const soloHidrato = [item("azucar", 22, { kcal: 400, p: 0, c: 100, f: 0 })];
    expect(accuracyOf(soloGrasa, soloHidrato).splitPts).toBeCloseTo(100, 6);
  });

  it("no se rompe con una salida vacía (plato sin descomponer)", () => {
    const a = accuracyOf(lentejasRef, []);
    expect(a.kcalErr).toBe(-1);
    expect(a.densityErr).toBeNull();
    expect(a.mainGramsErr).toBeNull();
    // La zanahoria (17 % de la masa, 5 % de las kcal) no llega a principal.
    expect(a.omitted.sort()).toEqual(["chorizo", "aceite", "lentejas"].sort());
  });
});

describe("meanAccuracy", () => {
  it("promedia el error y une las omisiones de todas las pasadas", () => {
    const sinChorizo = lentejasRef.filter((i) => i.id !== "chorizo");
    const a = meanAccuracy([
      accuracyOf(lentejasRef, lentejasRef),
      accuracyOf(lentejasRef, sinChorizo),
    ]);
    expect(a.omitted).toEqual(["chorizo"]);
    expect(a.kcalErr).toBeCloseTo(accuracyOf(lentejasRef, sinChorizo).kcalErr / 2, 6);
  });

  it("rechaza una lista vacía", () => {
    expect(() => meanAccuracy([])).toThrow();
  });
});

describe("spreadOf", () => {
  it("es cero si el plato da siempre la misma cifra", () => {
    expect(spreadOf([420, 420, 420])).toEqual({ stdevKcal: 0, cvPct: 0 });
  });

  it("mide la desviación típica y el coeficiente de variación", () => {
    const s = spreadOf([400, 500]);
    expect(s.stdevKcal).toBe(50);
    expect(s.cvPct).toBeCloseTo((50 / 450) * 100, 6);
  });

  it("con una sola pasada no hay dispersión que medir", () => {
    expect(spreadOf([400])).toEqual({ stdevKcal: 0, cvPct: 0 });
  });
});

describe("percentile", () => {
  it("usa el rango más cercano", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 90)).toBe(9);
    expect(percentile(xs, 100)).toBe(10);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([], 90)).toBe(0);
  });
});

describe("summarize", () => {
  it("resume el banco: error absoluto, sesgo con signo y omisiones sobre el total", () => {
    const sinChorizo = lentejasRef.filter((i) => i.id !== "chorizo");
    const perfect = accuracyOf(lentejasRef, lentejasRef);
    const bad = accuracyOf(lentejasRef, sinChorizo);
    const mains = referenceMainCount(lentejasRef);
    const s = summarize([
      { accuracy: perfect, referenceMains: mains, cvPct: 0 },
      { accuracy: bad, referenceMains: mains, cvPct: 10 },
    ]);
    expect(s.dishes).toBe(2);
    expect(s.kcalMeanAbsPct).toBeCloseTo((Math.abs(bad.kcalErr) / 2) * 100, 0);
    expect(s.kcalBiasPct).toBeLessThan(0);
    expect(s.omittedPct).toBeCloseTo((1 / (2 * mains)) * 100, 0);
    expect(s.meanCvPct).toBe(5);
  });
});

describe("ingredientDiff", () => {
  it("ordena por lo que más mueve las kcal e incluye lo que falta y lo que sobra", () => {
    const out = [
      item("lentejas", 200, LENTEJA),
      item(OIL_ID, 20, ACEITE),
      item("zanahoria", 50, ZANAHORIA),
      item("patata", 100, { kcal: 87, p: 2, c: 20, f: 0.1 }),
    ];
    const diff = ingredientDiff(lentejasRef, out);
    expect(diff.map((d) => d.id)).toEqual(["chorizo", "aceite", "patata", "lentejas", "zanahoria"]);
    expect(diff[0]).toMatchObject({ id: "chorizo", refGrams: 30, outGrams: 0 });
    expect(diff[0].kcalDiff).toBeCloseTo(-105, 6);
    expect(diff[1].kcalDiff).toBeCloseTo(88.4, 6);
  });
});

describe("accuracyReason", () => {
  it("nombra la causa dominante", () => {
    const sinChorizo = lentejasRef.filter((i) => i.id !== "chorizo");
    expect(accuracyReason(accuracyOf(lentejasRef, sinChorizo))).toContain("omite chorizo");
    const masAceite = lentejasRef.map((i) => (i.id === OIL_ID ? item(OIL_ID, 30, ACEITE) : i));
    expect(accuracyReason(accuracyOf(lentejasRef, masAceite))).toContain("aceite +20 g");
  });

  it("lo dice cuando no hay una causa clara", () => {
    expect(accuracyReason(accuracyOf(lentejasRef, lentejasRef))).toBe(
      "error repartido, sin una causa dominante",
    );
  });
});
