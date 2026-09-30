import { buildPushHTTPRequest, type PushSubscription } from "@pushforge/builder";

import { vapidContact } from "@/lib/env.server";
import { logEvent } from "@/lib/log.server";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { classifyPushResponse } from "@/lib/push-response";

// Un servicio de push que no contesta no debe parar el lote entero (ticket 06).
const PUSH_TIMEOUT_MS = 10_000;

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

/**
 * Envía una notificación push a una única suscripción.
 *
 * `@pushforge/builder` usa solo Web Crypto API (a diferencia del `web-push` de
 * npm, que depende de `crypto.createECDH()`, ausente en algunos runtimes
 * serverless), así que funciona igual en local y en Vercel. Se eligió cuando
 * la app corría en Cloudflare Workers.
 *
 * Devuelve `"gone"` cuando el servicio de push confirma que la suscripción ya
 * no es válida (404/410 — el navegador la revocó), señal estándar de que hay
 * que borrar esa fila, y también con un endpoint que no es de un servicio de
 * push; `"sent"` si lo aceptó (2xx) y `"failed"` con cualquier otro rechazo
 * (ver `classifyPushResponse`), un tiempo agotado o un fallo de red.
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<"sent" | "gone" | "failed"> {
  // Segunda red tras la de `/api/push/subscribe`: una fila con otro host
  // entró por otro camino, y el servidor no le hace `fetch` (SSRF). Se trata
  // como revocada para que el cron la borre.
  if (!isAllowedPushEndpoint(subscription.endpoint)) return "gone";

  const privateJWK = process.env.VAPID_PRIVATE_KEY;
  if (!privateJWK) throw new Error("Falta VAPID_PRIVATE_KEY");

  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK,
    subscription,
    message: {
      payload,
      adminContact: vapidContact(),
      options: { ttl: 3600, urgency: "normal" },
    },
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    // Tiempo agotado o red caída: la suscripción puede seguir siendo buena.
    logEvent("warn", "push_timeout", { host: new URL(endpoint).hostname, error: String(error) });
    return "failed";
  }
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
