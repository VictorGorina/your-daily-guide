import { logEvent } from "@/lib/log.server";
import { ValidationError } from "@/lib/validation-error";

/**
 * CAPTCHA de Cloudflare Turnstile en el servidor (ticket 29 de la auditoría).
 *
 * El alta y el restablecimiento de contraseña generan su enlace con la API de
 * administración de Supabase, que NO pasa por el CAPTCHA del panel: el token
 * que manda el cliente se comprueba aquí. Entrar y la demo van del navegador
 * directo a Supabase, que lo comprueba él.
 *
 * Se enciende por pasos, para que una app que aún no manda token (la de iOS
 * hasta su build nativo) no se quede fuera:
 *
 * - Sin `TURNSTILE_SECRET_KEY`: no hace nada.
 * - Con la clave: el token que llega se comprueba; el que no llega se deja
 *   pasar y se anota (`captcha_missing`).
 * - Con `TURNSTILE_ENFORCE=1` además: sin token no se pasa.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;
export const CAPTCHA_FAILED_MESSAGE =
  "No hemos podido comprobar que eres una persona. Inténtalo de nuevo.";

export type CaptchaStep = "skip" | "verify" | "allow-missing" | "reject-missing";

/** Qué toca hacer con una petición, según la configuración y si trae token. */
export function captchaStep(config: {
  secretSet: boolean;
  enforce: boolean;
  hasToken: boolean;
}): CaptchaStep {
  if (!config.secretSet) return "skip";
  if (config.hasToken) return "verify";
  return config.enforce ? "reject-missing" : "allow-missing";
}

export type CaptchaVerdict = "human" | "rejected" | "unavailable";

/**
 * Pregunta a Cloudflare si el token es bueno. `unavailable` es que no se pudo
 * preguntar (red, 5xx, respuesta rara): no dice nada de la persona.
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptchaVerdict> {
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return "unavailable";
    const body = (await response.json()) as { success?: unknown };
    if (typeof body?.success !== "boolean") return "unavailable";
    return body.success ? "human" : "rejected";
  } catch {
    return "unavailable";
  }
}

/**
 * Corta con `ValidationError` si el CAPTCHA dice que no es una persona. Si
 * Cloudflare no contesta se deja pasar, como las cuotas: una caída suya no
 * debe dejar a nadie sin poder recuperar su contraseña. La cuota por correo
 * sigue detrás.
 */
export async function assertHuman(
  token: string | undefined,
  operation: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY ?? "";
  const step = captchaStep({
    secretSet: Boolean(secret),
    enforce: process.env.TURNSTILE_ENFORCE === "1",
    hasToken: Boolean(token),
  });
  if (step === "skip") return;
  if (step === "allow-missing") {
    logEvent("warn", "captcha_missing", { operation });
    return;
  }
  if (step === "reject-missing") {
    logEvent("warn", "captcha_rejected", { operation, reason: "missing" });
    throw new ValidationError(CAPTCHA_FAILED_MESSAGE);
  }
  const verdict = await verifyTurnstile(token as string, secret, fetchImpl);
  if (verdict === "human") return;
  if (verdict === "unavailable") {
    logEvent("error", "captcha_failopen", { operation });
    return;
  }
  logEvent("warn", "captcha_rejected", { operation, reason: "invalid" });
  throw new ValidationError(CAPTCHA_FAILED_MESSAGE);
}
