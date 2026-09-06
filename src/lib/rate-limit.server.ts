import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RateLimitError } from "@/lib/rate-limit-error";

/**
 * Cuota por persona y operación, contra la tabla `rate_limits` (ver la
 * migración `rate_limits`). Protege sobre todo lo que cuesta dinero: cada
 * generación de plan, guía, receta o mensaje al coach es una llamada de pago a
 * OpenRouter, y hasta ahora cualquier cuenta con sesión podía dispararlas sin
 * tope.
 *
 * Los límites están puestos con holgura: no buscan racionarle el uso a nadie,
 * solo poner un techo a lo que una sola cuenta puede gastar en una hora. Si a
 * alguien le queda corto, se sube aquí sin tocar la base de datos.
 *
 * Este módulo importa `client.server` arriba del todo (permitido en un
 * `.server.ts`), así que desde un `*.functions.ts` hay que cargarlo con
 * `await import(...)` dentro del handler, nunca con un import estático: esos
 * archivos también se empaquetan para el navegador.
 */
const HOUR = 3600;

const RATE_LIMITS = {
  chat: { limit: 60, windowSeconds: HOUR, action: "hablar con el coach" },
  "plan-generate": { limit: 8, windowSeconds: HOUR, action: "generar el plan" },
  "plan-adjust": { limit: 30, windowSeconds: HOUR, action: "reajustar el plan" },
  guide: { limit: 30, windowSeconds: HOUR, action: "pedir la guía de hoy" },
  "onboarding-parse": { limit: 30, windowSeconds: HOUR, action: "guardar tus respuestas" },
  receipt: { limit: 20, windowSeconds: HOUR, action: "escanear un tiquet" },
  recipe: { limit: 40, windowSeconds: HOUR, action: "pedir una receta" },
  "coach-aux": { limit: 40, windowSeconds: HOUR, action: "pedirle esto al coach" },
  // Sin sesión y por correo, no por cuenta. Se suma al freno de 60 s que ya hay
  // en memoria en `requestPasswordReset`.
  "password-reset": { limit: 5, windowSeconds: HOUR, action: "pedir el enlace" },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type Consumed = { allowed: boolean; retryAfterSeconds: number };

async function consume(subject: string, bucket: RateLimitBucket): Promise<Consumed> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    _subject: subject,
    _bucket: bucket,
    _limit: limit,
    _window_seconds: windowSeconds,
  });

  if (error) {
    // Se deja pasar a propósito. Si la tabla no existe todavía (migración sin
    // aplicar) o la base de datos falla, cerrar el paso dejaría la app sin
    // coach, sin plan y sin guía: convertiríamos un problema de infraestructura
    // en una caída de producto. Queda en el log para que se vea, porque
    // mientras esto falle no hay tope de gasto.
    console.error("consume_rate_limit", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: row.allowed !== false,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
  };
}

/**
 * Cuota de una cuenta con sesión. Lanza `RateLimitError` (HTTP 429) cuando se
 * ha pasado, con el mensaje ya escrito para enseñarlo en pantalla.
 *
 * `userId` sale siempre del `sub` del JWT ya verificado por
 * `requireSupabaseAuth`, nunca del cuerpo de la petición: si lo eligiera quien
 * llama, podría gastarle la cuota a otra persona.
 */
export async function enforceUserRateLimit(userId: string, bucket: RateLimitBucket): Promise<void> {
  const { allowed, retryAfterSeconds } = await consume(`user:${userId}`, bucket);
  if (!allowed) throw new RateLimitError(retryAfterSeconds, RATE_LIMITS[bucket].action);
}

/** SHA-256 en hexadecimal con Web Crypto, que es lo único que hay garantizado
 *  en el runtime de despliegue (el mismo motivo por el que las push usan
 *  @pushforge/builder). */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cuota de algo que se pide sin sesión, contada por correo. Devuelve si pasa en
 * vez de lanzar: quien la usa (recuperar contraseña) responde siempre lo mismo
 * exista o no la cuenta, y un error distinto rompería esa promesa.
 *
 * El correo se guarda hasheado, así que la tabla no acumula direcciones en
 * claro ni dice quién tiene cuenta.
 */
export async function checkEmailRateLimit(
  email: string,
  bucket: RateLimitBucket,
): Promise<boolean> {
  const hashed = await sha256Hex(email.trim().toLowerCase());
  const { allowed } = await consume(`email:${hashed}`, bucket);
  return allowed;
}
