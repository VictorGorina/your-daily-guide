import { createFileRoute } from "@tanstack/react-router";

import { getRequestUserId, unauthorized } from "@/lib/api-auth.server";

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getRequestUserId(request);
        if (!userId) return unauthorized();

        const body = (await request.json()) as {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        };
        if (!body.endpoint || !body.keys?.p256dh || !body.keys.auth) {
          return new Response("Suscripción incompleta", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Upsert por endpoint: si el mismo navegador se vuelve a suscribir
        // (p.ej. tras borrar y recrear la suscripción) no duplicamos fila.
        const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
          {
            user_id: userId,
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
          },
          { onConflict: "endpoint" },
        );
        if (error) return new Response(error.message, { status: 500 });

        return new Response(null, { status: 204 });
      },
    },
  },
});
