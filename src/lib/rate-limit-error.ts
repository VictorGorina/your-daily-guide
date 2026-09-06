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
  const hours = Math.ceil(seconds / 3600);
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  /** `action` completa la frase "puedes volver a …": "hablar con el coach",
   *  "generar el plan". En infinitivo y en español, que es lo que se enseña. */
  constructor(retryAfterSeconds: number, action: string) {
    super(
      `Has hecho esto muchas veces seguidas. Puedes volver a ${action} en ${retryAfterText(
        retryAfterSeconds,
      )}.`,
    );
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
