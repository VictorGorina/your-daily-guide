import { createServerFn } from "@tanstack/react-start";

import { passwordProblem } from "@/lib/auth-errors";
import { requestPasswordResetHandler, requestSignupConfirmationHandler } from "@/lib/auth.server";
import { cleanCaptchaToken } from "@/lib/turnstile";
import { ValidationError } from "@/lib/validation-error";

/** A dónde lleva el enlace del correo según desde dónde se pidió. */
export type AuthPlatform = "web" | "mobile";

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
  .validator((input: { email: string; platform?: AuthPlatform; captchaToken?: string }) => {
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) throw new ValidationError("Necesitamos un correo válido");
    const platform: AuthPlatform = input?.platform === "mobile" ? "mobile" : "web";
    return { email, platform, captchaToken: cleanCaptchaToken(input?.captchaToken) };
  })
  .handler(({ data }) => requestPasswordResetHandler(data));

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
    (input: {
      email: string;
      password: string;
      platform?: AuthPlatform;
      next?: string;
      captchaToken?: string;
    }) => {
      const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
      if (!email || !email.includes("@")) throw new ValidationError("Necesitamos un correo válido");
      const password = typeof input?.password === "string" ? input.password : "";
      if (passwordProblem(password)) {
        throw new ValidationError(
          "La contraseña necesita al menos 6 caracteres, con letras y números",
        );
      }
      const platform: AuthPlatform = input?.platform === "mobile" ? "mobile" : "web";
      return {
        email,
        password,
        platform,
        next: safeNextPath(input?.next),
        captchaToken: cleanCaptchaToken(input?.captchaToken),
      };
    },
  )
  .handler(({ data }) => requestSignupConfirmationHandler(data));
