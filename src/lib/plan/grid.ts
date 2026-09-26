import { daysInMonth } from "../shopping/model";
import type { MonthlyPlan, PlanDay } from "./types";

export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export const normDay = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/** Posición de una fecha dentro del plan (semana 0-3, día 0-6 lunes→domingo). */
export const planCursor = (date: string) => {
  const dayOfMonth = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.max(Math.floor((dayOfMonth - 1) / 7), 0), 3);
  const jsDay = new Date(`${date}T00:00:00`).getDay();
  const dayIndex = (jsDay + 6) % 7;
  return { weekIndex, dayIndex, dayName: DAY_NAMES[dayIndex] ?? "Lunes" };
};

/**
 * Fecha que ocupa una celda `(semana, día)` del plan, o `null` si esa celda no
 * cae en el mes. Es la inversa de `planSlotIndex`.
 *
 * Hace falta porque la rejilla del plan NO va en orden de calendario: la semana
 * la marca el día del mes (`floor((día-1)/7)`) y la posición dentro de ella, el
 * día de la semana. En un mes que empieza en martes, la semana 0 va
 * martes(1)…domingo(6) y luego lunes(7): el lunes es el ÚLTIMO día de esa
 * semana pero el PRIMERO de la fila. Decidir "esto es futuro" comparando
 * posiciones da el resultado contrario al del calendario.
 *
 * Los días 29 en adelante comparten celda con los de la semana 3 (el plan solo
 * tiene 4 filas y `planSlotIndex` los recorta ahí), así que esta función
 * devuelve la PRIMERA fecha de la fila: al usarla para decidir qué se puede
 * reescribir, el empate se resuelve a favor de no tocar nada. Es la limitación
 * del modelo de 4 semanas, no de esta función.
 */
export function dateOfPlanCell(month: string, weekIndex: number, dayIndex: number): string | null {
  const total = daysInMonth(month);
  const from = weekIndex * 7 + 1;
  for (let dom = from; dom <= Math.min(from + 6, total); dom++) {
    const date = `${month}-${String(dom).padStart(2, "0")}`;
    if ((new Date(`${date}T00:00:00`).getDay() + 6) % 7 === dayIndex) return date;
  }
  return null;
}

/**
 * ¿Es la celda `(semana, día)` del plan de `month` posterior a `today`, y por
 * tanto se puede reescribir? Decide por la fecha real de la celda
 * (`dateOfPlanCell`), nunca por su posición en la fila: un lunes 7 va en la
 * posición 0 pero es la última fecha de la semana 0 de un mes que empieza en
 * martes. Hoy y el pasado no se tocan; una celda que no cae en el mes, tampoco.
 *
 * Un mes íntegramente futuro (p. ej. al preparar el que viene por adelantado)
 * no tiene nada fijado: todas sus celdas cuentan como futuras, también las que
 * no tienen fecha, para que se copie completo.
 */
export function isPlanCellAhead(
  month: string,
  weekIndex: number,
  dayIndex: number,
  today: string,
): boolean {
  if (month > today.slice(0, 7)) return true;
  const date = dateOfPlanCell(month, weekIndex, dayIndex);
  return date != null && date > today;
}

/**
 * ¿Está por venir la semana `weekIndex` entera? Los campos de semana
 * (desayunos y meriendas rotan por semana) solo se reescriben entonces; si no,
 * cambiarían también lo que ya se comió. Mismo criterio que `mergeFuturePlan`:
 * toda celda con fecha tiene que ser posterior a `today`.
 */
export function isPlanWeekAhead(month: string, weekIndex: number, today: string): boolean {
  if (month > today.slice(0, 7)) return true;
  return Array.from({ length: 7 }, (_, di) => dateOfPlanCell(month, weekIndex, di)).every(
    (date) => date == null || date > today,
  );
}

const DIA_NOMBRES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Nombre del día de la semana de una fecha, sin depender del locale del entorno. */
export const weekdayName = (date: string) =>
  DIA_NOMBRES[new Date(`${date}T00:00:00`).getDay()] ?? "";

/**
 * Posición exacta (semana, día) que ocupa una fecha dentro del plan. Es la que
 * usan tanto la lectura (`planForDate`) como la escritura de un plato suelto,
 * para que lo que se cambia sea siempre lo que se ve en pantalla.
 */
export function planSlotIndex(
  plan: MonthlyPlan | null,
  date: string,
): { weekIndex: number; dayIndex: number } | null {
  if (!plan?.weeks?.length) return null;
  const dayOfMonth = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.floor((dayOfMonth - 1) / 7), plan.weeks.length - 1);
  const week = plan.weeks[weekIndex];
  if (!week) return null;
  const target = normDay(weekdayName(date));
  const byName = week.days.findIndex((d) => normDay(d.day).includes(target));
  const dayIndex = byName >= 0 ? byName : (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
  return week.days[dayIndex] ? { weekIndex, dayIndex } : null;
}

/** El día del plan de una fecha (ver `planSlotIndex`). */
export function planDayOf(plan: MonthlyPlan | null, date: string): PlanDay | null {
  const at = planSlotIndex(plan, date);
  return at ? (plan!.weeks[at.weekIndex]!.days[at.dayIndex] ?? null) : null;
}

/** Platos del plan mensual para una fecha concreta (YYYY-MM-DD). */
export function planForDate(plan: MonthlyPlan | null, date: string) {
  const at = planSlotIndex(plan, date);
  const week = at ? plan!.weeks[at.weekIndex] : null;
  if (!at || !week) return null;
  return { week, day: week.days[at.dayIndex] ?? null };
}
