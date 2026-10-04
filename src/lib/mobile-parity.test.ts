import { describe, expect, it } from "bun:test";

import * as mobile from "../../mobile/lib/plan-shared";
import { shelfLifeDays as mobileShelfLifeDays } from "../../mobile/lib/shelf-life";
import {
  CADENCES,
  cleanSharedPlan,
  planSlotIndex,
  projectTrips,
  shelfLifeDays,
  weekdayName,
} from "./plan-shared";
import type { MonthlyPlan, ShoppingList } from "./plan-shared";

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

  // La tabla de vida útil es una copia aparte (`mobile/lib/shelf-life.ts`) con su
  // propio normalizador: el drift check no la compara.
  const FOODS: [string, string, boolean][] = [
    ["Merluza", "Proteína", true],
    ["Pechuga de pollo", "Proteína", true],
    ["Espinacas", "Verdura y fruta", true],
    ["Champiñón", "Verdura y fruta", true],
    ["Plátano", "Verdura y fruta", true],
    ["Zanahoria", "Verdura y fruta", true],
    ["Huevos", "Proteína", true],
    ["Patata", "Verdura y fruta", true],
    ["Yogur natural", "Lácteos", true],
    ["Tofu", "Proteína", true],
    ["Kéfir", "Lácteos", true],
    ["Algo raro", "Categoría nueva", true],
    ["Arroz", "Despensa", false],
  ];

  it("shelfLifeDays da los mismos días en las dos apps", () => {
    for (const [name, category, perishable] of FOODS) {
      expect(mobileShelfLifeDays(name, category, perishable)).toBe(
        shelfLifeDays(name, category, perishable),
      );
    }
  });

  it("projectTrips reparte igual en las dos apps, con todas las cadencias", () => {
    const list: ShoppingList = [...new Set(FOODS.map(([, category]) => category))].map(
      (category) => ({
        category,
        items: FOODS.filter(([, c]) => c === category).map(([name, , perishable], i) => ({
          name,
          qty: "",
          price_eur: 4,
          trip: 0,
          perishable,
          unit: "g" as const,
          weekQty: [100 + i * 30, i % 2 ? 0 : 200, 150, 90 + i * 10],
          weekPrice: [1, i % 2 ? 0 : 1.5, 1, 0.5],
        })),
      }),
    );
    for (const { key } of CADENCES) {
      for (const coverage of [
        { fromDay: 1, toDay: 31 },
        { fromDay: 1, toDay: 28 },
        { fromDay: 12, toDay: 30 },
      ]) {
        expect(mobile.projectTrips(list as never, key, coverage)).toEqual(
          projectTrips(list, key, coverage) as never,
        );
      }
    }
  });
});
