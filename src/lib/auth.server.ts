import type { AuthPlatform } from "@/lib/auth.functions";
import { errorText, logEvent } from "@/lib/log.server";
import { assertHuman } from "@/lib/turnstile.server";

/**
 * Cuerpos de `requestPasswordReset` y `requestSignupConfirmation`
 * (`auth.functions.ts`), aparte para poder probarlos (ticket 15). `deps` deja
 * cambiar el envío del correo en los tests.
 */
export type AuthEmailDeps = {
  sendEmail?: typeof import("@/lib/email.server").sendEmail;
  /** Tiempo mínimo de respuesta; los tests lo bajan a 0. */
  minResponseMs?: number;
  /** Comprobación del CAPTCHA (`turnstile.server.ts`); los tests la cambian. */
  assertHuman?: typeof assertHuman;
};

/**
 * Tiempo mínimo de cualquier respuesta de estas dos funciones (SEC-S-10). Solo
 * hay correo cuando la cuenta existe (o, en el alta, cuando ya existía): si la
 * respuesta tardase lo que tarda el envío, su tiempo diría quién tiene cuenta.
 * Con un suelo fijo, bastante por encima de lo que tarda Resend, todas tardan
 * igual. No se manda en segundo plano con `waitUntil`: en producción el envío
 * se perdía al responder (ticket 15, verificado contra el registro de Resend).
 */
const MIN_RESPONSE_MS = 2_000;

/**
 * Marca de los enlaces pedidos desde el móvil. El dominio solo está asociado a
 * la app para las URLs que la llevan (`.well-known/apple-app-site-association`),
 * así los enlaces de la web no abren la app. La página web la ignora.
 */
const MOBILE_LINK_MARK = "?app=1";

async function atLeast<T>(ms: number, body: () => Promise<T>): Promise<T> {
  const [result] = await Promise.all([body(), new Promise((r) => setTimeout(r, ms))]);
  return result;
}

/** Espera el envío; un fallo queda en el log y la respuesta sigue siendo `ok`. */
async function sendLogged(
  kind: "reset" | "signup" | "already-registered",
  send: () => Promise<void>,
): Promise<void> {
  await send().catch((error: unknown) => {
    logEvent("error", "email_send_failed", { kind, error: errorText(error) });
  });
}

/**
 * Momento del último envío por correo, para no permitir que se pida un enlace
 * detrás de otro. Es memoria del proceso: en serverless cada instancia tiene la
 * suya, así que solo frena el caso normal (alguien pulsando repetido).
 *
 * El freno que sí aguanta un ataque repartido entre instancias es
 * `checkEmailRateLimit` (tabla `rate_limits`), unas líneas más abajo. Este de
 * aquí se queda porque es gratis y ahorra la ida y vuelta a la base de datos en
 * el caso más común.
 */
export function createSendThrottle(intervalMs: number, maxEntries: number) {
  const lastSentAt = new Map<string, number>();
  return {
    /**
     * ¿Ha pasado ya el minuto de espera para esta operación y este correo? La
     * clave lleva la operación además del correo: pedir el enlace de
     * contraseña no debe bloquear el reenvío de la confirmación.
     */
    throttled(bucket: string, email: string): boolean {
      const now = Date.now();
      // Sin límite, muchos correos distintos lo hacían crecer sin fin (ARQ-03).
      // Una clave solo entra cuando no está, así que el orden de inserción es
      // el del tiempo: se borra desde la más antigua hasta la primera que aún
      // frena, sin recorrer el resto.
      for (const [key, at] of lastSentAt) {
        if (now - at < intervalMs) break;
        lastSentAt.delete(key);
      }
      const key = `${bucket}:${email}`;
      if (lastSentAt.has(key)) return true;
      // Tope duro (solo con miles de correos distintos por minuto): sale la más
      // antigua. Frenar de verdad un abuso es cosa de `checkEmailRateLimit`.
      if (lastSentAt.size >= maxEntries) {
        const oldest = lastSentAt.keys().next().value;
        if (oldest !== undefined) lastSentAt.delete(oldest);
      }
      lastSentAt.set(key, now);
      return false;
    },
    get size(): number {
      return lastSentAt.size;
    },
  };
}

const sendThrottle = createSendThrottle(60_000, 10_000);
const throttled = (bucket: string, email: string) => sendThrottle.throttled(bucket, email);

export async function requestPasswordResetHandler(
  data: { email: string; platform: AuthPlatform; captchaToken?: string },
  deps: AuthEmailDeps = {},
): Promise<{ ok: true }> {
  return atLeast(deps.minResponseMs ?? MIN_RESPONSE_MS, async () => {
    const { email, platform } = data;

    // Antes que nada: un robot no gasta ni la cuota del correo. El fallo no
    // depende de si la cuenta existe, así que no delata nada (ticket 29).
    await (deps.assertHuman ?? assertHuman)(data.captchaToken, "password-reset");

    // La respuesta es siempre la misma exista o no la cuenta. Si dijéramos
    // "ese correo no está registrado" convertiríamos esto en un buscador de
    // quién tiene cuenta. Es la misma política que aplica Supabase.
    const ok = { ok: true as const };

    if (throttled("password-reset", email)) return ok;

    // Cuota compartida entre instancias, contada por correo (hasheado). Se
    // responde `ok` igual que siempre: un error distinto delataría cuáles ya
    // han pedido enlaces, que es justo lo que evita esta función.
    const { checkEmailRateLimit } = await import("@/lib/rate-limit.server");
    if (!(await checkEmailRateLimit(email, "password-reset"))) return ok;

    // El destino NO se acepta del cliente: se elige aquí a partir de `platform`.
    // Un `redirectTo` libre convertiría esto en un redirector abierto con un
    // token de sesión en la URL — justo lo que evita `safeInternalPath` en las
    // rutas de la web.
    const publicUrl = (await import("@/lib/env.server")).publicUrl();
    // El móvil, por Universal Link (`?app=1`, ver `apple-app-site-association`):
    // con la app instalada la abre; sin ella, es la misma página de la web.
    const redirectTo = `${publicUrl}/restablecer${platform === "mobile" ? MOBILE_LINK_MARK : ""}`;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const emails = await import("@/lib/email.server");
      const sendEmail = deps.sendEmail ?? emails.sendEmail;

      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      // Cuenta inexistente entre otros casos: se calla y se responde igual.
      if (error || !link?.properties?.action_link) return ok;

      const { subject, html } = emails.passwordResetEmail(link.properties.action_link);
      await sendLogged("reset", () => sendEmail({ to: email, subject, html }));
    } catch (error) {
      // El motivo real (un fallo de `generateLink` o de la plantilla; el del
      // correo lo registra `sendLogged`) queda en el log del servidor, nunca
      // en la respuesta: revelaría configuración y además diría si la cuenta existe.
      console.error("requestPasswordReset", error);
    }

    return ok;
  });
}

export async function requestSignupConfirmationHandler(
  data: {
    email: string;
    password: string;
    platform: AuthPlatform;
    next?: string;
    captchaToken?: string;
  },
  deps: AuthEmailDeps = {},
): Promise<{ ok: true }> {
  return atLeast(deps.minResponseMs ?? MIN_RESPONSE_MS, async () => {
    const { email, password, platform, next } = data;

    await (deps.assertHuman ?? assertHuman)(data.captchaToken, "signup-confirm");

    // Igual que en el reset: la respuesta no cambia exista o no la cuenta, para
    // no convertir el alta en un buscador de quién está registrado.
    const ok = { ok: true as const };

    if (throttled("signup-confirm", email)) return ok;

    const { checkEmailRateLimit } = await import("@/lib/rate-limit.server");
    if (!(await checkEmailRateLimit(email, "signup-confirm"))) return ok;

    // El destino lo decide el servidor, nunca el cliente: un `redirectTo` libre
    // sería un redirector abierto con el token de confirmación en la URL. `next`
    // sí viene del cliente, pero solo se acepta si es una ruta interna.
    const publicUrl = (await import("@/lib/env.server")).publicUrl();
    const redirectTo =
      platform === "mobile"
        ? `${publicUrl}/confirmado${MOBILE_LINK_MARK}`
        : `${publicUrl}/confirmado${next ? `?next=${encodeURIComponent(next)}` : ""}`;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const emails = await import("@/lib/email.server");
      const sendEmail = deps.sendEmail ?? emails.sendEmail;

      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { redirectTo },
      });
      if (error || !link?.properties?.action_link) {
        // Cuenta ya confirmada entre otros casos posibles: generateLink no
        // tiene enlace de alta que dar. La respuesta a quien lo pidió sigue
        // siendo "ok" (política antienumeración de siempre — nunca se le dice
        // "ya tienes cuenta"), pero dejarlo esperando un correo que no va a
        // llegar es un callejón sin salida. Si el motivo es justo ese, se
        // avisa en su lugar a quien SÍ tiene la cuenta.
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "weak_password") {
          const { logEvent } = await import("@/lib/log.server");
          logEvent("error", "signup_weak_password_mismatch", {});
        }
        if (code === "email_exists" || code === "user_already_exists") {
          const { subject, html } = emails.alreadyRegisteredEmail(`${publicUrl}/auth`);
          await sendLogged("already-registered", () => sendEmail({ to: email, subject, html }));
        }
        return ok;
      }

      const { subject, html } = emails.signupConfirmationEmail(link.properties.action_link);
      await sendLogged("signup", () => sendEmail({ to: email, subject, html }));
    } catch (error) {
      // El motivo real queda en el log del servidor, nunca en la respuesta.
      console.error("requestSignupConfirmation", error);
    }

    return ok;
  });
}
