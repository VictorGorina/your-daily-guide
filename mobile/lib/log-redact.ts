/**
 * Limpieza de los campos de un log antes de escribirlo (ver `logEvent` en
 * `log.server.ts`). Puro y testeado: lo que sale de aquí acaba en los logs de
 * Vercel, que no son sitio para datos personales ni de salud.
 */

/** Claves que nunca salen en un log, a cualquier profundidad. */
export const REDACTED_KEYS = new Set([
  "email",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "display_name",
  "name",
  "notes",
  "text",
  "content",
  "prompt",
  "body",
  "message",
  "medications",
  "medical_conditions",
  "ed_history",
  "pregnancy_status",
  "restrictions",
  "endpoint",
  "p256dh",
  "auth",
  "actual",
  "idea",
  "dish",
]);

const MAX_STRING = 200;
const MAX_DEPTH = 4;

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (value instanceof Error) return String(value).slice(0, MAX_STRING);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  return redactObject(value as Record<string, unknown>, depth);
}

function redactObject(fields: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redactValue(value, depth + 1);
  }
  return out;
}

/**
 * Copia `fields` sustituyendo las claves de `REDACTED_KEYS` por "[redacted]" y
 * recortando los strings a 200 caracteres. Recorre objetos y arrays hasta
 * profundidad 4; más allá, "[depth]". `userId` (UUID) sí sale: es seudónimo y
 * hace falta para investigar.
 */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactObject(fields, 0);
}
