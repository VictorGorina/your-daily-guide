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
 * - `foods_extra_load_failed` (warn): no se pudo leer `foods_extra`; esa instancia
 *   reintenta a los 30 s y, mientras, una receta guardada con ingredientes de USDA
 *   no se resuelve y se vuelve a descomponer (una llamada a la IA). Suelto es un
 *   fallo de red; repetido, la tabla o su acceso.
 * - `reflow_changes_discarded` (warn): la IA propuso cambios fuera de las fechas
 *   permitidas y se descartaron.
 * - `plan_generic_dish_fixed` (warn): el plan recién generado traía platos de
 *   "comer fuera" genéricos o más de un cheat day por semana, y `concretizePlan`
 *   los arregló (`rewritten`/`replaced`) o no encontró con qué (`unresolved`).
 *   Suelto es el modelo barato; repetido, el prompt ha dejado de funcionar.
 * - `email_send_failed` (error): Resend rechazó un correo.
 * - `env_missing` (error): falta una variable de entorno y se usa un respaldo.
 * - `settle_release_failed` (error): `settleDay` no pudo devolver una reserva.
 *   Su marca (`adjustment.pending`) se queda y el siguiente asentamiento la
 *   devuelve cuando caduca (5 min).
 * - `settle_reservation_expired` (warn): un asentamiento encontró la reserva
 *   caducada de otro que murió a medias y la devolvió. Suelto es una función
 *   cortada; repetido, `settleDay` se pasa de tiempo.
 * - `settle_no_adjustment_column` (warn): falta la columna `daily_logs.adjustment`
 *   (migración pendiente); las reservas no caducan. Una vez por proceso.
 * - `settle_outcome_failed` (warn): `settleDay` no pudo guardar `lastOutcome`;
 *   solo se pierde la nota de la tarjeta "Balance de hoy".
 * - `plan_cas_exhausted` (warn): cinco escrituras seguidas de la fila del mes
 *   chocaron con otra (`updatePlanRowCas`) y se devolvió un error. Suelto es una
 *   carrera normal; repetido, algo reescribe el plan en bucle.
 * - `daily_cas_exhausted` (warn): lo mismo con la fila `daily_logs` de un día
 *   (`updateDailyLogCas`); `columns` dice qué se intentaba escribir.
 * - `ai_step_no_time` (warn): una llamada al modelo no se hizo (o no se
 *   reintentó) porque no quedaba presupuesto en la petición (`deadline.ts`).
 *   Suelto es una petición lenta; repetido, un paso tarda más de lo previsto.
 * - `chat_body_rejected` (warn): el cuerpo de `/api/chat` no pasó
 *   `cleanChatBody` (`reason`). Con `CHAT_BODY_ENFORCE` sin poner solo se
 *   registra; uno legítimo significa que un tope de `CHAT_LIMITS` es corto.
 * - `chat_profile_read_failed` (warn): `/api/chat` no pudo leer el perfil y usó
 *   el que mandó el cliente.
 * - `signup_weak_password_mismatch` (error): `generateLink` rechazó por débil
 *   una contraseña que `passwordProblem` aceptó: el panel de Supabase Auth y
 *   `PASSWORD_RULES` se han desalineado, y el alta no manda el correo.
 */
import { redactFields } from "@/lib/log-redact";
import { captureServerEvent } from "@/lib/sentry.server";

export type LogLevel = "info" | "warn" | "error";

/**
 * Texto de un error para un campo de log. Hace falta porque los errores de
 * Supabase son objetos planos con una clave `message`, que `redactFields`
 * taparía.
 */
export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Además del log, van a Sentry (ticket 35): todo `error` y estos `warn`, que
 * suelen avisar de algo que se repite (el catálogo de arriba dice cuándo).
 */
const SENTRY_WARN_EVENTS = new Set(["plan_cas_exhausted", "daily_cas_exhausted"]);

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
  if (level === "error" || (level === "warn" && SENTRY_WARN_EVENTS.has(event))) {
    captureServerEvent(level, event, redactFields(fields));
  }
}
