/**
 * Se ha agotado la cuota de una operación cara o sensible. `apiPost` lo
 * devuelve con HTTP 429 para que el cliente sepa que no es un fallo suyo ni del
 * servidor: es cuestión de esperar.
 *
 * El formateo del tiempo vive aquí, junto al error, porque solo existe para
 * construir el mensaje que lee la persona; así el módulo se queda sin
 * dependencias de servidor y se puede testear e importar desde cualquier sitio.
 */

/** El tiempo que falta, en palabras. Redondea hacia arriba: es preferible que
 *  la persona vuelva un poco tarde a que vuelva pronto y se lo encuentre igual. */
export function retryAfterText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "un momento";
  if (seconds < 60) return "menos de un minuto";
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  }
  // A partir de la hora se redondea sobre los segundos, no sobre los minutos ya
  // redondeados: encadenar dos `ceil` convertía 3601 s en "2 horas".
  if (seconds < 86400) {
    const hours = Math.ceil(seconds / 3600);
    return hours === 1 ? "1 hora" : `${hours} horas`;
  }
  // Solo el tope de gasto mensual espera días; "360 horas" no se lee.
  const days = Math.ceil(seconds / 86400);
  return days === 1 ? "1 día" : `${days} días`;
}

/**
 * Qué tope ha saltado: la ventana corta de una operación (`RATE_LIMITS`) o el
 * gasto en IA del día o del mes (`AI_SPEND_CAPS`, ambos en
 * `rate-limit.server.ts`). Solo cambia la primera frase del mensaje: al tope de
 * gasto se llega sumando a lo largo del día, no repitiendo algo seguido.
 */
export type RateLimitScope = "window" | "day" | "month";

const LEAD: Record<RateLimitScope, string> = {
  window: "Has hecho esto muchas veces seguidas.",
  day: "Por hoy ya has llegado al tope de uso del coach.",
  month: "Este mes ya has llegado al tope de uso del coach.",
};

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly scope: RateLimitScope;

  /** `action` completa la frase "puedes volver a …": "hablar con el coach",
   *  "generar el plan". En infinitivo y en español, que es lo que se enseña. */
  constructor(retryAfterSeconds: number, action: string, scope: RateLimitScope = "window") {
    super(`${LEAD[scope]} Puedes volver a ${action} en ${retryAfterText(retryAfterSeconds)}.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.scope = scope;
  }
}
