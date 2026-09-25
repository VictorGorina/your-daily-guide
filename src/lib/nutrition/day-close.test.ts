import { describe, expect, it } from "bun:test";

import { closeDay, serveDay, type DayMeal } from "./day-close";
import type { CanonicalIngredient, CanonicalRecipe } from "./recipe";
import { plannedMacros, type ScaleTarget } from "./scale";

const ing = (foodKey: string, gramsRaw: number, state: "crudo" | "listo" = "crudo") =>
  ({ foodKey, name: foodKey, gramsRaw, state, confidence: "high" }) as CanonicalIngredient;

const recipe = (
  ingredients: CanonicalIngredient[],
  servingKind: CanonicalRecipe["servingKind"] = "plato",
) => ({ ingredients, servingKind });

const tostadas = recipe([ing("pan-integral", 60), ing("aceite-oliva", 5, "listo")]);
const polloArroz = recipe([
  ing("pechuga-pollo", 110),
  ing("arroz-crudo", 70),
  ing("pimiento", 150),
  ing("aceite-oliva", 10, "listo"),
]);
const merluzaPatata = recipe([
  ing("merluza", 120),
  ing("patata", 150),
  ing("aceite-oliva", 10, "listo"),
]);
/** La merienda de una sola fruta del eval: todo verdura/fruta, no se escala. */
const naranja = recipe([ing("naranja", 150)]);

/** Mujer que pierde (~1.330 kcal), el reparto de `energyTargets().perSlot`. */
const GOALS: Record<string, ScaleTarget> = {
  desayuno: { kcal: 333, protein_g: 20 },
  comida: { kcal: 466, protein_g: 35 },
  merienda: { kcal: 133, protein_g: 8 },
  cena: { kcal: 399, protein_g: 30 },
};
const dayGoal = Object.values(GOALS).reduce((s, g) => s + g.kcal, 0);

const own = (r: DayMeal["recipe"], slot: string, base = 0.7): DayMeal => ({
  recipe: r,
  serving: { base, target: GOALS[slot]! },
  goal: GOALS[slot]!,
  shared: false,
});

const soloDay = (): DayMeal[] => [
  own(tostadas, "desayuno"),
  own(polloArroz, "comida"),
  own(naranja, "merienda"),
  own(merluzaPatata, "cena"),
];

const unclosedKcal = (meals: DayMeal[]) =>
  meals.reduce((s, m) => s + (m.recipe ? plannedMacros(m.recipe, m.serving).macros.kcal : 0), 0);

describe("closeDay (alignSoloMeals, ticket 08)", () => {
  it("la merienda de una fruta no llega; el hueco lo absorben las demás comidas", () => {
    const day = soloDay();
    const before = unclosedKcal(day) - dayGoal;
    const { total, closed } = serveDay(day);
    expect(before).toBeLessThan(-40);
    expect(Math.abs(total.kcal - dayGoal)).toBeLessThanOrEqual(dayGoal * 0.02);
    expect(Math.abs(closed.residual.kcal)).toBeLessThan(Math.abs(before));
    // La fruta no se toca y las comidas escalables suben.
    expect(closed.targets[2]).toEqual(GOALS.merienda!);
    expect(closed.targets[1]!.kcal).toBeGreaterThan(GOALS.comida!.kcal);
    expect(closed.targets[3]!.kcal).toBeGreaterThan(GOALS.cena!.kcal);
  });

  it("reparte en proporción al objetivo de cada comida", () => {
    const { closed } = serveDay(soloDay());
    const up = (i: number, slot: string) => closed.targets[i]!.kcal - GOALS[slot]!.kcal;
    // La comida (466) absorbe más que el desayuno (333).
    expect(up(1, "comida")).toBeGreaterThan(up(0, "desayuno"));
  });

  it("es determinista", () => {
    expect(closeDay(soloDay())).toEqual(closeDay(soloDay()));
  });

  it("un día que ya cuadra no se toca", () => {
    // Comida y cena llegan cada una a su objetivo (el desayuno de tostadas no:
    // a esta ración su pan no pasa de ~270 kcal).
    const day = [own(polloArroz, "comida"), own(merluzaPatata, "cena")];
    expect(closeDay(day).targets).toEqual([GOALS.comida!, GOALS.cena!]);
  });

  it("una compartida se sirve a la ración del hogar, pero cuenta con el objetivo propio", () => {
    // Comida compartida servida a la media del hogar (700), y esta persona
    // tiene 466 para esa comida: sus comidas propias tienen que bajar.
    const day = soloDay();
    day[1] = {
      recipe: polloArroz,
      serving: { base: 0.85, target: { kcal: 700, protein_g: 45 } },
      goal: GOALS.comida!,
      shared: true,
    };
    const { closed, meals } = serveDay(day);
    expect(closed.targets[1]).toEqual({ kcal: 700, protein_g: 45 });
    expect(meals[1]!.kcal).toBeGreaterThan(650);
    expect(closed.targets[0]!.kcal).toBeLessThan(GOALS.desayuno!.kcal);
    expect(closed.targets[3]!.kcal).toBeLessThan(GOALS.cena!.kcal);
  });

  it("todo compartido: no hay dónde corregir, queda el residuo y no hay bucle", () => {
    const day = soloDay().map((m) => ({ ...m, shared: true }));
    const { targets, residual } = closeDay(day);
    targets.forEach((t, i) => expect(t).toEqual(day[i]!.serving.target));
    expect(residual.kcal).toBeLessThan(0);
  });

  it("una pieza cuenta pero no absorbe", () => {
    const pizza = recipe([ing("arroz-crudo", 100)], "unidad");
    const day = soloDay();
    day[3] = own(pizza, "cena");
    const { targets } = closeDay(day);
    expect(targets[3]).toEqual(GOALS.cena!);
  });

  it("un plato sin receta (calculando) ni cuenta ni absorbe", () => {
    const day = soloDay();
    day[3] = own(null, "cena");
    const { targets, residual } = closeDay(day);
    expect(targets[3]).toEqual(GOALS.cena!);
    // El residuo es sobre las tres que cuentan, no contra un día de cuatro.
    expect(Math.abs(residual.kcal)).toBeLessThan(GOALS.cena!.kcal / 2);
  });

  it("sin objetivo (menor, faltan datos) no reparte nada", () => {
    const day = soloDay().map((m) => ({
      ...m,
      serving: { ...m.serving, target: null },
      goal: null,
    }));
    const { targets, residual } = closeDay(day);
    expect(targets).toEqual([null, null, null, null]);
    expect(residual).toEqual({ kcal: 0, protein_g: 0 });
  });

  it("una comida que toca su límite pasa lo que no cabe a las demás", () => {
    // El desayuno de tostadas ya está en su tope: la comida y la cena se llevan
    // todo el hueco de la naranja.
    const { closed } = serveDay(soloDay());
    expect(closed.targets[0]!.kcal).toBeLessThan(GOALS.desayuno!.kcal);
    expect(closed.targets[1]!.kcal - GOALS.comida!.kcal).toBeGreaterThan(80);
  });

  it("si todas tocan su límite, queda el residuo: sin bucles ni objetivos inflados", () => {
    const day = soloDay();
    day[2] = { ...own(naranja, "merienda"), goal: { kcal: 600, protein_g: 20 } };
    const { total, closed, meals } = serveDay(day);
    expect(total.kcal).toBeGreaterThan(unclosedKcal(soloDay()) + 150);
    expect(closed.residual.kcal).toBeLessThan(-300);
    // Cada comida saturada se sirve a lo que dice su objetivo, no a uno inventado.
    for (const i of [0, 1, 3]) {
      expect(Math.abs(meals[i]!.kcal - closed.targets[i]!.kcal)).toBeLessThanOrEqual(
        closed.targets[i]!.kcal * 0.03,
      );
    }
  });
});
