/**
 * Envío de correo por la API HTTP de Resend.
 *
 * No usamos el SMTP propio de Supabase Auth: al fallar, Supabase devuelve un
 * `unexpected_failure` genérico ("Error sending recovery email") y se traga el
 * motivo real del proveedor, así que no hay forma de saber si fue el dominio sin
 * verificar, la clave caducada o la cuota. Enviando nosotros vemos la respuesta
 * de Resend tal cual y podemos registrarla.
 *
 * Es HTTP, no SMTP, a propósito: el runtime de despliegue no tiene sockets TCP
 * crudos, igual que pasaba con las notificaciones push (ver web-push.server.ts).
 */
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
 * Envía un correo. Lanza con el motivo textual de Resend si lo rechaza, para que
 * quien llama pueda registrarlo (nunca para enseñarlo en pantalla: viene en
 * inglés y puede filtrar detalles de configuración).
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
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail}`);
  }
}

/**
 * Cuerpo del correo de recuperación, con la paleta de la app (ver
 * docs/design-guidelines.md). Los estilos van en línea porque los clientes de
 * correo ignoran las hojas de estilo, y el enlace se repite como texto plano
 * abajo para quien no pueda pulsar el botón.
 */
export function passwordResetEmail(actionLink: string): { subject: string; html: string } {
  return {
    subject: "Recupera tu acceso a Peppers",
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:32px 16px;background:#f3f1ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#3e3d39;">
    <div style="max-width:480px;margin:0 auto;background:#fbfaf7;border-radius:24px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;color:#3e3d39;">Recupera tu acceso</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#83796c;">
        Has pedido crear una contraseña nueva. Pulsa el botón y elige una: el enlace caduca en una hora
        y solo se puede usar una vez.
      </p>
      <a href="${actionLink}" style="display:block;padding:16px 24px;background:#ff8a3d;color:#fbfaf7;text-decoration:none;border-radius:999px;font-size:15px;font-weight:600;text-align:center;">
        Crear contraseña nueva
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#83796c;">
        Si no has sido tú, puedes ignorar este correo: tu contraseña seguirá igual.
      </p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#83796c;word-break:break-all;">
        ¿No funciona el botón? Copia esta dirección en tu navegador:<br />${actionLink}
      </p>
    </div>
  </body>
</html>`,
  };
}
