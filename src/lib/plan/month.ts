import { daysInMonth } from "../shopping/model";

// ---------------------------------------------------------------------------
// Navegación de meses de la pantalla Plan
// ---------------------------------------------------------------------------

/** "YYYY-MM" desplazado `delta` meses (cruza de año sin problema). */
export const addMonths = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * "2026-08" → "agosto de 2026". `locale` es una etiqueta `Intl` (`dateLocale`):
 * la pantalla pasa la de la persona; el servidor no, y escribe en español.
 */
export const monthTitle = (month: string, locale = "es-ES"): string =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });

/**
 * Mes y año por separado, para pintarlos en dos líneas en la cabecera de Plan
 * (el mes solo se corta con `truncate` en pantallas estrechas: "Septiembre de
 * 2026" no cabe en una línea entre los dos botones de navegación). Cada parte
 * sale de `toLocaleDateString` por su cuenta en vez de partir la cadena de
 * `monthTitle`: ese formato ("agosto de 2026") depende del idioma y no es
 * seguro trocearlo por posición.
 */
export const monthParts = (
  month: string,
  locale = "es-ES",
): { monthName: string; year: string } => {
  const date = new Date(`${month}-01T00:00:00`);
  return {
    monthName: date.toLocaleDateString(locale, { month: "long" }),
    year: date.toLocaleDateString(locale, { year: "numeric" }),
  };
};

/**
 * Pone en mayúscula solo la primera letra ("agosto de 2026" → "Agosto de 2026").
 * Para títulos: en español el mes y la preposición van en minúscula, así que
 * `text-transform: capitalize` / `textTransform: "capitalize"` (que sube cada
 * palabra) da "Agosto De 2026", que está mal.
 */
export const capitalizeFirst = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/** Días que quedan del mes de `dateISO`, contando hoy (1 = hoy es el último día). */
export const daysLeftInMonth = (dateISO: string): number =>
  daysInMonth(dateISO.slice(0, 7)) - Number(dateISO.slice(8, 10)) + 1;

/** Mes "YYYY-MM" siguiente al de `dateISO`. */
export const nextMonthISO = (dateISO: string): string => addMonths(dateISO.slice(0, 7), 1);

/**
 * Cuántos días naturales antes del día 1 del mes que viene se puede preparar ya
 * su plan (para ir a la compra antes de que empiece). Un único valor para el
 * desbloqueo del navegador y para el aviso push de renovación del plan.
 */
export const NEXT_MONTH_UNLOCK_DAYS = 7;

export const isNextMonthUnlocked = (today: string): boolean =>
  daysLeftInMonth(today) <= NEXT_MONTH_UNLOCK_DAYS;

export type PlanMonthStatus = "past" | "current" | "next-locked" | "next-unlocked" | "far-future";

/** En qué situación está `month` respecto a hoy, para saber qué se puede hacer con él. */
export const planMonthStatus = (month: string, today: string): PlanMonthStatus => {
  const currentMonth = today.slice(0, 7);
  if (month < currentMonth) return "past";
  if (month === currentMonth) return "current";
  if (month === nextMonthISO(today)) {
    return isNextMonthUnlocked(today) ? "next-unlocked" : "next-locked";
  }
  return "far-future";
};

/** Un mes donde se puede generar/editar el plan y accionar la compra: el actual o el siguiente ya desbloqueado. */
export const isMonthActionable = (month: string, today: string): boolean => {
  const status = planMonthStatus(month, today);
  return status === "current" || status === "next-unlocked";
};

/** ¿`dateISO` es anterior a la fecha de alta? (días que la app no podía cubrir). */
export const isBeforeAppStart = (
  dateISO: string,
  appStartedOn: string | null | undefined,
): boolean => !!appStartedOn && dateISO < appStartedOn;

/**
 * Límites del navegador de meses de la pantalla Plan: no se baja del mes de la
 * fecha de alta (antes no hay nada que ver), ni se sube más allá del mes que
 * viene, y solo cuando está desbloqueado.
 */
export const planNavBounds = (
  today: string,
  appStartedOn: string | null | undefined,
): { earliest: string; latest: string } => {
  const currentMonth = today.slice(0, 7);
  const startMonth = (appStartedOn ?? today).slice(0, 7);
  return {
    earliest: startMonth < currentMonth ? startMonth : currentMonth,
    latest: isNextMonthUnlocked(today) ? nextMonthISO(today) : currentMonth,
  };
};
