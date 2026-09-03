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
