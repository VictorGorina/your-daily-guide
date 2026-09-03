import { createServerFn } from "@tanstack/react-start";

import { ValidationError } from "@/lib/validation-error";

/** A dónde lleva el enlace del correo según desde dónde se pidió. */
export type ResetPlatform = "web" | "mobile";

/**
 * Momento del último envío por correo, para no permitir que se pida un enlace
 * detrás de otro. Es memoria del proceso: en serverless cada instancia tiene la
 * suya, así que frena el caso normal (alguien pulsando repetido) pero no un
 * ataque repartido. La defensa real es la cuota de Resend (backstop externo).
 *
 * TODO: cuando escale, reemplazar por rate-limiting de Vercel Edge o un campo
 * `last_reset_sent_at` en la tabla `profiles` (ojo: solo cubre cuentas
 * existentes; la función no confirma si el email existe a propósito, para no
 * facilitar la enumeración de cuentas).
 */
const lastSentAt = new Map<string, number>();
const MIN_INTERVAL_MS = 60_000;

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
  .validator((input: { email: string; platform?: ResetPlatform }) => {
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) throw new ValidationError("Necesitamos un correo válido");
    const platform: ResetPlatform = input?.platform === "mobile" ? "mobile" : "web";
    return { email, platform };
  })
  .handler(async ({ data }) => {
    const { email, platform } = data;

    // La respuesta es siempre la misma exista o no la cuenta. Si dijéramos
    // "ese correo no está registrado" convertiríamos esto en un buscador de
    // quién tiene cuenta. Es la misma política que aplica Supabase.
    const ok = { ok: true as const };

    const previous = lastSentAt.get(email);
    if (previous && Date.now() - previous < MIN_INTERVAL_MS) return ok;
    lastSentAt.set(email, Date.now());

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
