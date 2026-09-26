import { buildPushHTTPRequest, type PushSubscription } from "@pushforge/builder";

import { logEvent } from "@/lib/log.server";
import { classifyPushResponse } from "@/lib/push-response";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

/**
 * Envía una notificación push a una única suscripción.
 *
 * `@pushforge/builder` usa solo Web Crypto API (a diferencia del `web-push` de
 * npm, que depende de `crypto.createECDH()` — no soportado en Cloudflare
 * Workers ni con `nodejs_compat`), así que esto funciona igual en local y en
 * el Worker desplegado.
 *
 * Devuelve `"gone"` cuando el servicio de push confirma que la suscripción ya
 * no es válida (404/410 — el navegador la revocó), señal estándar de que hay
 * que borrar esa fila; `"sent"` si lo aceptó (2xx) y `"failed"` con cualquier
 * otro rechazo (ver `classifyPushResponse`).
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<"sent" | "gone" | "failed"> {
  const privateJWK = process.env.VAPID_PRIVATE_KEY;
  if (!privateJWK) throw new Error("Falta VAPID_PRIVATE_KEY");

  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK,
    subscription,
    message: {
      payload,
      adminContact: "mailto:vgorinam@gmail.com",
      options: { ttl: 3600, urgency: "normal" },
    },
  });

  const response = await fetch(endpoint, { method: "POST", headers, body });
  const result = classifyPushResponse(response.status);
  if (result === "failed") {
    logEvent("warn", "push_failed", {
      status: response.status,
      host: new URL(endpoint).hostname,
      // `response` y no `body`: `body` es una de las claves que el log tapa.
      response: (await response.text().catch(() => "")).slice(0, 200),
    });
  }
  return result;
}
