import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import "react-native-url-polyfill/auto";

/**
 * Mismo Supabase que la web, con dos diferencias propias de React Native:
 * la sesión se guarda en AsyncStorage (aquí no hay localStorage) y hay que
 * cargar el polyfill de URL, del que depende supabase-js y que el runtime de
 * Hermes no trae.
 *
 * Al ser el mismo proyecto y el mismo JWT, las políticas RLS aplican igual que
 * en la web, y el token vale tal cual para llamar a /api/v1/* (ver
 * lib/api.ts).
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copia mobile/.env.example a mobile/.env.",
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // En móvil no hay redirect de navegador que dejar la sesión en la URL.
    detectSessionInUrl: false,
    // Flujo PKCE: al abrir el OAuth de Google, supabase-js guarda el code
    // verifier en AsyncStorage y luego lo canjea con exchangeCodeForSession
    // desde la URL de vuelta (ver el handler de Google en app/auth.tsx).
    flowType: "pkce",
  },
});

/**
 * Id del usuario actual leído de la sesión LOCAL (AsyncStorage), sin llamada
 * de red, igual que `currentUserId` de la web (src/lib/auth-headers.ts).
 * `supabase.auth.getUser()` revalida el token contra el servidor de Auth en
 * cada llamada, y cada función de datos lo hacía antes de su consulta. Para
 * construir la consulta basta el id (estable dentro del JWT); la seguridad la
 * aplica RLS en el servidor en cada query. Devuelve null si no hay sesión.
 */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
