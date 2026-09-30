import { createFileRoute } from "@tanstack/react-router";

import { cronSecretMatches } from "@/lib/cron-secret.server";
import { errorText, logEvent } from "@/lib/log.server";
import { dispatchPush } from "@/lib/push-dispatch.server";

// Sin auth de usuario: lo llama el workflow programado de GitHub Actions (ver
// .github/workflows/push-dispatch.yml y AGENTS.md), no un navegador con
// sesión. Se protege con un secreto compartido en vez de un token de sesión.
export const Route = createFileRoute("/api/cron/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // En tiempo constante y con longitud mínima (ticket 06, SEC-S-13).
        if (!(await cronSecretMatches(request.headers.get("x-cron-secret")))) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const summary = await dispatchPush();
          return new Response(JSON.stringify(summary), {
            headers: { "content-type": "application/json" },
          });
        } catch (error) {
          logEvent("error", "push_dispatch_failed", { error: errorText(error) });
          return new Response("Error al despachar notificaciones", { status: 500 });
        }
      },
    },
  },
});
