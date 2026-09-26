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

/** Contacto del remitente de las notificaciones push (VAPID `sub`). */
export function vapidContact(): string {
  return process.env.VAPID_CONTACT || "mailto:vgorinam@gmail.com";
}
