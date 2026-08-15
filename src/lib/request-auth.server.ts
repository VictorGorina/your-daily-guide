import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * Autenticación por petición HTTP, compartida por las rutas /api/* y por el
 * middleware de las server functions. Devuelve un cliente de Supabase que lleva
 * el token del usuario, así que las políticas RLS siguen aplicando igual que
 * cuando el navegador consulta Supabase directamente — nada aquí usa la clave
 * de servicio.
 */
export type RequestAuth = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // Las claves nuevas de Supabase son opacas, no JWT: si viajan como Bearer,
    // PostgREST las toma por el token del usuario y la petición pierde su
    // identidad (y con ella el `auth.uid()` del que dependen las políticas).
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

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    console.error(`[Supabase] Faltan variables de entorno: ${missing.join(", ")}`);
    return null;
  }
  return { url, key };
}

/** Cliente con RLS actuando como el usuario dueño del token. */
export function supabaseForToken(token: string): SupabaseClient<Database> | null {
  const env = supabaseEnv();
  if (!env) return null;

  return createClient<Database>(env.url, env.key, {
    global: {
      fetch: createSupabaseFetch(env.key),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  // Un JWT tiene tres partes: descartarlo aquí evita una ida y vuelta a
  // Supabase por cada petición con basura en la cabecera.
  return token && token.split(".").length === 3 ? token : null;
}

/** `null` si la petición no trae un token válido. */
export async function authFromRequest(request: Request): Promise<RequestAuth | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const supabase = supabaseForToken(token);
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;

  return { supabase, userId: data.claims.sub as string };
}
