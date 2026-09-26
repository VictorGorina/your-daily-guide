import { describe, expect, it } from "bun:test";

import {
  cleanWeeklyIdeas,
  dayScore,
  misfitReasonText,
  planFit,
  type FitDay,
  type FitMeal,
} from "./plan-fit";
import type { CanonicalIngredient, CanonicalRecipe } from "./recipe";
import type { ScaleTarget } from "./scale";

const ing = (foodKey: string, gramsRaw: number, state: "crudo" | "listo" = "crudo") =>
  ({ foodKey, name: foodKey, gramsRaw, state, confidence: "high" }) as CanonicalIngredient;

const recipe = (ingredients: CanonicalIngredient[]) =>
  ({ ingredients, servingKind: "plato" }) as Pick<CanonicalRecipe, "ingredients" | "servingKind">;

const tostadas = recipe([
  ing("pan-integral", 60),
  ing("aceite-oliva", 5, "listo"),
  ing("yogur-griego", 125),
]);
const tostadasSolas = recipe([ing("pan-integral", 60), ing("aceite-oliva", 5, "listo")]);
const yogur = recipe([ing("yogur-natural", 125)]);
const polloArroz = recipe([
  ing("pechuga-pollo", 110),
  ing("arroz-crudo", 70),
  ing("pimiento", 150),
  ing("aceite-oliva", 10, "listo"),
]);
const lentejas = recipe([
  ing("lentejas-secas", 70),
  ing("patata", 80),
  ing("pan-integral", 40),
  ing("aceite-oliva", 10, "listo"),
]);
const merluzaPatata = recipe([
  ing("merluza", 120),
  ing("patata", 150),
  ing("aceite-oliva", 10, "listo"),
]);
/** El caso del eval: pescado blanco con verdura, no llega a una comida de 466. */
const merluzaBrocoli = recipe([ing("merluza", 120), ing("brocoli", 200)]);

/** Mujer que pierde (~1.330 kcal), el reparto de `energyTargets().perSlot`. */
const GOALS: Record<string, ScaleTarget> = {
  desayuno: { kcal: 333, protein_g: 20 },
  comida: { kcal: 466, protein_g: 35 },
  snack: { kcal: 133, protein_g: 8 },
  cena: { kcal: 399, protein_g: 30 },
};

const meal = (
  slot: FitMeal["slot"],
  dish: string,
  r: FitMeal["recipe"],
  opts: { shared?: boolean } = {},
): FitMeal => ({
  slot,
  dish,
  recipe: r,
  serving: { base: 0.67, target: GOALS[slot]! },
  goal: GOALS[slot]!,
  shared: !!opts.shared,
});

const day = (meals: FitMeal[], date = "2026-10-01"): FitDay => ({ date, meals });

const goodDay = () =>
  day([
    meal("desayuno", "Tostadas integrales con aceite · yogur griego", tostadas),
    meal("comida", "Pollo con arroz y pimiento · ensalada · naranja", polloArroz),
    meal("snack", "Yogur natural · nueces", yogur),
    meal("cena", "Merluza con patata · kiwi", merluzaPatata),
  ]);

describe("planFit (ticket 10)", () => {
  it("un día que cierra no pide cambios", () => {
    const fit = planFit([goodDay()]);
    expect(fit.days[0]!.fits).toBe(true);
    expect(fit.misfits).toEqual([]);
    expect(fit.fitPct).toBe(1);
  });

  it("señala la comida que no se deja estirar, no la que tiene margen", () => {
    const d = day([
      meal("desayuno", "Yogur natural · fruta", yogur),
      meal("comida", "Merluza con brócoli · naranja", merluzaBrocoli),
      meal("snack", "Yogur natural · nueces", yogur),
      meal("cena", "Pollo con arroz y pimiento · kiwi", polloArroz),
    ]);
    const fit = planFit([d]);
    expect(fit.days[0]!.fits).toBe(false);
    const kcalMisfits = fit.misfits.filter((m) => m.reasons.includes("corta"));
    expect(kcalMisfits.map((m) => m.slot)[0]).toBe("comida");
    expect(kcalMisfits[0]!.dish).toContain("Merluza");
  });

  it("prefiere una comida propia antes que la compartida (D4)", () => {
    const d = day([
      meal("desayuno", "Yogur natural · fruta", yogur),
      meal("comida", "Merluza con brócoli · naranja", merluzaBrocoli, { shared: true }),
      meal("snack", "Yogur natural · nueces", yogur),
      meal("cena", "Merluza con brócoli · kiwi", merluzaBrocoli),
    ]);
    const kcal = planFit([d], { canTouchShared: true }).misfits.filter((m) =>
      m.reasons.includes("corta"),
    );
    expect(kcal.length).toBeGreaterThan(0);
    expect(kcal.every((m) => !m.shared && m.slot === "cena")).toBe(true);
  });

  it("la compartida solo si no hay propias y quien genera puede tocarla", () => {
    const d = day([
      meal("desayuno", "Yogur natural · fruta", yogur),
      meal("comida", "Merluza con brócoli · naranja", merluzaBrocoli, { shared: true }),
      meal("snack", "Yogur natural · nueces", yogur),
    ]);
    const mains = (fit: ReturnType<typeof planFit>) =>
      fit.misfits.filter((m) => m.slot === "comida" || m.slot === "cena");
    expect(mains(planFit([d]))).toEqual([]);
    const planner = mains(planFit([d], { canTouchShared: true }));
    expect(planner.map((m) => [m.slot, m.shared])).toEqual([["comida", true]]);
  });

  it("un día con un plato sin receta no se mide ni pide cambios (D13)", () => {
    const d = goodDay();
    d.meals[1] = { ...d.meals[1]!, recipe: null };
    const fit = planFit([d]);
    expect(fit.days[0]!.measured).toBe(false);
    expect(fit.misfits).toEqual([]);
    expect(fit.fitPct).toBe(1);
  });

  it("marca la comida principal de un solo componente aunque el día cierre", () => {
    const d = goodDay();
    d.meals[3] = { ...d.meals[3]!, dish: "Merluza con patata" };
    const fit = planFit([d]);
    expect(fit.misfits.map((m) => [m.slot, m.reasons])).toEqual([["cena", ["un-componente"]]]);
    expect(dayScore(d)).toBeGreaterThan(dayScore(goodDay()));
  });

  it("pide proteína cuando el día no llega, también en el desayuno", () => {
    const d = goodDay();
    d.meals[0] = meal("desayuno", "Tostadas integrales con aceite · café", tostadasSolas);
    d.meals[3] = meal("cena", "Lentejas estofadas · pan integral · kiwi", lentejas);
    const fit = planFit([d]);
    expect(fit.days[0]!.fits).toBe(false);
    const protein = fit.misfits.filter((m) => m.reasons.includes("proteina")).map((m) => m.slot);
    expect(protein).toContain("desayuno");
    // Pollo con arroz sí llega a la suya: no se toca.
    expect(protein).not.toContain("comida");
  });

  it("una merienda de solo verdura se cambia cuando falta proteína", () => {
    const d = goodDay();
    d.meals[0] = meal("desayuno", "Tostadas integrales con aceite · café", tostadasSolas);
    d.meals[2] = meal("snack", "Zanahorias baby", recipe([ing("zanahoria", 100)]));
    const fit = planFit([d]);
    expect(fit.misfits.find((m) => m.slot === "snack")?.reasons).toEqual(["proteina"]);
  });

  it("con objetivo de proteína alto, pide proteína en cada principal", () => {
    const d = goodDay();
    d.meals[3] = meal("cena", "Lentejas estofadas · pan integral · kiwi", lentejas);
    const reasons = planFit([d], { highProtein: true, proteinMin: 0 }).misfits.flatMap(
      (m) => m.reasons,
    );
    // Las lentejas a la ración de una mujer de 1.330 no llegan a 25 g.
    expect(reasons).toContain("proteina");
  });

  it("dayScore baja cuando se cambia el plato que no llegaba", () => {
    const bad = day([
      meal("desayuno", "Yogur natural · fruta", yogur),
      meal("comida", "Merluza con brócoli · naranja", merluzaBrocoli),
      meal("snack", "Yogur natural · nueces", yogur),
      meal("cena", "Merluza con brócoli · kiwi", merluzaBrocoli),
    ]);
    const fixed = { ...bad, meals: [...bad.meals] };
    fixed.meals[1] = meal("comida", "Pollo con arroz y pimiento · naranja", polloArroz);
    expect(dayScore(fixed)).toBeLessThan(dayScore(bad));
  });

  it("el motivo se lee con las cifras", () => {
    const text = misfitReasonText({
      date: "2026-10-01",
      slot: "comida",
      dish: "Merluza con brócoli",
      shared: false,
      reasons: ["corta", "un-componente"],
      kcalServed: 272,
      kcalGoal: 465,
      proteinGoal: 35,
    });
    expect(text).toBe(
      "se queda corta aun escalada: 272 kcal para 465; es un solo plato, sin acompañamiento ni postre",
    );
  });

  it("las ideas semanales vuelven en base 0 y solo las pedidas", () => {
    const allowed = new Set(["0|snack|1", "2|desayuno|0"]);
    const ideas = cleanWeeklyIdeas(
      {
        ideas: [
          { semana: 1, comida: "Merienda", opcion: 2, plato: "Queso fresco · tomate" },
          { semana: 3, comida: "desayuno", opcion: 1, plato: " Yogur griego · avena " },
          { semana: 2, comida: "merienda", opcion: 1, plato: "No pedida" },
          { semana: 1, comida: "cena", opcion: 1, plato: "Otra comida" },
        ],
      },
      allowed,
    );
    expect(ideas).toEqual([
      { week: 0, option: 1, slot: "snack", dish: "Queso fresco · tomate" },
      { week: 2, option: 0, slot: "desayuno", dish: "Yogur griego · avena" },
    ]);
    expect(cleanWeeklyIdeas({}, allowed)).toEqual([]);
  });
});
