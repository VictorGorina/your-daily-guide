import { supabase } from "@/integrations/supabase/client";

/** Cabeceras con el token de sesión para llamar a las rutas /api/* protegidas. */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Id del usuario actual leído de la sesión LOCAL (sin llamada de red), a
 * diferencia de `supabase.auth.getUser()`, que revalida el token contra el
 * servidor de Auth en cada llamada. Para construir una consulta solo hace falta
 * el id (estable dentro del JWT); la seguridad real la aplica RLS en el servidor
 * en cada query. Usar getUser() aquí disparaba una llamada de red por cada
 * función de datos (~5 concurrentes al abrir /hoy) que, en el arranque en frío
 * justo tras el registro —cuando el token aún no está adjunto— podía fallar y
 * dejar la pantalla en blanco. Devuelve null si no hay sesión.
 */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
