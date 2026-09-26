import { describe, expect, it } from "bun:test";

import { CHEAT_DAY_DISH, concreteDish, concretizePlan } from "./plan-concrete-dish";
import type { MonthlyPlan, PlanDay } from "./plan-shared";

// ---------------------------------------------------------------------------
// concreteDish — un plato dice qué se come, nunca dónde
// ---------------------------------------------------------------------------

describe("concreteDish", () => {
  it("el caso del eval: quita el 'fuera de casa' y el 'o similar' y deja el plato", () => {
    // eval:plan-lite, 2026-09-26, "ganar", 2026-10-04 (domingo).
    expect(concreteDish("Comida fuera de casa: Paella o similar · Ensalada · Fruta")).toEqual({
      kind: "ok",
      dish: "Paella · Ensalada · Fruta",
    });
  });

  it("quita el sitio al final, entre paréntesis y el 'menú del día:' delante", () => {
    expect(concreteDish("Paella de marisco en un restaurante")).toEqual({
      kind: "ok",
      dish: "Paella de marisco",
    });
    expect(concreteDish("Pechuga con arroz (comes fuera) · Yogur")).toEqual({
      kind: "ok",
      dish: "Pechuga con arroz · Yogur",
    });
    expect(concreteDish("Menú del día: lentejas estofadas · pan")).toEqual({
      kind: "ok",
      dish: "Lentejas estofadas · pan",
    });
    expect(concreteDish("Merluza a la plancha u otro pescado similar")).toEqual({
      kind: "ok",
      dish: "Merluza a la plancha u otro pescado similar",
    });
  });

  it("sin nada concreto que comer es genérico", () => {
    for (const text of [
      "Comer fuera",
      "Comida fuera de casa",
      "Menú del día",
      "Restaurante",
      "Cena fuera · Fruta",
      "Comida fuera de casa: lo que te apetezca",
      "Menú del día en el bar de la oficina",
    ]) {
      expect(concreteDish(text)).toEqual({ kind: "generic" });
    }
  });

  it("no confunde un plato de verdad con comer fuera", () => {
    // Por palabra entera: "barrita", "fueraborda" o "terrina" no son un sitio;
    // "lentejas o garbanzos" no es un "o similar".
    for (const text of [
      "Barrita de avena · Yogur",
      "Lentejas o garbanzos con verduras",
      "Ensalada de pasta con atún en tupper",
      "Bocadillo de tortilla para llevar",
      "Pollo al horno con patatas · Fruta de temporada",
    ]) {
      expect(concreteDish(text)).toEqual({ kind: "ok", dish: text });
    }
  });

  it("el cheat day se acepta, y si además dice dónde queda en su forma aceptada", () => {
    expect(concreteDish(CHEAT_DAY_DISH)).toEqual({ kind: "cheat", dish: CHEAT_DAY_DISH });
    expect(concreteDish("Cheat day: hamburguesa casera")).toEqual({
      kind: "cheat",
      dish: "Cheat day: hamburguesa casera",
    });
    expect(concreteDish("Comida libre fuera de casa")).toEqual({
      kind: "cheat",
      dish: CHEAT_DAY_DISH,
    });
  });
});

// ---------------------------------------------------------------------------
// concretizePlan — la red sobre el plan recién generado
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const week = (days: Partial<PlanDay>[]) => ({
  label: "Semana",
  focus: "",
  breakfasts: ["Tostada con tomate · Café con leche", "Yogur con avena"],
  snacks: ["Fruta · Queso fresco", "Frutos secos · Yogur"],
  days: DAY_NAMES.map((day, i) => ({
    day,
    lunch: `Comida ${i + 1}`,
    dinner: `Cena ${i + 1}`,
    ...days[i],
  })),
});

const plan = (weeks: ReturnType<typeof week>[]): MonthlyPlan => ({ intro: "", focus: [], weeks });

describe("concretizePlan", () => {
  it("reescribe el plato envuelto y cambia el genérico por uno de la misma semana, no del día de al lado", () => {
    const { plan: out, report } = concretizePlan(
      plan([
        week([
          {},
          {},
          {},
          {},
          {},
          { dinner: "Comer fuera" },
          { lunch: "Comida fuera de casa: Paella o similar · Ensalada" },
        ]),
      ]),
    );
    const days = out.weeks[0]!.days;
    expect(days[6]!.lunch).toBe("Paella · Ensalada");
    // Sábado (índice 5): el viernes y el domingo están al lado; el más cercano
    // que no lo está es el jueves.
    expect(days[5]!.dinner).toBe("Cena 4");
    expect(report).toEqual({ rewritten: 1, replaced: 1, unresolved: 0 });
  });

  it("un cheat day por semana; el segundo se cambia por un plato concreto", () => {
    const { plan: out } = concretizePlan(
      plan([week([{}, {}, {}, {}, {}, { dinner: CHEAT_DAY_DISH }, { lunch: CHEAT_DAY_DISH }])]),
    );
    const days = out.weeks[0]!.days;
    expect(days[5]!.dinner).toBe(CHEAT_DAY_DISH);
    expect(days[6]!.lunch).toBe("Comida 5");
  });

  it("si la semana no tiene con qué, usa el mismo día de otra semana", () => {
    const allOut = Array.from({ length: 7 }, () => ({ lunch: "Comer fuera" }));
    const { plan: out, report } = concretizePlan(plan([week(allOut), week([])]));
    expect(out.weeks[0]!.days[2]!.lunch).toBe("Comida 3");
    expect(report.replaced).toBe(7);
  });

  it("nunca toca una comida fijada a mano ni una vacía (comida no planificada)", () => {
    const { plan: out, report } = concretizePlan(
      plan([week([{ lunch: "Comida fuera con amigos", pinned: ["comida"] }, { dinner: "" }])]),
    );
    expect(out.weeks[0]!.days[0]!.lunch).toBe("Comida fuera con amigos");
    expect(out.weeks[0]!.days[1]!.dinner).toBe("");
    expect(report).toEqual({ rewritten: 0, replaced: 0, unresolved: 0 });
  });

  it("un desayuno genérico del día se quita (manda la rotación) y la idea semanal genérica sale de la lista", () => {
    const w = week([{ breakfast: "Desayuno en la cafetería" }]);
    w.breakfasts = ["Desayuno fuera", "Yogur con avena"];
    const { plan: out } = concretizePlan(plan([w]));
    expect(out.weeks[0]!.days[0]!.breakfast).toBeUndefined();
    expect(out.weeks[0]!.breakfasts).toEqual(["Yogur con avena"]);
  });

  it("no muta el plan de entrada", () => {
    const input = plan([week([{ lunch: "Comer fuera" }])]);
    concretizePlan(input);
    expect(input.weeks[0]!.days[0]!.lunch).toBe("Comer fuera");
  });
});
