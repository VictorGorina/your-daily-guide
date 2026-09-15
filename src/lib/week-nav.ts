import { daysInMonth, planNavBounds } from "@/lib/plan-shared";

/**
 * Navegación por semanas de la tira de Hoy (feature `hoy-semanas-editables`,
 * ver `.scratch/hoy-semanas-editables/spec.md`). Todo es puro y trabaja con
 * fechas `YYYY-MM-DD`.
 *
 * Las cuentas de días van en UTC a propósito: sumar días con `setDate` en hora
 * local da un día de 23 o 25 horas en el cambio de hora (25 de octubre de 2026),
 * y según la hora del dispositivo eso salta o repite una fecha. En UTC un día
 * dura siempre un día, igual en el navegador, en el servidor y en Hermes.
 */

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

const toUTC = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

const fromUTC = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const isISODate = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** `date` desplazada `n` días (negativo hacia atrás). */
export const addDaysISO = (date: string, n: number): string => fromUTC(toUTC(date) + n * DAY_MS);

/** Días naturales de `from` a `to` (positivo si `to` es posterior). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((toUTC(to) - toUTC(from)) / DAY_MS);

/** Día de la semana con el lunes como 0 y el domingo como 6 (el orden de la tira y del plan). */
export const weekdayIndex = (date: string): number => (new Date(toUTC(date)).getUTCDay() + 6) % 7;

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
    last: weekStartOf(`${latest}-${pad(daysInMonth(latest))}`),
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

// Abreviaturas fijas: `toLocaleDateString` con `month: "short"` da "sep", "sept"
// o "sept." según la versión de ICU del motor, y la etiqueta tiene que ser la
// misma en la web y en el móvil.
const MONTH_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const shortDate = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]}`;

/**
 * Etiqueta de la cabecera de la tira: "Esta semana", "Semana pasada",
 * "Próxima semana" o el rango ("21–27 sep"; "29 sep – 5 oct" si cruza de mes).
 */
export function weekLabel(monday: string, today: string): string {
  const offset = daysBetween(weekStartOf(today), monday) / 7;
  if (offset === 0) return "Esta semana";
  if (offset === -1) return "Semana pasada";
  if (offset === 1) return "Próxima semana";
  const sunday = addDaysISO(monday, 6);
  return monday.slice(0, 7) === sunday.slice(0, 7)
    ? `${Number(monday.slice(8, 10))}–${shortDate(sunday)}`
    : `${shortDate(monday)} – ${shortDate(sunday)}`;
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
