import { createFileRoute } from "@tanstack/react-router";

import { getRequestUserId, unauthorized } from "@/lib/api-auth.server";

export const Route = createFileRoute("/api/push/unsubscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getRequestUserId(request);
        if (!userId) return unauthorized();

        const body = (await request.json()) as { endpoint?: string };
        if (!body.endpoint) return new Response("Falta endpoint", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Filtra también por user_id: aunque supabaseAdmin salta RLS, así nos
        // aseguramos de que nadie borre la suscripción de otra persona.
        const { error } = await supabaseAdmin
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", body.endpoint)
          .eq("user_id", userId);
        if (error) return new Response(error.message, { status: 500 });

        return new Response(null, { status: 204 });
      },
    },
  },
});
