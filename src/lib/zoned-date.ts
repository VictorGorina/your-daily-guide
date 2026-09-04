/**
 * Fecha y hora "de reloj de pared" en una zona horaria IANA concreta.
 *
 * Antes esto era `madrid-date.ts` con `Europe/Madrid` fijo, porque la app se
 * usaba solo en España. Ahora cada perfil guarda su `timezone` (detectada del
 * dispositivo en el onboarding): el corte del día ("¿qué plato toca?", "¿está
 * cerrado este día?") y la ventana de las notificaciones tienen que coincidir
 * con el reloj de esa persona, no con UTC ni con Madrid. Sin esto, entre las
 * 22:00–00:00 UTC el servidor consideraría "mañana" lo que para el usuario
 * todavía es "hoy" (y al revés, hacia el oeste).
 *
 * Usable en servidor y en cliente (`Intl` está en todos los runtimes).
 */

/** Zona por defecto cuando no hay una mejor: la realidad histórica de la app. */
export const DEFAULT_TZ = "Europe/Madrid";

/** Fecha actual (YYYY-MM-DD) según el reloj de pared de `timeZone`. */
export const zonedTodayISO = (timeZone: string = DEFAULT_TZ): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

/**
 * Minutos transcurridos desde medianoche (0–1439) según el reloj de pared de
 * `timeZone`. Lo usa el despachador de push para comparar `morning_time` /
 * `evening_time` con la hora local de cada perfil.
 */
export function zonedMinutesNow(timeZone: string = DEFAULT_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * Zona horaria del dispositivo/navegador. Es la fuente de verdad para "hoy" en
 * el cliente (un único usuario, su propio reloj) y lo que se guarda en
 * `profiles.timezone` para que el push del servidor use esa misma zona. Cae a
 * `DEFAULT_TZ` si el runtime no la expone.
 */
export function resolveDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}
