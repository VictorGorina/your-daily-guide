/**
 * `fetch` de los clientes de Supabase: pone la clave como `apikey` y, con las
 * claves nuevas (`sb_publishable_…`/`sb_secret_…`, que no son JWT), quita el
 * `Authorization` que solo la repite. Estaba copiado tal cual en `client.ts`,
 * `client.server.ts` y `auth-middleware.ts` (ticket 26 de la auditoría, CAL-07).
 * Neutro a propósito (ni `.server` ni `.client`): lo usan los dos lados.
 */

export function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}
