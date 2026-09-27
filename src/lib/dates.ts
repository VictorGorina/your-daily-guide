/**
 * Fechas `YYYY-MM-DD` y meses `YYYY-MM`: un helper por concepto (ticket 26,
 * CAL-07). Puro y sin imports, así sirve igual en el cliente y en el servidor.
 *
 * Las cuentas de días van en UTC a propósito: sumar días con `setDate` en hora
 * local da un día de 23 o 25 horas en el cambio de hora (25 de octubre de 2026),
 * y según la hora del dispositivo eso salta o repite una fecha. En UTC un día
 * dura siempre un día, igual en el navegador, en el servidor y en Hermes.
 *
 * "Hoy" no está aquí: depende de la zona horaria (`zonedTodayISO`,
 * `zoned-date.ts`; en el cliente, `todayISO` de `daily.ts`).
 */

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

const toUTC = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

const fromUTC = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** `date` desplazada `n` días (negativo hacia atrás). */
export const addDaysISO = (date: string, n: number): string => fromUTC(toUTC(date) + n * DAY_MS);

/** Días naturales de `from` a `to` (positivo si `to` es posterior). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((toUTC(to) - toUTC(from)) / DAY_MS);

/** Día de la semana con el lunes como 0 y el domingo como 6 (el orden de la tira y del plan). */
export const weekdayIndex = (date: string): number => (new Date(toUTC(date)).getUTCDay() + 6) % 7;

/** Número de días de un mes "YYYY-MM". */
export const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y ?? 1970, m ?? 1, 0).getDate();
};

/** El día `day` (1-31) del mes "YYYY-MM", como "YYYY-MM-DD". */
export const dateInMonth = (month: string, day: number): string => `${month}-${pad(day)}`;

/**
 * La fecha que marca el reloj de pared de `d` (su año, mes y día LOCALES), no
 * `toISOString()`: esa es la de UTC, y por la noche en América ya es mañana.
 */
export const localISODate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
