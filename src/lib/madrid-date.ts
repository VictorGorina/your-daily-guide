/**
 * Fecha actual en zona horaria Europe/Madrid, en formato YYYY-MM-DD.
 *
 * La app es para uso en España: todas las decisiones de "hoy" (qué plato toca,
 * si un día está cerrado, el log del día) deben coincidir con el reloj de
 * Madrid, no con UTC. Sin esto, entre las 22:00–00:00 UTC el servidor
 * consideraría "mañana" lo que para el usuario todavía es "hoy".
 *
 * Usable tanto en servidor como en cliente (Intl está en todos los runtimes).
 */
export const madridTodayISO = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
