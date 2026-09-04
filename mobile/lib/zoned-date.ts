/**
 * Zona horaria del dispositivo, para guardarla en `profiles.timezone`. El push
 * del servidor (web) usa ese valor para disparar el resumen matutino y el
 * repaso nocturno a la hora local de cada persona.
 *
 * Copia parcial de `src/lib/zoned-date.ts` de la web (no hay código compartido).
 * Aquí solo hace falta detectar la zona: el "hoy" del móvil ya sale del reloj
 * local del dispositivo en `todayISO()` de daily.ts.
 */

/** Zona por defecto cuando el runtime no expone la del dispositivo. */
export const DEFAULT_TZ = "Europe/Madrid";

export function resolveDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}
