import type { TablesUpdate } from "@/integrations/supabase/types";

import { addDaysISO } from "@/lib/dates";
import { cleanHabits } from "@/lib/day-row";
import { logEvent } from "@/lib/log.server";
import type { MealHabit } from "@/lib/plan-shared";
import { UserFacingError, ValidationError } from "@/lib/validation-error";

export type DailyLogCas = { updated_at: string } & Record<string, unknown>;
/** Lo que se escribe en la fila del día: solo columnas que existen en `daily_logs`. */
export type DailyLogPatch = TablesUpdate<"daily_logs">;

export const DAILY_CAS_ATTEMPTS = 3;

/**
 * Qué días se pueden CREAR: de hace 45 días a mañana (en UTC). Es la ventana de
 * la policy "insert recent own log", que `supabaseAdmin` se salta: aquí va en
 * código. Hoy quien crea pasa una fecha de `clampClientToday`, muy dentro.
 */
export const DAILY_INSERT_WINDOW = { past: 45, future: 1 } as const;

/** Con `supabaseAdmin` nada impide mover la fila a otra persona o a otro día: aquí sí. */
function assertOwnRowPatch(patch: DailyLogPatch) {
  if ("user_id" in patch || "log_date" in patch || "id" in patch) {
    throw new Error(
      "updateDailyLogCas: el patch no puede cambiar de quién ni de qué día es la fila",
    );
  }
}

function assertInsertWindow(date: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < addDaysISO(today, -DAILY_INSERT_WINDOW.past) ||
    date > addDaysISO(today, DAILY_INSERT_WINDOW.future)
  ) {
    throw new ValidationError("Ese día queda fuera de lo que se puede registrar.");
  }
}

type CasResult<Row> = {
  /** Lo escrito (o insertado), o `null` si no se escribió nada. */
  patch: DailyLogPatch | null;
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
 * se inserta como fila nueva (solo dentro de `DAILY_INSERT_WINDOW`); si el
 * cliente la creó a la vez (23505), se relee y se actualiza.
 *
 * Lee y escribe SIEMPRE con `supabaseAdmin` (ticket 39): estas columnas dejan
 * de poder escribirse con la sesión de la persona, y así ningún sitio que
 * llame puede equivocarse de cliente. Se salta RLS, de modo que la frontera es
 * `userId`: tiene que ser el del JWT ya verificado (`context.userId`), nunca
 * un dato del cliente. Todo filtra por `user_id`.
 */
export async function updateDailyLogCas<Row extends DailyLogCas = DailyLogCas>(
  userId: string,
  date: string,
  columns: string,
  rebuild: (latest: Row) => DailyLogPatch | null,
  options: CasOptions & { create?: false },
): Promise<CasResult<Row>>;
export async function updateDailyLogCas<Row extends DailyLogCas = DailyLogCas>(
  userId: string,
  date: string,
  columns: string,
  rebuild: (latest: Row | null) => DailyLogPatch | null,
  options: CasOptions & { create: true },
): Promise<CasResult<Row>>;
export async function updateDailyLogCas<Row extends DailyLogCas = DailyLogCas>(
  userId: string,
  date: string,
  columns: string,
  rebuild: (latest: Row | null) => DailyLogPatch | null,
  options: CasOptions & { create?: boolean },
): Promise<CasResult<Row>> {
  const { supabaseAdmin: client } = await import("@/integrations/supabase/client.server");
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
    assertOwnRowPatch(patch);

    if (!latest) {
      assertInsertWindow(date);
      const { error } = await client
        .from("daily_logs")
        .insert({ ...patch, user_id: userId, log_date: date });
      if (!error) return { patch, latest: null, attempts: attempt };
      // 23505: el cliente creó la fila a la vez. Se relee y se actualiza.
      if ((error as { code?: string }).code !== "23505") throw error;
      continue;
    }

    const { data: written, error } = await client
      .from("daily_logs")
      .update(patch)
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
 * esto) o si `update` devuelve `null` (nada que escribir). `userId`, el del JWT.
 *
 * `update` recibe las comidas ya limpias (`cleanHabits`, ticket 36): una
 * entrada sin `label` no llega, y al escribir se va, igual que Hoy ya no la
 * pinta.
 */
export async function patchDailyHabits(
  userId: string,
  date: string,
  update: (current: MealHabit[]) => MealHabit[] | null,
): Promise<MealHabit[] | null> {
  const { patch } = await updateDailyLogCas(
    userId,
    date,
    "habits",
    (row) => {
      const next = update(cleanHabits(row.habits));
      return next ? { habits: next } : null;
    },
    { exhaustedMessage: "No hemos podido guardar el cambio de comida. Inténtalo de nuevo." },
  );
  // Lo que se escribió ya estaba limpio: volver a pasarlo es gratis y sin `as`.
  return patch ? cleanHabits(patch.habits) : null;
}
