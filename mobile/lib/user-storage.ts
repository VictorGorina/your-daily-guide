/**
 * Qué se guarda en el dispositivo que es de UNA persona, y cuándo se borra
 * (ticket 18 de la auditoría, MOB-04). Puro; copia idéntica en
 * `mobile/lib/user-storage.ts` (vigilada por el drift check).
 *
 * El borrador del onboarding (con datos de salud) y los "pendientes" del día y
 * del plan viven en `localStorage`/`AsyncStorage` con claves globales, sin el
 * id de la persona. Antes no se borraban al salir: en un dispositivo
 * compartido, quien entraba después veía el borrador de otra persona o
 * heredaba sus pendientes.
 *
 * En vez de meter el id en cada clave, una clave más (`STORAGE_OWNER_KEY`)
 * apunta de quién son. El listener de sesión de cada app borra al salir y
 * también si entra otra cuenta sin haber pasado por "salir" (la app se cerró a
 * medias); sin dueño apuntado, lo guardado se lo queda quien tiene la sesión
 * (es lo que pasa al actualizar desde una versión sin esta clave).
 */

/** De quién son los datos guardados en este dispositivo. */
export const STORAGE_OWNER_KEY = "peppers-storage-owner";

/**
 * Claves de una persona. Las del dispositivo (`peppers.locale`, el tema) no
 * están: sobreviven a cambiar de cuenta. Una clave nueva de una persona se
 * añade aquí.
 */
export const USER_KEY_PREFIXES = [
  STORAGE_OWNER_KEY,
  "peppers-onboarding-progress-",
  "recipe-warm:",
  "day-settle:",
  "plan-recalc:",
  "plan-updated-notice:",
] as const;

export const isUserKey = (key: string) => USER_KEY_PREFIXES.some((p) => key.startsWith(p));

/**
 * - `clear`: borrar lo de la persona y quedarse sin dueño (salió).
 * - `switch`: borrar y apuntar al nuevo dueño (entró otra cuenta).
 * - `claim`: apuntar el dueño sin borrar nada (no había ninguno).
 * - `none`: no tocar nada.
 */
export type LocalDataAction = "clear" | "switch" | "claim" | "none";

/**
 * Sin sesión y sin `SIGNED_OUT` (p. ej. la sesión inicial vacía) no se borra:
 * sin sesión nadie lee esas claves, y si luego entra otra cuenta ya se borra
 * entonces.
 */
export function localDataAction(
  event: string,
  storedOwner: string | null,
  userId: string | null,
): LocalDataAction {
  if (event === "SIGNED_OUT") return "clear";
  if (!userId || storedOwner === userId) return "none";
  return storedOwner ? "switch" : "claim";
}
