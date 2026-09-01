import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function bearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) return null;
  return token;
}

/**
 * Cliente Supabase de servidor. Con `token` queda ligado a la sesión del
 * usuario (respeta RLS); sin él usa solo la clave pública (para verificar el
 * JWT). El `fetch` a medida limpia la cabecera `Authorization` que la propia
 * librería añade con las claves nuevas `sb_…`, que no son JWT.
 */
function serverClient(url: string, key: string, token?: string): SupabaseClient {
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/**
 * Verifica el token Bearer de Supabase en rutas HTTP (/api/*).
 * Devuelve el userId o null si la petición no está autenticada.
 */
export async function getRequestUserId(request: Request): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) return null;

  const supabase = serverClient(url, key);
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub as string;
}

/**
 * Como `getRequestUserId`, pero devuelve también un cliente Supabase ligado a
 * la sesión del usuario (RLS aplicada). Para rutas /api/* que no pasan por el
 * middleware de server functions pero necesitan leer datos con las políticas
 * del usuario — p. ej. `/api/chat`, que arma el prompt con el contexto del
 * hogar. Devuelve null si la petición no está autenticada.
 */
export async function supabaseFromRequest(
  request: Request,
): Promise<{ userId: string; supabase: SupabaseClient } | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) return null;

  const supabase = serverClient(url, key, token);
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { userId: data.claims.sub as string, supabase };
}

export function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}
