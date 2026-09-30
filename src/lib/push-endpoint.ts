/**
 * ¿Es `raw` la URL de un servicio de push de verdad? (ticket 06, SEC-S-04).
 *
 * El cron hace `fetch` a cada endpoint guardado, así que una URL cualquiera
 * sería una petición del servidor a donde diga quien la guardó (SSRF ciego).
 * Lo comprueban la ruta de suscripción, al guardar, y el envío, por si la fila
 * entró por otro camino. Puro: lo prueban los tests sin red.
 */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  // Edge / WNS: wns2-*.notify.windows.com.
  "notify.windows.com",
];

export const MAX_PUSH_ENDPOINT_LENGTH = 512;

export function isAllowedPushEndpoint(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw || raw.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname;
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
