import { errorText, logEvent } from "@/lib/log.server";

/**
 * Elimina para siempre la cuenta de quien llama (verificada por el token de
 * la sesión, nunca por un id que mande el cliente). Todas las tablas
 * (perfil, guías, plan mensual, hogar…) tienen `user_id` con
 * `ON DELETE CASCADE` hacia `auth.users`, así que borrar el usuario en Auth
 * arrastra el resto de sus datos.
 */
export async function deleteAccountHandler({ context }: { context: { userId: string } }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
  if (error) throw new Error(error.message);
  // `rate_limits` no tiene `user_id` (su clave es el texto `subject`), así que
  // no cae en cascada (ticket 30). Si falla, la cuenta ya está borrada y la
  // fila caduca sola con la retención: no se le devuelve un error.
  // Sin tipos generados para `rate_limits` (ticket 24), como `dish_recipes`.
  const { error: limitsError } = await supabaseAdmin
    .from("rate_limits" as never)
    .delete()
    .eq("subject" as never, `user:${context.userId}` as never);
  if (limitsError) {
    logEvent("warn", "account_rate_limits_left", { error: errorText(limitsError) });
  }
  return { ok: true as const };
}
