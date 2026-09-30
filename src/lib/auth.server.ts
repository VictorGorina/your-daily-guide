import type { AuthPlatform } from "@/lib/auth.functions";

/**
 * Cuerpos de `requestPasswordReset` y `requestSignupConfirmation`
 * (`auth.functions.ts`), aparte para poder probarlos (ticket 15). `deps` deja
 * cambiar el envío del correo en los tests.
 */
export type AuthEmailDeps = {
  sendEmail?: typeof import("@/lib/email.server").sendEmail;
};

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
const lastSentAt = new Map<string, number>();
const MIN_INTERVAL_MS = 60_000;

/**
 * ¿Ha pasado ya el minuto de espera para esta operación y este correo? La clave
 * lleva la operación además del correo: pedir el enlace de contraseña no debe
 * bloquear el reenvío de la confirmación, que son cosas distintas.
 */
function throttled(bucket: string, email: string): boolean {
  const key = `${bucket}:${email}`;
  const previous = lastSentAt.get(key);
  if (previous && Date.now() - previous < MIN_INTERVAL_MS) return true;
  lastSentAt.set(key, Date.now());
  return false;
}

export async function requestPasswordResetHandler(
  data: { email: string; platform: AuthPlatform },
  deps: AuthEmailDeps = {},
): Promise<{ ok: true }> {
  const { email, platform } = data;

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
  const redirectTo =
    platform === "mobile" ? "dailyguide://restablecer" : `${publicUrl}/restablecer`;

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
    await sendEmail({ to: email, subject, html });
  } catch (error) {
    // El motivo real (p. ej. el rechazo textual de Resend) queda en el log del
    // servidor, nunca en la respuesta: revelaría configuración y además diría
    // si la cuenta existe.
    console.error("requestPasswordReset", error);
  }

  return ok;
}

export async function requestSignupConfirmationHandler(
  data: { email: string; password: string; platform: AuthPlatform; next?: string },
  deps: AuthEmailDeps = {},
): Promise<{ ok: true }> {
  const { email, password, platform, next } = data;

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
      ? "dailyguide://confirmado"
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
        await sendEmail({ to: email, subject, html }).catch((notifyError) => {
          console.error("requestSignupConfirmation:already-registered", notifyError);
        });
      }
      return ok;
    }

    const { subject, html } = emails.signupConfirmationEmail(link.properties.action_link);
    await sendEmail({ to: email, subject, html });
  } catch (error) {
    // El motivo real queda en el log del servidor, nunca en la respuesta.
    console.error("requestSignupConfirmation", error);
  }

  return ok;
}
