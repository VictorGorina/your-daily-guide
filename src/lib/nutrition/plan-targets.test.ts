import { describe, expect, it } from "bun:test";

import { energyTargets } from "./energy";
import { planTargetsPrompt } from "./plan-targets";

const person = (over: Record<string, unknown> = {}) =>
  energyTargets({
    sex: "Mujer",
    age: 32,
    height_cm: 165,
    current_weight_kg: 62,
    target_weight_kg: 58,
    activity_level: "sedentario",
    ...over,
  } as never);

describe("planTargetsPrompt (ticket 23)", () => {
  it("lleva el objetivo de cada comida y la estructura con « · »", () => {
    const text = planTargetsPrompt({ targets: person() });
    expect(text).toMatch(/OBJETIVO POR COMIDA/);
    expect(text).toMatch(/comida ~\d+ kcal y \d+ g de proteína/);
    expect(text).toContain("plato principal · acompañamiento");
    expect(text).toContain("Lentejas estofadas con verduras · pan integral · naranja");
  });

  it("perder peso pide volumen y cenas ligeras; ganar, meriendas contundentes", () => {
    expect(planTargetsPrompt({ targets: person() })).toMatch(/perder peso/);
    const gainer = person({
      sex: "Hombre",
      current_weight_kg: 60,
      target_weight_kg: 70,
      height_cm: 180,
    });
    expect(planTargetsPrompt({ targets: gainer })).toMatch(/meriendas contundentes/);
  });

  it("una comida grande pide primer y segundo plato", () => {
    const big = person({
      sex: "Hombre",
      age: 24,
      height_cm: 190,
      current_weight_kg: 90,
      target_weight_kg: 95,
      activity_level: "muy activo",
    });
    expect(planTargetsPrompt({ targets: big })).toMatch(/primer plato · segundo plato/);
  });

  it("sin datos para el objetivo, la estructura igual (y ninguna cifra)", () => {
    const text = planTargetsPrompt({ targets: null });
    expect(text).not.toMatch(/kcal/);
    expect(text).toContain("plato principal · acompañamiento");
  });

  it("las compartidas del hogar van con la media y sin nombres", () => {
    const text = planTargetsPrompt({
      targets: person(),
      shared: { cena: { kcal: 640, protein_g: 35 } },
    });
    expect(text).toMatch(
      /compartidas con su casa, el objetivo medio de los adultos: cena ~640 kcal/,
    );
  });
});
