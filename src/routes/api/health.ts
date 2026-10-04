import { createFileRoute } from "@tanstack/react-router";

import { waitUntilVia } from "@/lib/after-response.server";
import { cronSecretMatches } from "@/lib/cron-secret.server";

// Comprobación de vida para un monitor externo. No toca la base de datos ni la
// IA: responde aunque Supabase u OpenRouter estén caídos, y no gasta nada. Con
// el secreto del cron dice además qué variables de entorno están definidas
// (solo sí/no, nunca su valor) y por qué puente se mantiene viva la función
// tras responder (`waitUntil`: "request", "vercel-context" o "none" por cada
// camino, ticket 15).

/**
 * Lo justo para saber, sin leer los logs de Vercel, por qué no sale un correo
 * de acceso: el dominio del remitente (si no está verificado en la cuenta de
 * Resend, Resend rechaza con 403 antes de registrar el envío) y una huella de
 * la clave (8 hex de su SHA-256) para compararla con la del `.env` local y
 * saber si las dos son de la misma cuenta. Ni la clave ni el remitente entero.
 */
async function emailConfig() {
  const from = process.env.RESEND_FROM;
  const key = process.env.RESEND_API_KEY;
  let keyFingerprint: string | null = null;
  if (key) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    keyFingerprint = Array.from(new Uint8Array(digest).slice(0, 4), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }
  return {
    fromDomain: from ? (from.match(/@([^>\s]+)/)?.[1] ?? "(sin @)") : null,
    keyFingerprint,
  };
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const body: Record<string, unknown> = {
          ok: true,
          version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
        };
        if (await cronSecretMatches(request.headers.get("x-cron-secret"))) {
          const has = (...names: string[]) => names.every((n) => Boolean(process.env[n]));
          body.env = {
            supabase: has("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"),
            serviceRole: has("SUPABASE_SERVICE_ROLE_KEY"),
            openrouter: has("OPENROUTER_API_KEY"),
            resend: has("RESEND_API_KEY"),
            vapid: has("VAPID_PRIVATE_KEY"),
            cron: has("CRON_SECRET"),
            publicUrl: has("PUBLIC_URL"),
            usda: has("USDA_FDC_API_KEY"),
            rateLimitSalt: has("RATE_LIMIT_SALT"),
            // Interruptores que se encienden solo con configuración: sin esto
            // no hay forma de saber desde fuera si el despliegue los ha leído.
            aiGlobalCap: has("AI_GLOBAL_DAILY_USD"),
            chatBodyEnforce: process.env.CHAT_BODY_ENFORCE === "1",
            sentry: has("SENTRY_DSN", "VITE_SENTRY_DSN"),
          };
          body.email = await emailConfig();
          // `route`: la petición que recibe la ruta (chat). `current`: la de
          // `getRequest()`, la que usa quien no la tiene a mano (Sentry).
          body.waitUntil = { route: waitUntilVia(request), current: waitUntilVia() };
        }
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
