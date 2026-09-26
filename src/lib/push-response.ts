/**
 * Qué significa la respuesta del servicio de push a un envío. `gone` es la
 * señal estándar de suscripción revocada (hay que borrar la fila); `failed`
 * cubre el resto de rechazos (400, 403, 413, 429, 5xx…), que antes se contaban
 * como enviados.
 */
export function classifyPushResponse(status: number): "sent" | "gone" | "failed" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  return "failed";
}
