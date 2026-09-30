import { describe, expect, it } from "bun:test";

import * as mobile from "../../mobile/lib/plan-shared";
import { cleanSharedPlan, planSlotIndex, weekdayName } from "./plan-shared";
import type { MonthlyPlan } from "./plan-shared";

// Paridad web ↔ móvil ejecutando las DOS copias (no comparando su texto): el
// drift check compara cuerpos de funciones, y el 28-09 se le escapó que el
// móvil indexaba su `DIA_NOMBRES` (que empezaba en domingo) con la cuenta de
// la web (lunes = 0) — el móvil buscaba en el plan el día anterior.

const dates = (() => {
  const out: string[] = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
})();

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const plan = {
  weeks: Array.from({ length: 4 }, (_, w) => ({
    days: DAYS.map((day) => ({ day, lunch: `c${w}${day}`, dinner: `d${w}${day}` })),
  })),
} as unknown as MonthlyPlan;

describe("paridad web ↔ móvil de plan-shared", () => {
  it("weekdayName da el mismo día en las dos apps (2026-2027)", () => {
    for (const d of dates) expect(mobile.weekdayName(d)).toBe(weekdayName(d));
  });

  it("planSlotIndex elige la misma celda en las dos apps (2026-2027)", () => {
    for (const d of dates) {
      expect(mobile.planSlotIndex(plan as never, d)).toEqual(planSlotIndex(plan, d));
    }
  });

  it("cleanSharedPlan limpia igual en las dos apps", () => {
    const dirty = structuredClone(plan) as MonthlyPlan;
    (dirty.weeks[0] as { breakfasts?: string[] }).breakfasts = ["Tostada con caca", "Avena"];
    dirty.weeks[0]!.days[0]!.lunch = "Caca de vaca";
    dirty.weeks[0]!.days[1]!.dinner = "x".repeat(250);
    dirty.weeks[0]!.days[2]!.kids = [{ childId: "leo", slot: "cena", dish: "pene" }];
    expect(mobile.cleanSharedPlan(structuredClone(dirty) as never)).toEqual(
      cleanSharedPlan(structuredClone(dirty)) as never,
    );
  });
});
