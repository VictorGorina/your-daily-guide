import { supabase } from "@/integrations/supabase/client";

/** Cabeceras con el token de sesión para llamar a las rutas /api/* protegidas. */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
