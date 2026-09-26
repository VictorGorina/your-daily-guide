/**
 * Log estructurado del servidor: una línea JSON por evento, con nombre fijo,
 * para poder buscarlo y ponerle alertas (ticket 35 de la auditoría). Los campos
 * pasan por `redactFields`, así que un dato personal no sale aunque se cuele.
 *
 * Eventos (`snake_case`, en inglés: son identificadores):
 *
 * - `rate_limit_failopen` (error): `consume_rate_limit` falló y se dejó pasar.
 *   Mientras se repita, NO hay cuota por hora.
 * - `spend_cap_failopen` (error): no se pudo leer `ai_spend` y se dejó pasar.
 *   Mientras se repita, NO hay tope de gasto en IA.
 * - `spend_record_failed` (error): no se pudo sumar el coste de una llamada;
 *   esa llamada queda fuera del tope.
 * - `spend_cap_reached` (warn): una cuenta llegó a su tope de gasto. Casi
 *   imposible usando la app con normalidad: si se repite, merece un vistazo.
 * - `push_failed` (warn): el servicio de push rechazó un envío (no 404/410).
 * - `recipe_hits_failed` (warn): no se pudo sumar el uso de una receta.
 * - `reflow_changes_discarded` (warn): la IA propuso cambios fuera de las fechas
 *   permitidas y se descartaron.
 * - `email_send_failed` (error): Resend rechazó un correo.
 * - `env_missing` (error): falta una variable de entorno y se usa un respaldo.
 * - `settle_release_failed` (error): `settleDay` no pudo devolver una reserva;
 *   ese desvío queda marcado como compensado sin estarlo (ver ticket 22).
 */
import { redactFields } from "@/lib/log-redact";

export type LogLevel = "info" | "warn" | "error";

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...redactFields(fields),
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(line);
}
