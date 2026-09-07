import { createServerFn } from "@tanstack/react-start";

import { ValidationError } from "@/lib/validation-error";

/** A dónde lleva el enlace del correo según desde dónde se pidió. */
export type AuthPlatform = "web" | "mobile";

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

/**
 * Ruta interna a la que volver tras confirmar, si venía una. Solo rutas del
 * propio sitio: un destino libre convertiría el enlace del correo en un
 * redirector abierto. Es la versión de servidor de `safeInternalPath`, que no
 * sirve aquí porque necesita `window`.
 */
function safeNextPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  return raw;
}

/**
 * Pide el correo con el enlace para crear una contraseña nueva.
 *
 * No usa `supabase.auth.resetPasswordForEmail`: ese camino delega el envío en el
 * SMTP configurado en el panel de Supabase, que además de estar fuera de nuestro
 * control oculta el motivo cuando falla. Aquí generamos el enlace con la API de
 * administración (que NO envía nada) y lo mandamos nosotros con nuestra propia
 * plantilla (ver email.server.ts).
 *
 * Sin middleware de sesión a propósito: quien ha perdido la contraseña no la
 * tiene.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: { email: string; platform?: AuthPlatform }) => {
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) throw new ValidationError("Necesitamos un correo válido");
    const platform: AuthPlatform = input?.platform === "mobile" ? "mobile" : "web";
    return { email, platform };
  })
  .handler(async ({ data }) => {
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
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:8080";
    const redirectTo =
      platform === "mobile" ? "dailyguide://restablecer" : `${publicUrl}/restablecer`;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { sendEmail, passwordResetEmail } = await import("@/lib/email.server");

      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      // Cuenta inexistente entre otros casos: se calla y se responde igual.
      if (error || !link?.properties?.action_link) return ok;

      const { subject, html } = passwordResetEmail(link.properties.action_link);
      await sendEmail({ to: email, subject, html });
    } catch (error) {
      // El motivo real (p. ej. el rechazo textual de Resend) queda en el log del
      // servidor, nunca en la respuesta: revelaría configuración y además diría
      // si la cuenta existe.
      console.error("requestPasswordReset", error);
    }

    return ok;
  });

/**
 * Manda el correo de confirmación de una cuenta nueva — y sirve también para
 * reenviarlo cuando quedó sin confirmar.
 *
 * No usa `supabase.auth.signUp()` desde el cliente: ese camino delega el envío
 * en el SMTP de Supabase, con su plantilla genérica y un remitente que no es el
 * nuestro, y así es como el correo del alta acababa en spam mientras el de
 * recuperación (que ya iba por aquí) llegaba bien. Generamos el enlace con la
 * API de administración —que NO envía nada— y lo mandamos con nuestra plantilla.
 *
 * Un mismo camino para el alta y para el reenvío porque en GoTrue son la misma
 * operación: si la cuenta no existe la crea, y si existe **sin confirmar**
 * devuelve un enlace nuevo. Con una cuenta ya confirmada falla, y entonces esta
 * función se calla — es la política antienumeración de siempre.
 *
 * Sin middleware de sesión a propósito: todavía no hay cuenta con la que
 * autenticarse.
 */
export const requestSignupConfirmation = createServerFn({ method: "POST" })
  .validator(
    (input: { email: string; password: string; platform?: AuthPlatform; next?: string }) => {
      const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
      if (!email || !email.includes("@")) throw new ValidationError("Necesitamos un correo válido");
      const password = typeof input?.password === "string" ? input.password : "";
      if (password.length < 6) {
        throw new ValidationError("La contraseña necesita al menos 6 caracteres");
      }
      const platform: AuthPlatform = input?.platform === "mobile" ? "mobile" : "web";
      return { email, password, platform, next: safeNextPath(input?.next) };
    },
  )
  .handler(async ({ data }) => {
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
    const publicUrl = process.env.PUBLIC_URL || "http://localhost:8080";
    const redirectTo =
      platform === "mobile"
        ? "dailyguide://confirmado"
        : `${publicUrl}/confirmado${next ? `?next=${encodeURIComponent(next)}` : ""}`;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { sendEmail, signupConfirmationEmail } = await import("@/lib/email.server");

      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { redirectTo },
      });
      // Cuenta ya confirmada entre otros casos: se calla y se responde igual.
      if (error || !link?.properties?.action_link) return ok;

      const { subject, html } = signupConfirmationEmail(link.properties.action_link);
      await sendEmail({ to: email, subject, html });
    } catch (error) {
      // El motivo real queda en el log del servidor, nunca en la respuesta.
      console.error("requestSignupConfirmation", error);
    }

    return ok;
  });
