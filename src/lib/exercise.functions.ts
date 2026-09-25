import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import { compensationNeed } from "@/lib/nutrition/compensation";
import {
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  type MealChange,
} from "@/lib/plan-shared";
import {
  cleanDayExercise,
  EXERCISE_ACTIVITIES,
  EXERCISE_INTENSITY,
  EXERCISE_MINUTES_MAX,
  EXERCISE_MINUTES_MIN,
  isoWeekDaysUntil,
  pendingExerciseKcal,
  routineSessionsIn,
  splitRoutineSession,
  withExercise,
  withoutExercise,
  type DayExercise,
  type ExerciseEntry,
  type ExerciseOutcome,
} from "@/lib/exercise";
import { normalizeActivity } from "@/lib/nutrition/energy";
import { parseTraining } from "@/lib/nutrition/exercise-energy";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";

/**
 * Deporte de Hoy, mismo patrón que `snacks.functions.ts` (picoteo) pero al
 * revés: un déficit en vez de un exceso.
 *
 * - `logExercise` calcula las kcal quemadas EN EL SERVIDOR con la tabla
 *   determinista (`splitRoutineSession`: netas, con el peso, y separando la
 *   parte que ya va en el objetivo por ser de su rutina, ticket 16), a partir
 *   de actividad/minutos/intensidad ya validados — nunca se confía en una cifra que mande el
 *   cliente, a diferencia del picoteo (que si acepta los macros calculados en
 *   su paso de estimación, porque ahí la cifra sale de una llamada al modelo
 *   que ya corrió en el servidor). Escribe SOLO la columna
 *   `daily_logs.exercise` de hoy, así que no choca con las escrituras de
 *   `habits` del cliente.
 *
 * El deporte ya NO se compensa por su cuenta: lo hace `settleDay`
 * (`day-settle.functions.ts`) con el desvío del día entero, porque decidir por
 * origen lanzaba dos recolocaciones opuestas cuando el deporte y el picoteo se
 * anulaban — ver `day-balance.ts`. Aquí solo queda el registro.
 *
 * Cada operación tiene su ruta espejo en `src/routes/api/v1/exercise/`.
 */

type Client = SupabaseClient<never, never, never>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayOf = (raw: unknown) => {
  const value = String(raw ?? "");
  return ISO_DATE.test(value) ? value : zonedTodayISO();
};

/** Veces que se relee y reintenta una escritura que se cruzó con otra. */
const WRITE_ATTEMPTS = 3;

type ExerciseRow = { exercise: DayExercise | null; updatedAt: string } | null;

async function readExerciseRow(
  supabase: Client,
  userId: string,
  date: string,
): Promise<ExerciseRow> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("exercise, updated_at")
    .eq("user_id", userId)
    .eq("log_date", date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { exercise?: unknown; updated_at: string };
  return { exercise: cleanDayExercise(row.exercise), updatedAt: row.updated_at };
}

/**
 * Escribe la columna solo si nadie la ha tocado desde que se leyó
 * (`updated_at`). Devuelve false si se cruzó otra escritura.
 */
async function writeExerciseIfUnchanged(
  supabase: Client,
  userId: string,
  date: string,
  row: NonNullable<ExerciseRow>,
  exercise: DayExercise,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("daily_logs")
    .update({ exercise } as never)
    .eq("user_id", userId)
    .eq("log_date", date)
    .eq("updated_at", row.updatedAt)
    .select("id");
  if (error) throw error;
  return !!data?.length;
}

/**
 * Lee, transforma y escribe la columna de hoy, reintentando si otra escritura
 * se cruzó. Crea la fila del día si todavía no existe (la policy "insert
 * recent own log" lo permite para hoy). `update` recibe `null` si no había
 * deporte.
 */
async function patchExercise(
  supabase: Client,
  userId: string,
  date: string,
  update: (current: DayExercise | null) => DayExercise,
): Promise<DayExercise> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = await readExerciseRow(supabase, userId, date);
    const next = update(row?.exercise ?? null);
    if (!row) {
      const { error } = await supabase
        .from("daily_logs")
        .insert({ user_id: userId, log_date: date, exercise: next } as never);
      if (!error) return next;
      // 23505: el cliente creó la fila a la vez. Se relee y se actualiza.
      if ((error as { code?: string }).code !== "23505") throw error;
      continue;
    }
    if (await writeExerciseIfUnchanged(supabase, userId, date, row, next)) return next;
  }
  throw new Error("No hemos podido guardar el deporte. Inténtalo de nuevo.");
}

const cleanActivityInput = (raw: unknown) => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const activity = EXERCISE_ACTIVITIES.find((a) => a.label === String(o.activity ?? ""))?.label;
  if (!activity) throw new ValidationError("Elige una actividad de la lista.");
  const intensity = EXERCISE_INTENSITY.find((i) => i.label === String(o.intensity ?? ""))?.label;
  if (!intensity) throw new ValidationError("Elige una intensidad.");
  const minutes = Number(o.minutes);
  if (
    !Number.isFinite(minutes) ||
    minutes < EXERCISE_MINUTES_MIN ||
    minutes > EXERCISE_MINUTES_MAX
  ) {
    throw new ValidationError(
      `Los minutos tienen que estar entre ${EXERCISE_MINUTES_MIN} y ${EXERCISE_MINUTES_MAX}.`,
    );
  }
  return { activity, intensity, minutes: Math.round(minutes) };
};

// ---------------------------------------------------------------------------
// logExercise / removeExercise
// ---------------------------------------------------------------------------

export const logExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { today?: string; activity: string; minutes: number; intensity: string }) => ({
    today: todayOf(input?.today),
    ...cleanActivityInput(input),
  }))
  .handler(async ({ data, context }): Promise<{ exercise: DayExercise; entry: ExerciseEntry }> => {
    const supabase = context.supabase as never as Client;
    const { routine, weightKg, earlierRoutineSessions } = await routineContext(
      supabase,
      context.userId,
      data.today,
    );
    let entry: ExerciseEntry | null = null;
    const exercise = await patchExercise(supabase, context.userId, data.today, (current) => {
      // Dentro de la escritura (que se reintenta si se cruza otra): las sesiones
      // de rutina de HOY se cuentan sobre la fila que se va a escribir.
      const split = splitRoutineSession({
        activity: data.activity,
        minutes: data.minutes,
        intensity: data.intensity,
        weightKg,
        routine,
        routineSessionsBefore: earlierRoutineSessions + routineSessionsIn([current]),
      });
      entry = {
        id: crypto.randomUUID(),
        activity: data.activity,
        minutes: data.minutes,
        intensity: data.intensity,
        kcal: -split.extraKcal,
        at: new Date().toISOString(),
        ...(split.routine
          ? {
              routine: true,
              routineKcal: split.routineKcal,
              routineIndex: split.routineIndex,
              routineOf: split.routineOf,
            }
          : {}),
      };
      return withExercise(current, entry);
    });
    return { exercise, entry: entry! };
  });

/**
 * Lo que decide si una sesión es de la rutina (ticket 16, D9): la rutina del
 * perfil, el peso y las sesiones de rutina ya apuntadas esta semana ISO antes de
 * hoy. Un perfil antiguo (sin `daily_activity`) no tiene la rutina dentro del
 * objetivo — su factor de actividad ya incluía el deporte —, así que para él no
 * hay rutina y todo cuenta como extra, igual que antes (ver `energyTargets`).
 */
async function routineContext(supabase: Client, userId: string, today: string) {
  const [{ data: profile }, earlier] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    (async () => {
      const days = isoWeekDaysUntil(today).filter((d) => d < today);
      if (!days.length) return [];
      const { data, error } = await supabase
        .from("daily_logs")
        .select("exercise")
        .eq("user_id", userId)
        .in("log_date", days);
      if (error) throw error;
      return ((data ?? []) as { exercise?: unknown }[]).map((row) =>
        cleanDayExercise(row.exercise),
      );
    })(),
  ]);
  const p = (profile ?? {}) as {
    current_weight_kg?: number | null;
    daily_activity?: string | null;
    training?: string | null;
  };
  const routine = normalizeActivity(p.daily_activity) ? parseTraining(p.training) : null;
  return {
    routine,
    weightKg: Number(p.current_weight_kg) || null,
    earlierRoutineSessions: routineSessionsIn(earlier),
  };
}

export const removeExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { today?: string; id: string }) => {
    const id = String(input?.id ?? "").trim();
    if (!id) throw new ValidationError("Falta el deporte que quieres quitar.");
    return { today: todayOf(input?.today), id };
  })
  .handler(async ({ data, context }): Promise<{ exercise: DayExercise }> => {
    const exercise = await patchExercise(
      context.supabase as never,
      context.userId,
      data.today,
      (current) => withoutExercise(current, data.id),
    );
    return { exercise };
  });
