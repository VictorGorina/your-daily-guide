/**
 * Qué hace la caché de React Query con cada evento de sesión de Supabase
 * (ticket 36, PERF-07). Puro; copia idéntica en `mobile/lib/auth-cache.ts`
 * (vigilada por el drift check).
 *
 * Las claves de las consultas (`["profile"]`, `["today"]`…) no llevan el id de
 * la persona, así que la caché es de UNA cuenta: si entra otra, se descarta.
 * Antes la web lo invalidaba todo en cada `SIGNED_IN` (que Supabase emite
 * también al recuperar la sesión de la misma cuenta) y el móvil no hacía nada;
 * con `staleTime`, eso último enseñaría un momento los datos de la cuenta
 * anterior.
 */

export type AuthCacheAction = "reset" | "clear" | "invalidate" | "none";

/**
 * `previousUserId` es `undefined` hasta el primer evento (aún no se sabe quién
 * había); `null`, sin sesión.
 */
export function authCacheAction(
  event: string,
  previousUserId: string | null | undefined,
  nextUserId: string | null,
): AuthCacheAction {
  if (event === "SIGNED_OUT") return "clear";
  if (previousUserId === undefined) return "none";
  if (nextUserId !== previousUserId) return nextUserId ? "reset" : "clear";
  if (event === "USER_UPDATED") return "invalidate";
  return "none";
}
