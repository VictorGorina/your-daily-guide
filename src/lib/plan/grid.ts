import { daysInMonth } from "../shopping/model";
import { MEAL_SLOT_FIELD } from "./slots";
import { isPinned, type MonthlyPlan, type PlanDay } from "./types";
import { dateInMonth, weekdayIndex } from "@/lib/dates";

export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export const normDay = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/**
 * Filas de un plan: las 4 semanas que genera la IA (días 1-28) y una 5.ª con
 * los días 29-31. Sin esa fila, esos días compartían celda con el mismo día de
 * la semana 3: el martes 29 ERA el martes 22, así que lo que se cambiaba una
 * semana aparecía la siguiente y un cambio para el 29 reescribía el 22.
 * La compra sigue en 4 semanas (`WEEK_COUNT`): los días 29-31 cuentan en la
 * última, y la 5.ª fila nace como copia de la 4.ª, así que las cantidades
 * siguen valiendo.
 */
export const PLAN_ROWS = 5;

/** Posición de una fecha dentro del plan (fila 0-4, día 0-6 lunes→domingo). */
export const planCursor = (date: string) => {
  const dayOfMonth = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.max(Math.floor((dayOfMonth - 1) / 7), 0), PLAN_ROWS - 1);
  const dayIndex = weekdayIndex(date);
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
 * Los días 29-31 van en su propia fila (la 4, ver `PLAN_ROWS`).
 */
export function dateOfPlanCell(month: string, weekIndex: number, dayIndex: number): string | null {
  const total = daysInMonth(month);
  const from = weekIndex * 7 + 1;
  for (let dom = from; dom <= Math.min(from + 6, total); dom++) {
    const date = dateInMonth(month, dom);
    if (weekdayIndex(date) === dayIndex) return date;
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

const DIA_NOMBRES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Nombre del día de la semana de una fecha, sin depender del locale del entorno. */
export const weekdayName = (date: string) => DIA_NOMBRES[weekdayIndex(date)] ?? "";

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
  const dayIndex = byName >= 0 ? byName : weekdayIndex(date);
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

/**
 * Añade a un plan de 4 filas la de los días 29-31 (ver `PLAN_ROWS`). Los planes
 * guardados antes no la tienen, y la IA sigue generando 4 semanas: se aplica al
 * leer (`cleanPlan`, y en el cliente al traer la fila) y queda guardada en la
 * siguiente escritura. Un plan que ya la tiene, o con menos de 4 filas, vuelve
 * tal cual (el mismo objeto).
 *
 * Nace como copia de la semana 3, que es lo que esos días enseñaban hasta ahora
 * y lo que dimensiona la compra, salvo una comida fijada a mano (`pinned`):
 * esa se eligió para UNA de las dos fechas que compartían celda, casi siempre
 * la de la semana 3. Esa comida va con el plato del plan del mismo día en la
 * fila anterior que no esté fijada, sin marca. Si todas lo están, se copia la
 * de la semana 3 sin marca.
 */
export function withOverflowWeek(plan: MonthlyPlan): MonthlyPlan {
  if (plan.weeks.length !== PLAN_ROWS - 1) return plan;
  const last = plan.weeks[PLAN_ROWS - 2]!;
  const days = last.days.map((day, di): PlanDay => {
    const { pinned, ...copy } = day;
    const next: PlanDay = { ...copy };
    for (const slot of pinned ?? []) {
      const source = [2, 1, 0]
        .map((wi) => plan.weeks[wi]?.days[di])
        .find((d): d is PlanDay => !!d && !isPinned(d, slot));
      if (!source) continue;
      const field = MEAL_SLOT_FIELD[slot];
      if (field === "lunch" || field === "dinner") next[field] = source[field];
      else if (source[field]) next[field] = source[field];
      else delete next[field];
      const extras = { ...next.extras };
      if (source.extras?.[slot]) extras[slot] = source.extras[slot];
      else delete extras[slot];
      if (Object.keys(extras).length) next.extras = extras;
      else delete next.extras;
      const kids = [
        ...(next.kids ?? []).filter((k) => k.slot !== slot),
        ...(source.kids ?? []).filter((k) => k.slot === slot),
      ];
      if (kids.length) next.kids = kids;
      else delete next.kids;
    }
    return next;
  });
  return { ...plan, weeks: [...plan.weeks, { ...last, label: "Final de mes", days }] };
}
