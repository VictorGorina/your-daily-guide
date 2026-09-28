/**
 * Error de validación del input del usuario — mensaje pensado para enseñarse en
 * pantalla. `apiPost` lo devuelve con HTTP 400 (dato inválido) en vez de 500
 * (fallo inesperado), lo que permite al cliente y a la observabilidad distinguir
 * errores de usuario de errores reales del servidor.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Fallo real del servidor (no del dato) con un mensaje escrito para la persona:
 * «No hemos podido guardar el horario». `apiPost` lo devuelve como 500, igual
 * que cualquier fallo, pero CON su mensaje. Antes esos mensajes solo llegaban a
 * la web (por el RPC de las server functions); el móvil, que va por
 * `/api/v1/*`, veía siempre el genérico (ticket 36, CAL-10). Un error interno
 * (una clave que falta, la respuesta de un servicio) sigue siendo `Error`.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}
