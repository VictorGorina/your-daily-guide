/**
 * Envío de correo por la API HTTP de Resend.
 *
 * No usamos el SMTP propio de Supabase Auth: al fallar, Supabase devuelve un
 * `unexpected_failure` genérico ("Error sending recovery email") y se traga el
 * motivo real del proveedor, así que no hay forma de saber si fue el dominio sin
 * verificar, la clave caducada o la cuota. Enviando nosotros vemos la respuesta
 * de Resend y registramos su código de error (`email_send_failed`).
 *
 * Es HTTP, no SMTP, a propósito: el runtime de despliegue no tiene sockets TCP
 * crudos, igual que pasaba con las notificaciones push (ver web-push.server.ts).
 */
import { logEvent } from "@/lib/log.server";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Remitente. Sin dominio verificado en Resend hay que usar `onboarding@resend.dev`,
 * que **solo entrega a la dirección con la que se registró la cuenta de Resend**;
 * para enviar a cualquier persona hace falta verificar un dominio y ponerlo en
 * `RESEND_FROM`.
 */
const DEFAULT_FROM = "Peppers <onboarding@resend.dev>";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Envía un correo. Si Resend lo rechaza, deja `email_send_failed` con el código
 * HTTP y el código de error de Resend (`name`, p. ej. `validation_error`) y
 * lanza solo con el código HTTP: el cuerpo de la respuesta puede traer la
 * dirección de correo, y eso no va a los logs.
 */
export async function sendEmail({ to, subject, html }: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Falta RESEND_API_KEY");

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { name?: unknown } | null;
    logEvent("error", "email_send_failed", {
      status: response.status,
      resendError: typeof detail?.name === "string" ? detail.name : undefined,
    });
    throw new Error(`Resend ${response.status}`);
  }
}

/**
 * Envoltorio común de los correos, con la paleta de la app (ver
 * docs/design-guidelines.md). Los estilos van en línea porque los clientes de
 * correo ignoran las hojas de estilo, y el enlace se repite como texto plano
 * abajo para quien no pueda pulsar el botón.
 *
 * Está compartido a propósito: el de recuperación y el de confirmación se
 * mandan por caminos distintos, y si cada uno llevara su propio HTML acabarían
 * pareciendo correos de dos productos.
 */
function emailShell({
  title,
  body,
  cta,
  actionLink,
  footer,
}: {
  title: string;
  body: string;
  cta: string;
  actionLink: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:32px 16px;background:#f3f1ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#3e3d39;">
    <div style="max-width:480px;margin:0 auto;background:#fbfaf7;border-radius:24px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:#3e3d39;">${title}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#83796c;">
        ${body}
      </p>
      <a href="${actionLink}" style="display:block;padding:16px 24px;background:#ff8a3d;color:#fbfaf7;text-decoration:none;border-radius:999px;font-size:15px;font-weight:600;text-align:center;">
        ${cta}
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#83796c;">
        ${footer}
      </p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#83796c;word-break:break-all;">
        ¿No funciona el botón? Copia esta dirección en tu navegador:<br />${actionLink}
      </p>
    </div>
  </body>
</html>`;
}

/** Cuerpo del correo de recuperación de contraseña. */
export function passwordResetEmail(actionLink: string): { subject: string; html: string } {
  return {
    subject: "Recupera tu acceso a Peppers",
    html: emailShell({
      title: "Recupera tu acceso",
      body: "Has pedido crear una contraseña nueva. Pulsa el botón y elige una: el enlace caduca en una hora y solo se puede usar una vez.",
      cta: "Crear contraseña nueva",
      actionLink,
      footer: "Si no has sido tú, puedes ignorar este correo: tu contraseña seguirá igual.",
    }),
  };
}

/**
 * Cuerpo del correo de confirmación de alta.
 *
 * Lo mandamos nosotros en vez de dejárselo al SMTP de Supabase por el mismo
 * motivo que el de recuperación, más uno propio: la plantilla genérica de
 * Supabase, enviada desde un dominio que no es el nuestro, acababa en spam.
 */
export function signupConfirmationEmail(actionLink: string): { subject: string; html: string } {
  return {
    subject: "Confirma tu cuenta de Peppers",
    html: emailShell({
      title: "Ya casi estás",
      body: "Pulsa el botón para confirmar tu correo y entrar en Peppers. El enlace caduca en una hora y solo se puede usar una vez.",
      cta: "Confirmar mi cuenta",
      actionLink,
      footer: "Si no has creado ninguna cuenta, puedes ignorar este correo.",
    }),
  };
}

/**
 * Aviso a quien YA tiene una cuenta confirmada, cuando alguien intenta darse
 * de alta otra vez con su correo. `requestSignupConfirmation` responde igual
 * (`{ok: true}`, "mira tu correo") tanto si la cuenta existe como si no —es
 * la política antienumeración— así que sin este correo la persona que
 * intentaba entrar se quedaba esperando un enlace que nunca llegaba, sin
 * ninguna pista de que ya tenía cuenta. Este correo no lleva token: solo
 * enlaza a la pantalla de entrar, así que no delata nada que este mismo
 * intento de alta no delatara ya al dueño real de la cuenta.
 */
export function alreadyRegisteredEmail(signInLink: string): { subject: string; html: string } {
  return {
    subject: "Alguien ha intentado crear una cuenta con tu correo",
    html: emailShell({
      title: "Ya tienes cuenta en Peppers",
      body: "Alguien ha intentado crear una cuenta nueva con este correo, pero ya tienes una. Si has sido tú, entra con tu contraseña de siempre.",
      cta: "Entrar en Peppers",
      actionLink: signInLink,
      footer: "Si no has sido tú, puedes ignorar este correo: tu cuenta sigue igual de segura.",
    }),
  };
}
