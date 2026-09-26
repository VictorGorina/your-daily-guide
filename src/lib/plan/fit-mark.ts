import { planDayOf } from "./grid";
import { applyPlanChanges } from "./merge";
import type { MonthlyPlan } from "./types";

/**
 * Un plato que cambió la comprobación del plan para que su día encaje. Comida y
 * cena son de un día; desayuno y merienda son una idea de la semana (`week`,
 * `option`: índices en `weeks[].breakfasts`/`snacks`) que usan `days` días
 * desde `date`.
 */
export type PlanFitChange = {
  date: string;
  slot: "comida" | "cena" | "desayuno" | "merienda";
  from: string;
  to: string;
  week?: number;
  option?: number;
  days?: number;
};

/**
 * Aplica los cambios de la comprobación del plan (`fitMonthlyPlan`), cada uno
 * SOLO si su celda sigue teniendo el plato de antes (`from`): la ronda tarda y
 * la persona puede haber cambiado algo mientras. Comida y cena por fecha y sin
 * tocar hoy, el pasado ni un plato puesto a mano (`applyPlanChanges`); una idea
 * semanal, en su semana.
 */
export function applyPlanFitChanges(
  plan: MonthlyPlan,
  changes: readonly PlanFitChange[],
  today: string,
): { plan: MonthlyPlan; applied: PlanFitChange[] } {
  let next = plan;
  const applied: PlanFitChange[] = [];
  for (const c of changes) {
    if (c.slot === "comida" || c.slot === "cena") {
      const key = c.slot === "comida" ? "lunch" : "dinner";
      if (planDayOf(next, c.date)?.[key] !== c.from) continue;
      const after = applyPlanChanges(next, [{ date: c.date, [key]: c.to }], today);
      if (after === next) continue;
      next = after;
    } else {
      const list = c.slot === "desayuno" ? "breakfasts" : "snacks";
      const week = c.week != null ? next.weeks[c.week] : undefined;
      if (!week || c.option == null || week[list][c.option] !== c.from) continue;
      next = {
        ...next,
        weeks: next.weeks.map((w, wi) =>
          wi === c.week
            ? { ...w, [list]: w[list].map((idea, i) => (i === c.option ? c.to : idea)) }
            : w,
        ),
      };
    }
    applied.push(c);
  }
  return { plan: next, applied };
}

export type PlanFitMark = {
  at: string;
  /** Días que encajan / días medidos, antes y después de la ronda (0-1). */
  before: number;
  after: number;
  changed: PlanFitChange[];
};

/** Versión actual de `MonthlyPlan.targetsVersion`. */
export const PLAN_TARGETS_VERSION = 1;
