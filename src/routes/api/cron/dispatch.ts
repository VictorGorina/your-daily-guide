import { createFileRoute } from "@tanstack/react-router";

import { dispatchPush } from "@/lib/push-dispatch.server";

// Sin auth de usuario: lo llama el workflow programado de GitHub Actions (ver
// .github/workflows/push-dispatch.yml y AGENTS.md), no un navegador con
// sesión. Se protege con un secreto compartido en vez de un token de sesión.
export const Route = createFileRoute("/api/cron/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret || request.headers.get("x-cron-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const summary = await dispatchPush();
          return new Response(JSON.stringify(summary), {
            headers: { "content-type": "application/json" },
          });
        } catch (error) {
          console.error("POST /api/cron/dispatch", error);
          return new Response("Error al despachar notificaciones", { status: 500 });
        }
      },
    },
  },
});
