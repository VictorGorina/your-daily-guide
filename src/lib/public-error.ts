import { isNotFound, isRedirect } from "@tanstack/react-router";

import { RateLimitError } from "@/lib/rate-limit-error";
import { UserFacingError, ValidationError } from "@/lib/validation-error";

/** Lo que ve la persona cuando algo falla por dentro. */
export const GENERIC_ERROR_MESSAGE = "No hemos podido completar la acción. Inténtalo de nuevo.";

/**
 * Lo que llega a la web en lugar de un error interno. Sin `cause` ni ninguna
 * otra propiedad a propósito: TanStack Start serializa el error con todas las
 * suyas, y el original viajaría entero.
 */
export class HiddenServerError extends Error {
  constructor() {
    super(GENERIC_ERROR_MESSAGE);
    this.name = "HiddenServerError";
  }
}

/**
 * El error que puede salir de una server function hacia el navegador (SEC-S-14).
 * Pasan tal cual los escritos para la persona (`ValidationError`,
 * `UserFacingError`, `RateLimitError`), la falta de sesión (`apiPost` la
 * convierte en 401 por su prefijo `Unauthorized`) y las redirecciones del
 * router. El resto (un error de PostgREST con sus `details` y `hint`, una clave
 * que falta, la respuesta de otro servicio) sale como `HiddenServerError`. Es
 * la misma tabla que `apiPost` aplica al móvil.
 */
export function publicError(error: unknown): unknown {
  if (
    error instanceof ValidationError ||
    error instanceof UserFacingError ||
    error instanceof RateLimitError ||
    error instanceof HiddenServerError ||
    error instanceof Response ||
    isRedirect(error) ||
    isNotFound(error)
  ) {
    return error;
  }
  if (error instanceof Error && error.message.startsWith("Unauthorized")) return error;
  return new HiddenServerError();
}
