import { createFileRoute } from "@tanstack/react-router";

import { cronSecretMatches } from "@/lib/cron-secret.server";

// Comprobación de vida para un monitor externo. No toca la base de datos ni la
// IA: responde aunque Supabase u OpenRouter estén caídos, y no gasta nada. Con
// el secreto del cron dice además qué variables de entorno están definidas
// (solo sí/no, nunca su valor).
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
          };
        }
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
