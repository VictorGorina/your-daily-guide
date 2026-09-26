import type { SupabaseClient } from "@supabase/supabase-js";

export const HABITS_WRITE_ATTEMPTS = 3;

/**
 * Relee, modifica y escribe `daily_logs.habits` de un día con escritura
 * condicional sobre `updated_at` (lo mueve el trigger `daily_logs_updated_at`):
 * si otra escritura se cruzó, se relee y se vuelve a aplicar `update` sobre lo
 * nuevo, hasta `HABITS_WRITE_ATTEMPTS` veces (ticket 21 de la auditoría; mismo
 * patrón que `patchSnacks` y que `patchTodayHabits` en el cliente). Por eso
 * `update` tiene que ser pura.
 *
 * `null` si el día no existe (lo crea siempre el cliente al abrir Hoy, nunca
 * esto) o si `update` devuelve `null` (nada que escribir).
 *
 * `client` es el de sesión o `supabaseAdmin`: quien llama decide.
 */
export async function patchDailyHabits<Habit>(
  client: SupabaseClient<never, never, never>,
  userId: string,
  date: string,
  update: (current: Habit[]) => Habit[] | null,
): Promise<Habit[] | null> {
  for (let attempt = 0; attempt < HABITS_WRITE_ATTEMPTS; attempt++) {
    const { data, error } = await client
      .from("daily_logs")
      .select("habits, updated_at")
      .eq("user_id", userId)
      .eq("log_date", date)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as { habits?: unknown; updated_at: string };
    const next = update((Array.isArray(row.habits) ? row.habits : []) as Habit[]);
    if (!next) return null;
    const { data: written, error: writeError } = await client
      .from("daily_logs")
      .update({ habits: next } as never)
      .eq("user_id", userId)
      .eq("log_date", date)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (writeError) throw writeError;
    if (written?.length) return next;
  }
  throw new Error("No hemos podido guardar el cambio de comida. Inténtalo de nuevo.");
}
