import { describe, expect, it } from "bun:test";

import { goalProgress, normalizeGoalType } from "./daily";
import { chipToValue, PROFILE_SECTIONS, valueToChip } from "./profile-fields";

// ---------------------------------------------------------------------------
// normalizeGoalType — absorbe etiquetas UI que se guardaron por error en BD
// ---------------------------------------------------------------------------

describe("normalizeGoalType", () => {
  it("mapea las etiquetas UI de los chips a valores internos", () => {
    expect(normalizeGoalType("perder peso")).toBe("perder");
    expect(normalizeGoalType("Perder peso")).toBe("perder");
    expect(normalizeGoalType("ganar músculo")).toBe("ganar");
    expect(normalizeGoalType("Ganar")).toBe("ganar");
    expect(normalizeGoalType("salud")).toBe("habitos");
  });

  it("deja pasar los valores internos correctos sin cambios", () => {
    expect(normalizeGoalType("perder")).toBe("perder");
    expect(normalizeGoalType("ganar")).toBe("ganar");
    expect(normalizeGoalType("mantener")).toBe("mantener");
    expect(normalizeGoalType("habitos")).toBe("habitos");
    expect(normalizeGoalType("energia")).toBe("energia");
  });
});

// ---------------------------------------------------------------------------
// goalProgress — cálculo del progreso de peso
// ---------------------------------------------------------------------------

describe("goalProgress", () => {
  const base = { goal_type: "perder", goal_amount: 10, start_weight_kg: 100 };

  it("devuelve 0% si el usuario sube de peso con objetivo perder", () => {
    const r = goalProgress({ ...base, current_weight_kg: 110 } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(0);
  });

  it("devuelve 100% si el usuario pierde justo lo marcado", () => {
    const r = goalProgress({ ...base, current_weight_kg: 90 } as never);
    expect(r.pct).toBe(1);
    expect(r.done).toBe(10);
  });

  it("muestra progreso parcial (50%)", () => {
    const r = goalProgress({ ...base, current_weight_kg: 95 } as never);
    expect(r.pct).toBeCloseTo(0.5);
    expect(r.done).toBeCloseTo(5);
  });

  it("clampea a 100% si se supera el objetivo", () => {
    const r = goalProgress({ ...base, current_weight_kg: 85 } as never);
    expect(r.pct).toBe(1);
  });

  it('funciona con goal_type="perder peso" (bug legacy)', () => {
    const r = goalProgress({
      goal_type: "perder peso",
      goal_amount: 10,
      start_weight_kg: 100,
      current_weight_kg: 110,
    } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(0);
  });

  it('funciona con goal_type="ganar músculo" (bug legacy)', () => {
    const r = goalProgress({
      goal_type: "ganar músculo",
      goal_amount: 5,
      start_weight_kg: 70,
      current_weight_kg: 65,
    } as never);
    // Perdió peso → 0%
    expect(r.pct).toBe(0);
    expect(r.done).toBe(0);
  });

  it("ganar 10 kg: subir es progreso", () => {
    const r = goalProgress({
      goal_type: "ganar",
      goal_amount: 10,
      start_weight_kg: 60,
      current_weight_kg: 70,
    } as never);
    expect(r.pct).toBe(1);
    expect(r.done).toBe(10);
  });

  it("mantener: drift 0 es 100%", () => {
    const r = goalProgress({
      goal_type: "mantener",
      start_weight_kg: 70,
      current_weight_kg: 70,
    } as never);
    expect(r.pct).toBe(1);
  });

  it("sin perfil devuelve ceros", () => {
    expect(goalProgress(null)).toEqual({ pct: 0, done: 0, total: 0, unit: "kg" });
  });
});

// ---------------------------------------------------------------------------
// chipToValue / valueToChip — mapeo etiqueta ↔ valor interno
// ---------------------------------------------------------------------------

describe("chipToValue / valueToChip", () => {
  const goalField = PROFILE_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === "goal_type")!;

  it("convierte etiqueta UI a valor interno", () => {
    expect(chipToValue(goalField, "perder peso")).toBe("perder");
    expect(chipToValue(goalField, "ganar músculo")).toBe("ganar");
    expect(chipToValue(goalField, "salud")).toBe("habitos");
    expect(chipToValue(goalField, "mantener")).toBe("mantener");
  });

  it("convierte valor interno a etiqueta UI", () => {
    expect(valueToChip(goalField, "perder")).toBe("perder peso");
    expect(valueToChip(goalField, "ganar")).toBe("ganar músculo");
    expect(valueToChip(goalField, "habitos")).toBe("salud");
    expect(valueToChip(goalField, "mantener")).toBe("mantener");
  });

  it("pasa valores sin mapa como identity", () => {
    const noMap = { key: "tone" as const, label: "Tono", kind: "chips" as const, options: ["a"] };
    expect(chipToValue(noMap, "a")).toBe("a");
    expect(valueToChip(noMap, "a")).toBe("a");
  });
});
