/**
 * Variables de entorno con respaldo. Un respaldo en producción deja
 * `env_missing` en el log: funciona, pero hay que definir la variable.
 */
import { logEvent } from "@/lib/log.server";

/** URL pública para los enlaces de los correos. En producción nunca cae a localhost. */
export function publicUrl(): string {
  const explicit = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  // Variable de sistema de Vercel: el dominio de producción, sin protocolo.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && vercel) {
    // `variable` y no `name`: `name` es una de las claves que el log tapa.
    logEvent("error", "env_missing", {
      variable: "PUBLIC_URL",
      fallback: "VERCEL_PROJECT_PRODUCTION_URL",
    });
    return `https://${vercel}`;
  }
  return "http://localhost:8080";
}

/**
 * Remitente de los correos. Sin dominio verificado en Resend hay que usar
 * `onboarding@resend.dev`, que **solo entrega a la dirección con la que se
 * registró la cuenta de Resend**; para enviar a cualquier persona hace falta
 * verificar un dominio y ponerlo en `RESEND_FROM`.
 */
const DEFAULT_EMAIL_FROM = "Peppers <onboarding@resend.dev>";

/**
 * Remitente de los correos de acceso. En producción el respaldo no sirve: Resend
 * rechaza el envío con 403 y nadie recibe su enlace. Una variable mal escrita
 * (`RESEND_FORM`) dio ese fallo sin ningún otro aviso.
 */
export function emailFrom(): string {
  const explicit = process.env.RESEND_FROM;
  if (explicit) return explicit;
  if (process.env.VERCEL_ENV === "production") {
    logEvent("error", "env_missing", {
      variable: "RESEND_FROM",
      fallback: "onboarding@resend.dev",
    });
  }
  return DEFAULT_EMAIL_FROM;
}

/** Contacto del remitente de las notificaciones push (VAPID `sub`). */
export function vapidContact(): string {
  return process.env.VAPID_CONTACT || "mailto:vgorinam@gmail.com";
}
