import type { DbClient } from "@/integrations/supabase/db-client";

import { logEvent } from "@/lib/log.server";
import { UserFacingError } from "@/lib/validation-error";

export type DailyLogCas = { updated_at: string } & Record<string, unknown>;

export const DAILY_CAS_ATTEMPTS = 3;

type CasResult<Row> = {
  /** Lo escrito (o insertado), o `null` si no se escribió nada. */
  patch: Record<string, unknown> | null;
  /** La versión sobre la que se aplicó `patch`; `null` si no había fila. */
  latest: Row | null;
  attempts: number;
};

type CasOptions = {
  /** Qué se enseña si todos los intentos chocan con otra escritura. */
  exhaustedMessage: string;
};

/**
 * Escribe la fila `daily_logs` de un día solo si nadie la ha cambiado desde
 * que se leyó: el mismo contrato que `updatePlanRowCas` (ticket 21), para la
 * fila del día (ticket 26, CAL-07). `rebuild` recibe la versión más reciente
 * (con las `columns` pedidas y `updated_at`) y devuelve el `patch`, o `null`
 * para no escribir nada; si otra escritura se cruzó (lo mueve el trigger
 * `daily_logs_updated_at`), se relee y se vuelve a llamar a `rebuild`. Por eso
 * tiene que ser pura. Hasta `DAILY_CAS_ATTEMPTS` intentos; después lanza
 * `exhaustedMessage`.
 *
 * Sin fila no se escribe (`{ patch: null, latest: null }`): la crea el cliente
 * al abrir Hoy. Con `create: true`, `rebuild` recibe `null` y lo que devuelva
 * se inserta como fila nueva (la policy "insert recent own log" lo permite para
 * hoy); si el cliente la creó a la vez (23505), se relee y se actualiza.
 *
 * `client` es el de sesión o `supabaseAdmin`: quien llama decide.
 */
export async function updateDailyLogCas<Row extends DailyLogCas = DailyLogCas>(
  client: DbClient,
  userId: string,
  date: string,
  columns: string,
  rebuild: (latest: Row) => Record<string, unknown> | null,
  options: CasOptions & { create?: false },
): Promise<CasResult<Row>>;
export async function updateDailyLogCas<Row extends DailyLogCas = DailyLogCas>(
  client: DbClient,
  userId: string,
  date: string,
  columns: string,
  rebuild: (latest: Row | null) => Record<string, unknown> | null,
  options: CasOptions & { create: true },
): Promise<CasResult<Row>>;
export async function updateDailyLogCas<Row extends DailyLogCas = DailyLogCas>(
  client: DbClient,
  userId: string,
  date: string,
  columns: string,
  rebuild: (latest: Row | null) => Record<string, unknown> | null,
  options: CasOptions & { create?: boolean },
): Promise<CasResult<Row>> {
  const select = /\bupdated_at\b/.test(columns) ? columns : `${columns}, updated_at`;
  for (let attempt = 1; attempt <= DAILY_CAS_ATTEMPTS; attempt++) {
    const { data, error: readError } = await client
      .from("daily_logs")
      .select(select)
      .eq("user_id", userId)
      .eq("log_date", date)
      .maybeSingle();
    if (readError) throw readError;
    const latest = (data ?? null) as unknown as Row | null;
    if (!latest && !options.create) return { patch: null, latest: null, attempts: attempt };

    const patch = rebuild(latest);
    if (!patch) return { patch: null, latest, attempts: attempt };

    if (!latest) {
      const { error } = await client
        .from("daily_logs")
        .insert({ user_id: userId, log_date: date, ...patch } as never);
      if (!error) return { patch, latest: null, attempts: attempt };
      // 23505: el cliente creó la fila a la vez. Se relee y se actualiza.
      if ((error as { code?: string }).code !== "23505") throw error;
      continue;
    }

    const { data: written, error } = await client
      .from("daily_logs")
      .update(patch as never)
      .eq("user_id", userId)
      .eq("log_date", date)
      .eq("updated_at", latest.updated_at)
      .select("id");
    if (error) throw error;
    if (written?.length) return { patch, latest, attempts: attempt };
  }
  logEvent("warn", "daily_cas_exhausted", { date, columns });
  throw new UserFacingError(options.exhaustedMessage);
}

/**
 * Relee, modifica y escribe `daily_logs.habits` de un día con
 * `updateDailyLogCas` (ticket 21 de la auditoría; mismo patrón que
 * `patchTodayHabits` en el cliente): si otra escritura se cruzó, se vuelve a
 * aplicar `update` sobre lo nuevo. Por eso `update` tiene que ser pura.
 *
 * `null` si el día no existe (lo crea siempre el cliente al abrir Hoy, nunca
 * esto) o si `update` devuelve `null` (nada que escribir).
 *
 * `client` es el de sesión o `supabaseAdmin`: quien llama decide.
 */
export async function patchDailyHabits<Habit>(
  client: DbClient,
  userId: string,
  date: string,
  update: (current: Habit[]) => Habit[] | null,
): Promise<Habit[] | null> {
  const { patch } = await updateDailyLogCas(
    client,
    userId,
    date,
    "habits",
    (row) => {
      const next = update((Array.isArray(row.habits) ? row.habits : []) as Habit[]);
      return next ? { habits: next } : null;
    },
    { exhaustedMessage: "No hemos podido guardar el cambio de comida. Inténtalo de nuevo." },
  );
  return patch ? (patch.habits as Habit[]) : null;
}
