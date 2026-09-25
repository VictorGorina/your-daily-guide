import { describe, expect, it } from "bun:test";

import { foodByKey } from "./nutrition";
import { macrosOfRecipe, type CanonicalIngredient, type CanonicalRecipe } from "./recipe";
import {
  eatenMacros,
  foodGroup,
  macrosOfScaled,
  plannedMacros,
  scaledIngredients,
  scaleRecipe,
  SCALE_LIMITS,
} from "./scale";

const ing = (foodKey: string, gramsRaw: number, state: "crudo" | "listo" = "crudo") =>
  ({ foodKey, name: foodKey, gramsRaw, state, confidence: "high" }) as CanonicalIngredient;

const recipe = (
  ingredients: CanonicalIngredient[],
  servingKind: CanonicalRecipe["servingKind"] = "plato",
) => ({ ingredients, servingKind });

/** "Pollo con arroz y verduras" a la ración base de AESAN (≈ 515 kcal). */
const polloArroz = recipe([
  ing("pechuga-pollo", 110),
  ing("arroz-crudo", 70),
  ing("pimiento", 150),
  ing("aceite-oliva", 10, "listo"),
]);

/** "Lentejas estofadas": sin grupo P (la legumbre es energía, 28 % de proteína). */
const lentejas = recipe([
  ing("lentejas-secas", 60),
  ing("cebolla", 80),
  ing("aceite-oliva", 10, "listo"),
]);

const within = (value: number, target: number, share: number) =>
  Math.abs(value - target) <= target * share;

const gramsOf = (list: CanonicalIngredient[], key: string) =>
  list.find((i) => i.foodKey === key)!.gramsRaw;

describe("foodGroup", () => {
  it.each([
    ["pechuga-pollo", "P"],
    ["huevo", "P"],
    ["merluza", "P"],
    ["lentejas-secas", "E"],
    ["arroz-crudo", "E"],
    ["leche-semi", "E"],
    ["aceite-oliva", "E"],
    ["pimiento", "V"],
    ["naranja", "V"],
    ["platano", "V"],
    ["aguacate", "E"],
    ["pasas", "E"],
    ["caldo", "V"],
  ])("%s → %s", (key, group) => {
    expect(foodGroup(foodByKey(key)!)).toBe(group as never);
  });
});

describe("scaleRecipe (ticket 08)", () => {
  it("sube a 850 kcal y 45 g de proteína sin tocar la verdura", () => {
    const s = scaleRecipe(polloArroz, { kcal: 850, protein_g: 45 }, 1)!;
    expect(within(s.macros.kcal, 850, 0.03)).toBe(true);
    expect(within(s.macros.protein_g, 45, 0.1)).toBe(true);
    const scaled = scaledIngredients(polloArroz, s.factors);
    expect(gramsOf(scaled, "pimiento")).toBe(150);
    expect(gramsOf(scaled, "arroz-crudo")).toBeGreaterThan(70);
  });

  it("baja a 400 kcal sin tocar la verdura", () => {
    const s = scaleRecipe(polloArroz, { kcal: 400, protein_g: 30 }, 1)!;
    expect(within(s.macros.kcal, 400, 0.03)).toBe(true);
    expect(gramsOf(scaledIngredients(polloArroz, s.factors), "pimiento")).toBe(150);
  });

  it("la ración personal es el punto de partida: la verdura va a la ración personal", () => {
    const s = scaleRecipe(polloArroz, { kcal: 600, protein_g: 35 }, 0.7)!;
    expect(within(s.macros.kcal, 600, 0.03)).toBe(true);
    // Mismas macros que la receta con los gramos escalados × la ración personal.
    expect(s.macros).toEqual(macrosOfScaled(polloArroz, 0.7, s.factors));
  });

  it("las cifras que devuelve son las de los factores redondeados", () => {
    const s = scaleRecipe(polloArroz, { kcal: 733, protein_g: 41 }, 1.13)!;
    expect(s.macros).toEqual(macrosOfScaled(polloArroz, 1.13, s.factors));
    expect(s.residual.kcal).toBe(s.macros.kcal - 733);
  });

  it("respeta los límites y deja el resto como residuo, sin deformar el plato", () => {
    const s = scaleRecipe(polloArroz, { kcal: 2500, protein_g: 150 }, 1)!;
    expect(s.factors.fE).toBeLessThanOrEqual(SCALE_LIMITS.fE[1]);
    expect(s.factors.fP).toBeLessThanOrEqual(SCALE_LIMITS.fP[1]);
    expect(s.residual.kcal).toBeLessThan(0);
    const low = scaleRecipe(polloArroz, { kcal: 50, protein_g: 5 }, 1)!;
    expect(low.factors.fE).toBeGreaterThanOrEqual(SCALE_LIMITS.fE[0]);
    expect(low.factors.fP).toBeGreaterThanOrEqual(SCALE_LIMITS.fP[0]);
    expect(low.residual.kcal).toBeGreaterThan(0);
  });

  it("nunca pasa de la proporción fP / fE permitida", () => {
    for (const protein_g of [5, 30, 60, 120]) {
      const { factors } = scaleRecipe(polloArroz, { kcal: 700, protein_g }, 1)!;
      const ratio = factors.fP / factors.fE;
      expect(ratio).toBeGreaterThanOrEqual(SCALE_LIMITS.ratio[0] - 0.01);
      expect(ratio).toBeLessThanOrEqual(SCALE_LIMITS.ratio[1] + 0.01);
    }
  });

  it("a igual kcal, más proteína pedida sube el grupo P", () => {
    const low = scaleRecipe(polloArroz, { kcal: 700, protein_g: 30 }, 1)!;
    const high = scaleRecipe(polloArroz, { kcal: 700, protein_g: 55 }, 1)!;
    expect(high.factors.fP).toBeGreaterThan(low.factors.fP);
    expect(high.macros.protein_g).toBeGreaterThan(low.macros.protein_g);
    expect(within(high.macros.kcal, 700, 0.03)).toBe(true);
  });

  it("sin grupo P, escala solo la energía y acierta las kcal", () => {
    const s = scaleRecipe(lentejas, { kcal: 500, protein_g: 40 }, 1)!;
    expect(s.factors.fP).toBe(1);
    expect(within(s.macros.kcal, 500, 0.03)).toBe(true);
    expect(gramsOf(scaledIngredients(lentejas, s.factors), "cebolla")).toBe(80);
  });

  it("un plato solo de verdura y fruta se queda como está", () => {
    const fruta = recipe([ing("naranja", 150, "listo")]);
    const s = scaleRecipe(fruta, { kcal: 300, protein_g: 10 }, 1)!;
    expect(s.factors).toEqual({ fP: 1, fE: 1 });
    expect(s.macros).toEqual(macrosOfRecipe(fruta, 1));
  });

  it("una fila que no existe no se escala a medias", () => {
    expect(scaleRecipe(recipe([ing("no-existe", 100)]), { kcal: 500, protein_g: 20 }, 1)).toBe(
      null,
    );
  });
});

describe("plannedMacros", () => {
  it("con objetivo, escala al de la comida y el factor efectivo lo refleja", () => {
    const { macros, portion } = plannedMacros(polloArroz, {
      base: 1,
      target: { kcal: 800, protein_g: 45 },
    });
    expect(within(macros.kcal, 800, 0.03)).toBe(true);
    const baseKcal = macrosOfRecipe(polloArroz, 1).kcal;
    expect(portion).toBe(Math.round((macros.kcal / baseKcal) * 100) / 100);
  });

  it("sin objetivo, la ración personal tal cual", () => {
    expect(plannedMacros(polloArroz, { base: 1.25, target: null })).toEqual({
      macros: macrosOfRecipe(polloArroz, 1.25),
      portion: 1.25,
    });
  });

  it("una pieza del plan se sirve en unidades enteras, las más cercanas al objetivo", () => {
    const tostada = recipe([ing("pan-integral", 50), ing("aguacate", 60)], "unidad");
    const unit = macrosOfRecipe(tostada, 1).kcal;
    const at = (kcal: number) =>
      plannedMacros(tostada, { base: 0.7, target: { kcal, protein_g: 20 } });
    expect(at(unit * 2.2)).toEqual({ macros: macrosOfRecipe(tostada, 2), portion: 2 });
    expect(at(unit * 2.6).portion).toBe(3);
    // Nunca menos de una, por pequeño que sea el objetivo.
    expect(at(unit * 0.3)).toEqual({ macros: macrosOfRecipe(tostada, 1), portion: 1 });
  });

  it("una pieza sin objetivo, la ración personal tal cual", () => {
    const pizza = recipe([ing("arroz-crudo", 100)], "unidad");
    expect(plannedMacros(pizza, { base: 0.8, target: null })).toEqual({
      macros: macrosOfRecipe(pizza, 0.8),
      portion: 0.8,
    });
  });
});

describe("eatenMacros (comí distinto)", () => {
  const plan = { base: 1, target: { kcal: 800, protein_g: 45 } };

  it("mantener: el mismo plato comido con el chip normal mide lo mismo que el del plan", () => {
    // Quien mantiene tiene la ración habitual igual a la del plan y el mismo objetivo.
    const eaten = eatenMacros(polloArroz, { serving: plan, textQuantity: null, size: "normal" });
    expect(eaten.macros).toEqual(plannedMacros(polloArroz, plan).macros);
  });

  it("perder: a mantenimiento, el plato comido es MAYOR que el del plan, no menor", () => {
    const planned = plannedMacros(polloArroz, { base: 0.66, target: { kcal: 460, protein_g: 30 } });
    const eaten = eatenMacros(polloArroz, {
      serving: { base: 0.79, target: { kcal: 550, protein_g: 30 } },
      textQuantity: null,
    });
    expect(eaten.macros.kcal).toBeGreaterThan(planned.macros.kcal);
    expect(within(eaten.macros.kcal, 550, 0.03)).toBe(true);
  });

  it("el chip y la cantidad del texto multiplican el plato ya escalado", () => {
    const normal = eatenMacros(polloArroz, { serving: plan, textQuantity: null }).macros.kcal;
    const big = eatenMacros(polloArroz, { serving: plan, textQuantity: null, size: "grande" });
    expect(within(big.macros.kcal, normal * 1.3, 0.02)).toBe(true);
    const two = eatenMacros(polloArroz, { serving: plan, textQuantity: 2, size: "pequena" });
    expect(within(two.macros.kcal, normal * 2, 0.02)).toBe(true);
  });

  it("una pieza es una pieza: ni ración habitual ni objetivo", () => {
    const pizza = recipe([ing("arroz-crudo", 100)], "unidad");
    const half = eatenMacros(pizza, { serving: plan, textQuantity: 0.5 });
    expect(half).toEqual({ macros: macrosOfRecipe(pizza, 0.5), portion: 0.5 });
  });
});
