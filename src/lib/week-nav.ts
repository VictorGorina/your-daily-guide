import { addDaysISO, dateInMonth, daysBetween, daysInMonth, weekdayIndex } from "@/lib/dates";
import { planNavBounds } from "@/lib/plan-shared";

export { addDaysISO, daysBetween, weekdayIndex } from "@/lib/dates";

/**
 * Navegación por semanas de la tira de Hoy (feature `hoy-semanas-editables`,
 * ver `.scratch/hoy-semanas-editables/spec.md`). Todo es puro y trabaja con
 * fechas `YYYY-MM-DD`; las cuentas de días (en UTC) viven en `dates.ts`.
 */

const isISODate = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Lunes de la semana de `date`. Un domingo pertenece a la semana del lunes anterior. */
export const weekStartOf = (date: string): string => addDaysISO(date, -weekdayIndex(date));

/** Las 7 fechas de la semana que empieza en `monday`. */
export const weekDates = (monday: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));

/** Meses `YYYY-MM` que toca una semana: uno, o dos si cruza de mes. */
export const monthsOfWeek = (monday: string): string[] => [
  ...new Set(weekDates(monday).map((d) => d.slice(0, 7))),
];

/** Primera y última semana (sus lunes) a las que deja llegar la tira. */
export type WeekBounds = { first: string; last: string };

/**
 * Hasta dónde se puede deslizar la tira:
 *  - hacia atrás, la semana de la fecha de alta (antes no hay nada que ver);
 *  - hacia delante, la semana del último día del último mes navegable, que es el
 *    mismo límite de la pantalla Plan (`planNavBounds`): el mes en curso, o el
 *    siguiente cuando ya está desbloqueado.
 */
export function weekStripBounds(
  today: string,
  appStartedOn: string | null | undefined,
): WeekBounds {
  const start = isISODate(appStartedOn) && appStartedOn < today ? appStartedOn : today;
  const { latest } = planNavBounds(today, start);
  return {
    first: weekStartOf(start),
    last: weekStartOf(dateInMonth(latest, daysInMonth(latest))),
  };
}

/** Cuántas semanas hay entre los límites, ambas incluidas. */
export const weekCount = (bounds: WeekBounds): number =>
  daysBetween(bounds.first, bounds.last) / 7 + 1;

/** Índice (0 = primera semana) de la semana de `date`, recortado a los límites. */
export const weekIndexOf = (date: string, bounds: WeekBounds): number => {
  const index = daysBetween(bounds.first, weekStartOf(date)) / 7;
  return Math.min(Math.max(index, 0), weekCount(bounds) - 1);
};

/** Lunes de la semana número `index`. */
export const mondayAt = (index: number, bounds: WeekBounds): string =>
  addDaysISO(bounds.first, index * 7);

/** Traductor mínimo (el `t` de i18next cabe aquí): este módulo no importa el catálogo. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

// Los meses salen del catálogo (`monthsShort`), no de `toLocaleDateString`: con
// `month: "short"` el motor da "sep", "sept" o "sept." según su versión de ICU,
// y la etiqueta tiene que ser la misma en la web y en el móvil.
const monthShort = (date: string, t: Translate) => t(`monthsShort.${Number(date.slice(5, 7)) - 1}`);

/**
 * Etiqueta de la cabecera de la tira: "Esta semana", "Semana pasada",
 * "Próxima semana" o el rango ("21–27 sep"; "29 sep – 5 oct" si cruza de mes).
 * El texto vive en el catálogo (`week.*`), en el idioma de `t`.
 */
export function weekLabel(monday: string, today: string, t: Translate): string {
  const offset = daysBetween(weekStartOf(today), monday) / 7;
  if (offset === 0) return t("week.this");
  if (offset === -1) return t("week.last");
  if (offset === 1) return t("week.next");
  const sunday = addDaysISO(monday, 6);
  const from = Number(monday.slice(8, 10));
  const to = Number(sunday.slice(8, 10));
  return monday.slice(0, 7) === sunday.slice(0, 7)
    ? t("week.rangeSameMonth", { from, to, month: monthShort(sunday, t) })
    : t("week.rangeAcrossMonths", {
        from,
        fromMonth: monthShort(monday, t),
        to,
        toMonth: monthShort(sunday, t),
      });
}

export type DayKind = "before-start" | "past" | "today" | "future";

/** Qué es un día de la tira respecto a hoy y a la fecha de alta. */
export function dayKind(
  date: string,
  today: string,
  appStartedOn: string | null | undefined,
): DayKind {
  if (date === today) return "today";
  if (date > today) return "future";
  return isISODate(appStartedOn) && date < appStartedOn ? "before-start" : "past";
}

/**
 * Días hacia atrás en los que se puede CREAR el registro de un día que no se
 * abrió. Es el límite de la policy `insert recent own log`
 * (`supabase/migrations/20260906120000_daily_logs_backfill_window.sql`).
 */
export const BACKFILL_WINDOW_DAYS = 45;

/**
 * ¿Se puede corregir este día pasado? Tiene que ser pasado, no anterior al alta
 * y, si no tiene registro, estar dentro de la ventana de relleno. Con registro
 * previo la corrección va por la policy de UPDATE, que no tiene límite de fecha.
 *
 * Sin registro se exige un día menos que la policy: esta la evalúa la base de
 * datos con su `current_date` (UTC) y `today` es la fecha del dispositivo, que
 * puede ir un día por detrás. Así el lápiz nunca sale en un día donde el
 * guardado va a fallar.
 */
export function isPastDayEditable(
  date: string,
  today: string,
  appStartedOn: string | null | undefined,
  hasLog: boolean,
): boolean {
  if (dayKind(date, today, appStartedOn) !== "past") return false;
  return hasLog || daysBetween(date, today) < BACKFILL_WINDOW_DAYS;
}
