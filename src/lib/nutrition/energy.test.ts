import { describe, expect, it } from "bun:test";

import {
  caloriesText,
  energyExplanation,
  energyTargets,
  normalizeActivity,
  PAL,
  type EnergyProfile,
} from "./energy";
import {
  exerciseNetKcal,
  formatTraining,
  parseTraining,
  routineDailyKcal,
} from "./exercise-energy";

// Ejemplos del ticket 07 de `precision-nutricional`, calculados a mano.

const woman35: EnergyProfile = {
  sex: "mujer",
  age: 35,
  height_cm: 165,
  current_weight_kg: 70,
  target_weight_kg: 62,
  daily_activity: "sentado",
  training: "3 × 45 min · Gimnasio / pesas · Normal",
};

describe("energyTargets — ejemplos del ticket", () => {
  it("1. mujer 35 años, sentada, 3 × 45 min de gimnasio, quiere perder", () => {
    const t = energyTargets(woman35)!;
    expect(t.basis.bmr).toBe(1395); // 700 + 1031,25 − 175 − 161
    expect(t.basis.routineKcal).toBe(90); // 3 × (4,0 × 70 × 0,75) / 7
    expect(t.basis.tdee).toBe(1764); // 1395 × 1,2 + 90
    expect(t.kcal).toBe(1411); // −20 % (déficit 353 < 500), por encima del suelo 1395
    // 1,6 g/kg × 70 = 112 g, pero el tope del 30 % de las kcal (1411 × 0,3 / 4 =
    // 105,8) manda: el ejemplo del ticket no aplicaba ese tope.
    expect(t.protein_g).toBe(106);
    expect(t.basis.legacyActivity).toBe(false);
  });

  it("2. hombre 40 años, `ligero` antiguo, sin rutina, mantener", () => {
    const t = energyTargets({
      sex: "hombre",
      age: 40,
      height_cm: 180,
      current_weight_kg: 85,
      target_weight_kg: 85,
      activity_level: "ligero",
    })!;
    expect(t.basis.bmr).toBe(1780);
    expect(t.basis.pal).toBe(1.375);
    expect(t.basis.legacyActivity).toBe(true);
    expect(t.kcal).toBe(2448);
    expect(t.protein_g).toBe(102);
    expect(t.fat_g).toBe(82);
    expect(t.fiber_g).toBe(34);
    expect(t.carbs_g).toBe(326);
  });

  it("3. suelo: una mujer de 60 años que quiere perder no baja de su basal ni de 1200", () => {
    const t = energyTargets({
      sex: "mujer",
      age: 60,
      height_cm: 155,
      current_weight_kg: 58,
      target_weight_kg: 52,
      daily_activity: "sentado",
    })!;
    expect(t.kcal).toBeGreaterThanOrEqual(t.basis.bmr);
    expect(t.kcal).toBe(1200);
  });

  it("4. IMC > 30: la proteína se calcula con el peso de IMC 27", () => {
    const t = energyTargets({
      sex: "hombre",
      age: 45,
      height_cm: 175,
      current_weight_kg: 110,
      target_weight_kg: 110,
      daily_activity: "sentado",
    })!;
    expect(t.basis.refWeightKg).toBe(82.7);
    expect(t.protein_g).toBe(Math.round(1.2 * 82.7));
  });

  it("5. embarazo con objetivo de perder: nunca déficit", () => {
    const t = energyTargets({ ...woman35, pregnancy_status: "embarazada" })!;
    expect(t.kcal).toBe(t.basis.tdee + 300);
    expect(t.basis.goal).toBe("embarazo");
    const l = energyTargets({ ...woman35, pregnancy_status: "lactancia" })!;
    expect(l.kcal).toBe(l.basis.tdee + 400);
  });

  it("6. menor de 18 o sin altura → null (comportamiento de antes)", () => {
    expect(energyTargets({ ...woman35, age: 17 })).toBeNull();
    expect(energyTargets({ ...woman35, height_cm: null })).toBeNull();
    expect(energyTargets({ ...woman35, current_weight_kg: null })).toBeNull();
    expect(energyTargets({ ...woman35, age: null })).toBeNull();
    expect(energyTargets(null)).toBeNull();
  });

  it("ganar: +10 % con tope de +300", () => {
    const t = energyTargets({
      sex: "hombre",
      age: 24,
      height_cm: 180,
      current_weight_kg: 70,
      target_weight_kg: 78,
      daily_activity: "de_pie",
    })!;
    expect(t.kcal - t.basis.tdee).toBe(Math.min(Math.round(t.basis.tdee * 0.1), 300));
  });
});

describe("7. normalizeActivity — los valores antiguos nunca caen en «sin dato»", () => {
  it("cada vocabulario antiguo va a su nivel", () => {
    expect(normalizeActivity("sedentario")).toBe("sentado");
    expect(normalizeActivity("ligero")).toBe("de_pie");
    expect(normalizeActivity("activo ligero")).toBe("de_pie");
    expect(normalizeActivity("moderado")).toBe("fisico");
    expect(normalizeActivity("activo")).toBe("fisico");
    expect(normalizeActivity("alto")).toBe("muy_fisico");
    expect(normalizeActivity("muy activo")).toBe("muy_fisico");
  });

  it("los valores presentes en producción (consulta del 2026-09-25) están cubiertos", () => {
    for (const value of ["ligero", "activo", "muy activo", "moderada"]) {
      expect(normalizeActivity(value)).not.toBeNull();
    }
  });

  it("«muy activo» nunca da 1,375", () => {
    expect(PAL[normalizeActivity("muy activo")!]).toBe(1.725);
    expect(PAL[normalizeActivity("Muy Activo")!]).toBe(1.725);
  });

  it("un perfil antiguo sin nada cae en `de_pie`, sin rutina", () => {
    const t = energyTargets({ sex: "mujer", age: 30, height_cm: 160, current_weight_kg: 60 })!;
    expect(t.basis.pal).toBe(1.375);
    expect(t.basis.routineKcal).toBe(0);
  });

  it("un perfil antiguo no suma rutina aunque tenga `training`: su PAL ya la incluía", () => {
    const legacy = energyTargets({ ...woman35, daily_activity: null, activity_level: "activo" })!;
    expect(legacy.basis.routineKcal).toBe(0);
    expect(legacy.basis.legacyActivity).toBe(true);
  });
});

describe("reparto por comida", () => {
  it("se renormaliza sobre las comidas que planifica", () => {
    const t = energyTargets({ ...woman35, meal_slots: ["comida", "cena"] })!;
    expect(Object.keys(t.perSlot).sort()).toEqual(["cena", "comida"]);
    const sum = (t.perSlot.comida?.kcal ?? 0) + (t.perSlot.cena?.kcal ?? 0);
    expect(Math.abs(sum - t.kcal)).toBeLessThanOrEqual(1);
    expect(t.perSlot.comida!.kcal).toBeGreaterThan(t.perSlot.cena!.kcal);
  });
});

describe("rutina de entrenamiento", () => {
  it("gasto neto: (MET − 1) × kg × h", () => {
    expect(exerciseNetKcal("Gimnasio / pesas", 45, "Normal", 70)).toBe(210);
    expect(exerciseNetKcal("Correr", 60, "Normal", 0)).toBe(0);
  });

  it("entiende el texto canónico y el de una persona", () => {
    expect(parseTraining("3 × 45 min · Gimnasio / pesas · Normal")).toEqual({
      sessionsPerWeek: 3,
      minutes: 45,
      activity: "Gimnasio / pesas",
      intensity: "Normal",
    });
    expect(parseTraining("gym 4 días 1 hora intenso")).toMatchObject({
      sessionsPerWeek: 4,
      minutes: 60,
      activity: "Gimnasio / pesas",
      intensity: "Fuerte",
    });
    expect(parseTraining("corro 2 veces por semana 30 min")).toMatchObject({
      sessionsPerWeek: 2,
      minutes: 30,
      activity: "Correr",
    });
    expect(parseTraining("no entreno")).toMatchObject({ sessionsPerWeek: 0 });
    expect(parseTraining("")).toBeNull();
    expect(parseTraining("me gusta el deporte")).toBeNull();
  });

  it("forma canónica ida y vuelta", () => {
    const r = parseTraining("3 × 45 min · Natación · Suave")!;
    expect(parseTraining(formatTraining(r))).toEqual(r);
    expect(routineDailyKcal(r, 70)).toBe(
      Math.round((3 * exerciseNetKcal("Natación", 45, "Suave", 70)) / 7),
    );
  });
});

describe("una sola cifra: texto de la guía y explicación", () => {
  it("rango del objetivo ±7 %, redondeado a 50", () => {
    const t = energyTargets(woman35)!;
    expect(caloriesText(t, true)).toBe("entre 1300 y 1500 kcal");
  });

  it("sin cifras o sin objetivo, ningún número", () => {
    const t = energyTargets(woman35)!;
    expect(caloriesText(t, false)).not.toMatch(/\d/);
    expect(caloriesText(null, true)).not.toMatch(/\d/);
  });

  it("la explicación dice de dónde sale la cifra", () => {
    const text = energyExplanation(energyTargets(woman35)!);
    expect(text).toContain("1764");
    expect(text).toContain("basal 1395");
    expect(text).toContain("rutina 90");
    expect(text).toContain("−20 %");
  });
});
