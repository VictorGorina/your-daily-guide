import { describe, expect, it } from "bun:test";

import { deriveGoalType, goalDirection, goalProgress, normalizeGoalType } from "./goal";
import { compensationNeed } from "./nutrition/compensation";
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
// deriveGoalType — deduce la dirección a partir de peso actual vs objetivo
// ---------------------------------------------------------------------------

describe("deriveGoalType", () => {
  it("devuelve 'perder' cuando current > target + threshold", () => {
    expect(deriveGoalType(85, 75)).toBe("perder");
  });

  it("devuelve 'ganar' cuando current < target − threshold", () => {
    expect(deriveGoalType(65, 75)).toBe("ganar");
  });

  it("devuelve 'mantener' cuando la diferencia está dentro del threshold", () => {
    expect(deriveGoalType(75.5, 75)).toBe("mantener");
    expect(deriveGoalType(74.5, 75)).toBe("mantener");
    expect(deriveGoalType(75, 75)).toBe("mantener");
  });

  it("threshold por defecto es 1 kg — justo en el borde es mantener", () => {
    expect(deriveGoalType(76, 75)).toBe("mantener"); // diff = 1 = threshold
    expect(deriveGoalType(74, 75)).toBe("mantener"); // diff = -1 = -threshold
    expect(deriveGoalType(76.01, 75)).toBe("perder"); // > threshold
    expect(deriveGoalType(73.99, 75)).toBe("ganar"); // < -threshold
  });

  it("acepta threshold personalizado", () => {
    expect(deriveGoalType(77, 75, 2)).toBe("mantener"); // diff=2 = threshold
    expect(deriveGoalType(77.1, 75, 2)).toBe("perder");
    expect(deriveGoalType(72.9, 75, 2)).toBe("ganar");
  });

  it("devuelve null si current o target son null/undefined", () => {
    expect(deriveGoalType(null, 75)).toBeNull();
    expect(deriveGoalType(85, null)).toBeNull();
    expect(deriveGoalType(null, null)).toBeNull();
    expect(deriveGoalType(undefined, 75)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// goalProgress — camino nuevo: target_weight_kg
// ---------------------------------------------------------------------------

describe("goalProgress con target_weight_kg", () => {
  it("perder: 50% de progreso (start=100, target=80, current=90)", () => {
    const r = goalProgress({
      target_weight_kg: 80,
      start_weight_kg: 100,
      current_weight_kg: 90,
    } as never);
    expect(r.measurable).toBe(true);
    expect(r.hasTarget).toBe(true);
    expect(r.targetKg).toBe(80);
    expect(r.pct).toBeCloseTo(0.5);
    expect(r.done).toBeCloseTo(10);
    expect(r.total).toBeCloseTo(20);
    expect(r.distanceKg).toBeCloseTo(10);
    expect(r.regressing).toBe(false);
  });

  it("perder: alcanzado al 100% (current = target)", () => {
    const r = goalProgress({
      target_weight_kg: 80,
      start_weight_kg: 100,
      current_weight_kg: 80,
    } as never);
    expect(r.pct).toBe(1);
    expect(r.distanceKg).toBe(0);
    // distanceKg = 0 → dentro del threshold → "mantener"
    expect(r.regressing).toBe(false);
  });

  it("perder: sobrepasado (current < target) → sigue 100%, no retrocede", () => {
    const r = goalProgress({
      target_weight_kg: 80,
      start_weight_kg: 100,
      current_weight_kg: 78,
    } as never);
    // Está dentro de la zona de mantener (±1 del target)
    expect(r.pct).toBeCloseTo(1, 0);
    expect(r.regressing).toBe(false);
  });

  it("perder: retroceso (current > start)", () => {
    const r = goalProgress({
      target_weight_kg: 80,
      start_weight_kg: 100,
      current_weight_kg: 105,
    } as never);
    expect(r.done).toBe(-5);
    expect(r.regressing).toBe(true);
    expect(r.pct).toBe(0);
  });

  it("ganar: progreso parcial (start=60, target=70, current=65)", () => {
    const r = goalProgress({
      target_weight_kg: 70,
      start_weight_kg: 60,
      current_weight_kg: 65,
    } as never);
    expect(r.pct).toBeCloseTo(0.5);
    expect(r.done).toBeCloseTo(5);
    expect(r.total).toBeCloseTo(10);
    expect(r.regressing).toBe(false);
  });

  it("ganar: retroceso (bajó en vez de subir)", () => {
    const r = goalProgress({
      target_weight_kg: 70,
      start_weight_kg: 60,
      current_weight_kg: 55,
    } as never);
    expect(r.done).toBe(-5);
    expect(r.regressing).toBe(true);
  });

  it("mantener: en la zona de estabilidad (±1 kg)", () => {
    const r = goalProgress({
      target_weight_kg: 75,
      start_weight_kg: 75,
      current_weight_kg: 75.5,
    } as never);
    expect(r.regressing).toBe(false);
    expect(r.distanceKg).toBeCloseTo(0.5);
    expect(r.pct).toBeGreaterThan(0.8); // estabilidad alta
  });

  it("mantener: drift > 1 kg marca regressing", () => {
    const r = goalProgress({
      target_weight_kg: 75,
      start_weight_kg: 75,
      current_weight_kg: 77,
    } as never);
    expect(r.regressing).toBe(true);
    expect(r.distanceKg).toBeCloseTo(2);
  });

  it("sin start_weight_kg usa current como start", () => {
    const r = goalProgress({
      target_weight_kg: 70,
      start_weight_kg: null,
      current_weight_kg: 80,
    } as never);
    // start = current = 80, path = |80-70| = 10, done = 80-80 = 0
    expect(r.measurable).toBe(true);
    expect(r.pct).toBe(0);
    expect(r.total).toBe(10);
  });

  it("sin perfil devuelve ceros", () => {
    const r = goalProgress(null);
    expect(r.measurable).toBe(false);
    expect(r.hasTarget).toBe(false);
    expect(r.targetKg).toBeNull();
    expect(r.distanceKg).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// goalProgress — camino legacy: goal_type + goal_amount (backward compat)
// ---------------------------------------------------------------------------

describe("goalProgress legacy (sin target_weight_kg)", () => {
  const base = { goal_type: "perder", goal_amount: 10, start_weight_kg: 100 };

  it("marca regressing cuando el usuario sube de peso con objetivo perder", () => {
    const r = goalProgress({ ...base, current_weight_kg: 110 } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(-10);
    expect(r.regressing).toBe(true);
  });

  it("devuelve 100% si el usuario pierde justo lo marcado", () => {
    const r = goalProgress({ ...base, current_weight_kg: 90 } as never);
    expect(r.pct).toBe(1);
    expect(r.done).toBe(10);
    expect(r.regressing).toBe(false);
  });

  it("muestra progreso parcial (50%)", () => {
    const r = goalProgress({ ...base, current_weight_kg: 95 } as never);
    expect(r.pct).toBeCloseTo(0.5);
    expect(r.done).toBeCloseTo(5);
    expect(r.regressing).toBe(false);
  });

  it("clampea a 100% si se supera el objetivo", () => {
    const r = goalProgress({ ...base, current_weight_kg: 85 } as never);
    expect(r.pct).toBe(1);
    expect(r.regressing).toBe(false);
  });

  it('marca regressing con goal_type="perder peso" (bug legacy)', () => {
    const r = goalProgress({
      goal_type: "perder peso",
      goal_amount: 10,
      start_weight_kg: 100,
      current_weight_kg: 110,
    } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(-10);
    expect(r.regressing).toBe(true);
  });

  it('marca regressing con goal_type="ganar músculo" cuando baja', () => {
    const r = goalProgress({
      goal_type: "ganar músculo",
      goal_amount: 5,
      start_weight_kg: 70,
      current_weight_kg: 65,
    } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(-5);
    expect(r.regressing).toBe(true);
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
    expect(r.regressing).toBe(false);
  });

  it("mantener: drift 0 es 100%", () => {
    const r = goalProgress({
      goal_type: "mantener",
      start_weight_kg: 70,
      current_weight_kg: 70,
    } as never);
    expect(r.pct).toBe(1);
    expect(r.regressing).toBe(false);
  });

  it("mantener: drift > 1 kg marca regressing", () => {
    const r = goalProgress({
      goal_type: "mantener",
      start_weight_kg: 70,
      current_weight_kg: 72,
    } as never);
    expect(r.regressing).toBe(true);
  });

  it('objetivo "energia" no es medible aunque el peso cambie', () => {
    const r = goalProgress({
      goal_type: "energia",
      start_weight_kg: 80,
      current_weight_kg: 83,
    } as never);
    expect(r.measurable).toBe(false);
    expect(r.regressing).toBe(false);
  });

  describe("objetivo de peso SIN goal_amount (cantidad opcional en blanco)", () => {
    it("perder sin meta: bajar 2 kg es progreso, no retroceso", () => {
      const r = goalProgress({
        goal_type: "perder",
        goal_amount: null,
        start_weight_kg: 80,
        current_weight_kg: 78,
      } as never);
      expect(r.measurable).toBe(true);
      expect(r.hasTarget).toBe(false);
      expect(r.done).toBe(2);
      expect(r.regressing).toBe(false);
      expect(r.pct).toBe(0);
    });

    it("perder sin meta: subir marca regressing con done negativo", () => {
      const r = goalProgress({
        goal_type: "perder peso",
        goal_amount: null,
        start_weight_kg: 80,
        current_weight_kg: 81.5,
      } as never);
      expect(r.done).toBe(-1.5);
      expect(r.regressing).toBe(true);
    });

    it("ganar sin meta: subir 3 kg es progreso", () => {
      const r = goalProgress({
        goal_type: "ganar",
        goal_amount: null,
        start_weight_kg: 60,
        current_weight_kg: 63,
      } as never);
      expect(r.measurable).toBe(true);
      expect(r.hasTarget).toBe(false);
      expect(r.done).toBe(3);
      expect(r.regressing).toBe(false);
    });
  });

  it("sin start_weight_kg devuelve ceros sin regressing", () => {
    const r = goalProgress({
      goal_type: "perder",
      goal_amount: 10,
      start_weight_kg: null,
      current_weight_kg: 101,
    } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(0);
    expect(r.regressing).toBe(false);
  });

  it("perder +1 kg (100→101) marca regressing con done=-1", () => {
    const r = goalProgress({
      goal_type: "perder",
      goal_amount: 10,
      start_weight_kg: 100,
      current_weight_kg: 101,
    } as never);
    expect(r.pct).toBe(0);
    expect(r.done).toBe(-1);
    expect(r.regressing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// goalDirection — la dirección del objetivo a partir del perfil
// ---------------------------------------------------------------------------

describe("goalDirection", () => {
  it("con peso objetivo, compara con el actual", () => {
    expect(goalDirection({ target_weight_kg: 70, current_weight_kg: 80 })).toBe("perder");
    expect(goalDirection({ target_weight_kg: 70, current_weight_kg: 60 })).toBe("ganar");
    expect(goalDirection({ target_weight_kg: 70, current_weight_kg: 70.5 })).toBe("mantener");
  });

  it("sin peso actual usa el de partida, y sin ninguno se queda donde está", () => {
    expect(goalDirection({ target_weight_kg: 70, start_weight_kg: 80 })).toBe("perder");
    expect(goalDirection({ target_weight_kg: 70 })).toBe("mantener");
  });

  it("el peso objetivo manda sobre el goal_type legacy", () => {
    expect(goalDirection({ target_weight_kg: 70, current_weight_kg: 80, goal_type: "ganar" })).toBe(
      "perder",
    );
  });

  it("sin peso objetivo, el goal_type legacy normalizado", () => {
    expect(goalDirection({ goal_type: "Perder peso" })).toBe("perder");
    expect(goalDirection({ goal_type: "mantener" })).toBe("mantener");
  });

  it("un objetivo que no es de peso, o ninguno, no tiene dirección", () => {
    expect(goalDirection({ goal_type: "habitos" })).toBeNull();
    expect(goalDirection({ goal_type: "salud" })).toBeNull();
    expect(goalDirection({ goal_type: "energia" })).toBeNull();
    expect(goalDirection({})).toBeNull();
  });

  it("compensa igual que la regla que tenían settleDay y compensateFutureDishChange", () => {
    // Copia literal de `goalOf` (day-settle.server.ts) y
    // `resolveCompensationGoal` (reflow.functions.ts) antes del ticket 26: la
    // diferencia es que devolvían "habitos" o "energia" tal cual, y
    // `compensationNeed` los trata igual que `null` (fila de mantener).
    const before = (p: Record<string, unknown>) =>
      p.target_weight_kg != null
        ? deriveGoalType(
            Number(p.current_weight_kg ?? p.start_weight_kg ?? p.target_weight_kg),
            Number(p.target_weight_kg),
          )
        : p.goal_type
          ? normalizeGoalType(String(p.goal_type))
          : null;
    const weights = [null, 60, 69.5, 70, 71, 85];
    const goalTypes = [null, "perder peso", "ganar", "mantener", "habitos", "salud", "energia"];
    const profiles: Record<string, unknown>[] = [];
    for (const target of weights)
      for (const current of weights)
        for (const start of [null, 80])
          for (const goal_type of goalTypes)
            profiles.push({
              target_weight_kg: target,
              current_weight_kg: current,
              start_weight_kg: start,
              goal_type,
            });
    let compared = 0;
    for (const p of profiles)
      for (let deltaKcal = -600; deltaKcal <= 600; deltaKcal += 25)
        for (const deltaProtein of [null, -30, 0])
          for (const reversing of [false, true]) {
            const input = { deltaKcal, deltaProtein, reversing, pregnancyStatus: null };
            expect(compensationNeed({ ...input, goal: goalDirection(p) })).toEqual(
              compensationNeed({ ...input, goal: before(p) }),
            );
            compared++;
          }
    expect(compared).toBeGreaterThan(100_000);
  });
});

// ---------------------------------------------------------------------------
// chipToValue / valueToChip — mapeo etiqueta ↔ valor interno
// ---------------------------------------------------------------------------

describe("chipToValue / valueToChip", () => {
  // goal_type ya no está en PROFILE_SECTIONS (sustituido por target_weight_kg).
  // Los tests de valueMap se mantienen con campos que sí lo usan (tone, por ej.).
  it("pasa valores sin mapa como identity", () => {
    const noMap = { key: "tone" as const, label: "Tono", kind: "chips" as const, options: ["a"] };
    expect(chipToValue(noMap, "a")).toBe("a");
    expect(valueToChip(noMap, "a")).toBe("a");
  });

  it("target_weight_kg aparece en PROFILE_SECTIONS", () => {
    const field = PROFILE_SECTIONS.flatMap((s) => s.fields).find(
      (f) => f.key === "target_weight_kg",
    );
    expect(field).toBeDefined();
    expect(field!.kind).toBe("number");
  });
});
