import { addDaysISO as addDays } from "@/lib/dates";
import { isSharedSlot, type SharedSlots } from "@/lib/household-shared";
import { daysInMonth } from "../shopping/model";
import { dateOfPlanCell, planCursor, weekdayName } from "./grid";
import { mealsForDate } from "./habits";
import { MEAL_SLOT_LABEL, type MealSlot } from "./slots";
import type { MonthlyPlan } from "./types";
import { dateInMonth } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Diff de platos futuros tras un ajuste del plan
// ---------------------------------------------------------------------------

/**
 * Un plato del plan que cambió entre la versión anterior y la posterior de un
 * `adjustMonthlyPlan`. Usado por el badge "i" de Hoy para mostrar qué efecto
 * tuvo el cambio de plato en el plan futuro.
 */
export type MealChange = {
  date: string;
  slot: MealSlot;
  slotLabel: string;
  before: string;
  after: string;
};

/**
 * Compara los platos de los días FUTUROS (posteriores a `today`) entre dos
 * versiones del plan y devuelve los que cambiaron. Ignora el día de hoy y
 * anteriores (están fijados). Compara solo lunch y dinner — desayunos y snacks
 * no los recoloca `adjustMonthlyPlan` (giran por semana, no por día).
 */
export function diffFutureMeals(
  before: MonthlyPlan | null,
  after: MonthlyPlan | null,
  today: string,
): MealChange[] {
  if (!before || !after) return [];
  const month = today.slice(0, 7);
  const changes: MealChange[] = [];
  const totalDays = daysInMonth(month);

  for (let d = 1; d <= totalDays; d++) {
    const date = dateInMonth(month, d);
    if (date <= today) continue; // solo días futuros

    const mealsBefore = mealsForDate(before, date);
    const mealsAfter = mealsForDate(after, date);

    for (const mb of mealsBefore) {
      // Solo comparar comida y cena — lo que adjustMonthlyPlan recoloca
      if (mb.slot !== "comida" && mb.slot !== "cena") continue;
      const ma = mealsAfter.find((m) => m.slot === mb.slot);
      if (ma && ma.idea && mb.idea && ma.idea !== mb.idea) {
        changes.push({
          date,
          slot: mb.slot,
          slotLabel: MEAL_SLOT_LABEL[mb.slot],
          before: mb.idea,
          after: ma.idea,
        });
      }
    }
  }
  return changes;
}

export { addDays };

/** Días hacia delante en los que se reparte una compensación. */
export const COMPENSATION_WINDOW_DAYS = 6;

/**
 * Fechas en las que se puede absorber un desvío de HOY (el picoteo, y más
 * adelante cualquier cambio de plato, ticket 08 de `hoy-semanas-editables`):
 * de mañana a hoy + `days`, dentro del mismo mes.
 *
 * Solo quedan las fechas con al menos una comida o cena PROPIA ese día: un
 * desvío personal se corrige en las comidas no compartidas de esa persona,
 * nunca cambiando la mesa de toda la casa. Y solo las que son la fecha real de
 * su celda (`dateOfPlanCell`): los días 29 en adelante comparten celda con la
 * semana 3 y una recolocación sobre ellos se descarta, así que ofrecerlos
 * gastaría una llamada a la IA que no puede cambiar nada.
 *
 * `reason` explica una ventana vacía: `no-meals` (no planifica comidas ni
 * cenas), `no-days` (se acaba el mes) o `shared-only` (quedan días, pero todas
 * sus comidas y cenas son de la casa).
 */
export function compensationWindow(opts: {
  today: string;
  sharedSlots: SharedSlots;
  selectedSlots: readonly MealSlot[];
  /**
   * Sin otro adulto con quien compartir la mesa, "compartido" no protege a
   * nadie más: se tratan como propias igualmente (p. ej. una persona adulta
   * sola con peques a cargo).
   */
  soloAdult?: boolean;
  days?: number;
}): { dates: string[]; reason: "no-meals" | "no-days" | "shared-only" | null } {
  const month = opts.today.slice(0, 7);
  const days = opts.days ?? COMPENSATION_WINDOW_DAYS;
  const movable = (["comida", "cena"] as const).filter((s) => opts.selectedSlots.includes(s));
  if (!movable.length) return { dates: [], reason: "no-meals" };
  const inMonth: string[] = [];
  const dates: string[] = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(opts.today, i);
    if (date.slice(0, 7) !== month) break;
    const { weekIndex, dayIndex } = planCursor(date);
    if (dateOfPlanCell(month, weekIndex, dayIndex) !== date) continue;
    inMonth.push(date);
    if (opts.soloAdult || movable.some((slot) => !isSharedSlot(opts.sharedSlots, slot, dayIndex)))
      dates.push(date);
  }
  if (dates.length) return { dates, reason: null };
  return { dates, reason: inMonth.length ? "shared-only" : "no-days" };
}

/** Menú de los próximos días, para que el coach sepa qué está cambiando. */
export function upcomingMeals(plan: MonthlyPlan | null, today: string, days = 7) {
  if (!plan) return [];
  const month = today.slice(0, 7);
  const out: Record<string, string>[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (date.slice(0, 7) !== month) break;
    out.push({
      fecha: date,
      dia: weekdayName(date),
      ...Object.fromEntries(mealsForDate(plan, date).map((m) => [m.slot, m.idea])),
    });
  }
  return out;
}
