import { createFileRoute } from "@tanstack/react-router";

import { getRequestUserId, unauthorized } from "@/lib/api-auth.server";
import { errorText, logEvent } from "@/lib/log.server";
import { isAllowedPushEndpoint, MAX_PUSH_ENDPOINT_LENGTH } from "@/lib/push-endpoint";

// Suscripciones que se guardan por persona como mucho (una por navegador): las
// más antiguas sobran, y sin tope un bucle llenaría la tabla y el lote del cron.
const MAX_SUBSCRIPTIONS_PER_USER = 10;

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getRequestUserId(request);
        if (!userId) return unauthorized();

        let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Suscripción incompleta", { status: 400 });
        }
        const { endpoint } = body;
        const p256dh = body.keys?.p256dh;
        const auth = body.keys?.auth;
        if (
          typeof endpoint !== "string" ||
          typeof p256dh !== "string" ||
          typeof auth !== "string"
        ) {
          return new Response("Suscripción incompleta", { status: 400 });
        }

        // H-04 / ticket 06: solo servicios de push de verdad (FCM, Apple,
        // Mozilla, Windows). El cron hace `fetch` a esta URL.
        if (!isAllowedPushEndpoint(endpoint)) {
          return new Response("Endpoint no válido", { status: 400 });
        }
        if (
          [endpoint, p256dh, auth].some((v) => v.length > MAX_PUSH_ENDPOINT_LENGTH || v.length < 16)
        ) {
          return new Response("Claves fuera de rango", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Upsert por endpoint: si el mismo navegador se vuelve a suscribir
        // (p.ej. tras borrar y recrear la suscripción) no duplicamos fila.
        const { error } = await supabaseAdmin
          .from("push_subscriptions")
          .upsert({ user_id: userId, endpoint, p256dh, auth }, { onConflict: "endpoint" });
        if (error) {
          logEvent("error", "push_subscribe_failed", { error: errorText(error) });
          return new Response("Error al guardar la suscripción", { status: 500 });
        }

        // Tope por persona: se quedan las más recientes. Si falla, la
        // suscripción ya está guardada; sobrar alguna no rompe nada.
        const { data: own } = await supabaseAdmin
          .from("push_subscriptions")
          .select("id, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        const stale = (own ?? []).slice(MAX_SUBSCRIPTIONS_PER_USER).map((row) => row.id);
        if (stale.length) {
          await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .eq("user_id", userId)
            .in("id", stale);
        }

        return new Response(null, { status: 204 });
      },
    },
  },
});
