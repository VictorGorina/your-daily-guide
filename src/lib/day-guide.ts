import type { DailyGuide } from "@/lib/daily";
import { cleanGuide, cleanHabits } from "@/lib/day-row";
import type { MealHabit } from "@/lib/plan-shared";
import { ValidationError } from "@/lib/validation-error";
import { clampClientToday } from "@/lib/zoned-date";

/**
 * Lo que acepta `saveDayGuide` (ticket 39 de la auditoría). La guía la arma el
 * cliente (mezcla la recién generada con las cifras que ya tenía el día, ver
 * `mergeGuide`), pero ya no la escribe él: `daily_logs.guide` solo se escribe
 * desde el servidor, y esto es lo que se comprueba antes.
 *
 * Forma, no contenido: las mismas reglas con las que se LEE la fila
 * (`day-row.ts`), más un tope de tamaño. Los platos de la guía salen del plan y
 * de `habits`, que ya pasaron por `assertCleanFood` al guardarse; repetirlo aquí
 * dejaría un día sin guía por un plato que escribió la IA. Puro, sin Supabase.
 */

/** Una guía de verdad ronda los 3-6 KB; esto es un tope contra el abuso. */
export const DAY_GUIDE_MAX_CHARS = 60_000;
export const DAY_HABITS_MAX = 20;

export type DayGuideInput = {
  date: string;
  guide: DailyGuide;
  /** Las comidas del día, cuando cambian a la vez que la guía (un cambio de plato). */
  habits?: MealHabit[];
};

export function cleanDayGuideInput(input: unknown): DayGuideInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  const today = clampClientToday(raw.today);
  const date = raw.date === undefined ? today : raw.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Día no válido.");
  }
  if (date > today) throw new ValidationError("Ese día todavía no ha llegado.");

  const guide = cleanGuide(raw.guide);
  if (!guide) throw new ValidationError("Falta la guía del día.");

  const out: DayGuideInput = { date, guide };
  if (raw.habits !== undefined) {
    if (!Array.isArray(raw.habits) || raw.habits.length > DAY_HABITS_MAX) {
      throw new ValidationError("Las comidas del día no son válidas.");
    }
    out.habits = cleanHabits(raw.habits);
  }
  if (JSON.stringify(out).length > DAY_GUIDE_MAX_CHARS) {
    throw new ValidationError("La guía del día es demasiado grande.");
  }
  return out;
}
