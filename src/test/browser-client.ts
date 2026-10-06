import type { supabase } from "@/integrations/supabase/client";

/**
 * El cliente de Supabase del NAVEGADOR en los tests de componentes (Vitest).
 * `vitest-setup.ts` sustituye `@/integrations/supabase/client` por `testBrowser`
 * en toda la suite: por defecto cualquier acceso lanza, para que ningún test
 * hable con una base de datos de verdad, y el que lo necesite lo apunta a su
 * doble con `setFakeBrowser(createFakeSupabase({...}).client)`. Es lo mismo que
 * `admin.ts` hace con `supabaseAdmin` en `bun test`.
 */
type BrowserClient = typeof supabase;

let current: BrowserClient | null = null;

export function setFakeBrowser(client: unknown) {
  current = client as BrowserClient;
}

export function resetFakeBrowser() {
  current = null;
}

export const testBrowser = new Proxy({} as BrowserClient, {
  get(_target, prop) {
    if (!current) {
      throw new Error(
        `Un test de componentes ha usado supabase.${String(prop)} sin doble: usa setFakeBrowser(createFakeSupabase(...).client) o siembra la consulta en renderApp.`,
      );
    }
    return Reflect.get(current as object, prop);
  },
});
