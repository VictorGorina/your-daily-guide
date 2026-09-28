import { BLOCKED_FOOD_MESSAGE, blockedTermIn } from "@/lib/content-guard";
import { ValidationError } from "@/lib/validation-error";

/**
 * Versión de `blockedTermIn` para un `.validator()` de server function: lanza
 * `ValidationError`, que `apiPost` traduce a un 400 con este mensaje tal cual
 * en pantalla.
 *
 * Vive fuera de `content-guard.ts` para que ese archivo sea igual que su copia
 * del móvil (el drift check lo vigila, ticket 10), que no la necesita. No es un
 * `.server.ts` a propósito: es lógica pura y va en `.validator()`, no en
 * `.handler()`, así que la protección de imports de `*.server.*` rompería el
 * build si el validador llegara al bundle del cliente.
 */
export function assertCleanFood(text: string): void {
  if (blockedTermIn(text)) throw new ValidationError(BLOCKED_FOOD_MESSAGE);
}
