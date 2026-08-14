import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Elimina para siempre la cuenta de quien llama (verificada por el token de
 * la sesión, nunca por un id que mande el cliente). Todas las tablas
 * (perfil, guías, plan mensual, hogar…) tienen `user_id` con
 * `ON DELETE CASCADE` hacia `auth.users`, así que borrar el usuario en Auth
 * arrastra el resto de sus datos.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
