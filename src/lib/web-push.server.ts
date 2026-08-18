import { buildPushHTTPRequest, type PushSubscription } from "@pushforge/builder";

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
 * que borrar esa fila; `"sent"` en cualquier otro caso de envío aceptado.
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<"sent" | "gone"> {
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
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) {
    console.error("sendPushNotification", response.status, await response.text().catch(() => ""));
  }
  return "sent";
}
