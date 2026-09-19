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
  estimateExerciseKcal,
  exerciseNote,
  mergeExerciseAdjustment,
  pendingExerciseKcal,
  withExercise,
  withoutExercise,
  type DayExercise,
  type ExerciseEntry,
  type ExerciseOutcome,
} from "@/lib/exercise";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";

/**
 * Deporte de Hoy, mismo patrón que `snacks.functions.ts` (picoteo) pero al
 * revés: un déficit en vez de un exceso.
 *
 * - `logExercise` calcula las kcal quemadas EN EL SERVIDOR con la tabla
 *   determinista (`estimateExerciseKcal`), a partir de actividad/minutos/
 *   intensidad ya validados — nunca se confía en una cifra que mande el
 *   cliente, a diferencia del picoteo (que si acepta los macros calculados en
 *   su paso de estimación, porque ahí la cifra sale de una llamada al modelo
 *   que ya corrió en el servidor). Escribe SOLO la columna
 *   `daily_logs.exercise` de hoy, así que no choca con las escrituras de
 *   `habits` del cliente.
 * - `settleExercise` decide en código (`compensationNeed`) si el déficit aún
 *   no compensado pide reponer energía en días futuros, y en ese caso llama a
 *   `reflowMeals` con un `kcalDelta` negativo (el mismo camino que ya
 *   contempla el picoteo al deshacer una compensación).
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
    const burn = estimateExerciseKcal(data.activity, data.minutes, data.intensity);
    const entry: ExerciseEntry = {
      id: crypto.randomUUID(),
      activity: data.activity,
      minutes: data.minutes,
      intensity: data.intensity,
      kcal: -burn,
      at: new Date().toISOString(),
    };
    const exercise = await patchExercise(
      context.supabase as never,
      context.userId,
      data.today,
      (current) => withExercise(current, entry),
    );
    return { exercise, entry };
  });

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

// ---------------------------------------------------------------------------
// settleExercise — la compensación
// ---------------------------------------------------------------------------

export type SettleExerciseResult = {
  /** `nothing`: no había nada pendiente. */
  outcome: ExerciseOutcome | "nothing";
  /** kcal pendientes que se analizaron (con signo). */
  kcal: number;
  changes?: MealChange[];
  summary?: string;
};

/** Dirección del objetivo, con el mismo criterio que `reflowMeals`. */
function goalOf(p: Record<string, unknown>): string | null {
  if (p.target_weight_kg != null) {
    const target = Number(p.target_weight_kg);
    const current = Number(p.current_weight_kg ?? p.start_weight_kg ?? target);
    return deriveGoalType(current, target);
  }
  return p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
}

export const settleExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { today?: string }) => ({ today: todayOf(input?.today) }))
  .handler(async ({ data, context }): Promise<SettleExerciseResult> => {
    const supabase = context.supabase as never as Client;
    const { userId } = context;
    const { today } = data;
    const month = today.slice(0, 7);

    const recordOutcome = (outcome: ExerciseOutcome) =>
      patchExercise(supabase, userId, today, (current) => ({
        ...(current ?? { entries: [], compensatedKcal: 0 }),
        lastOutcome: outcome,
      }));

    const first = await readExerciseRow(supabase, userId, today);
    const firstPending = pendingExerciseKcal(first?.exercise);
    if (!first?.exercise || firstPending === 0) return { outcome: "nothing", kcal: 0 };

    const [{ data: profileRow }, { data: planRow }] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "target_weight_kg, current_weight_kg, start_weight_kg, goal_type, pregnancy_status, meal_slots, meals_to_plan",
        )
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("monthly_plans")
        .select("id")
        .eq("month", month)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const profile = (profileRow ?? {}) as Record<string, unknown>;

    const decision = compensationNeed({
      deltaKcal: firstPending,
      goal: goalOf(profile),
      pregnancyStatus: (profile.pregnancy_status as string | null) ?? null,
      // Deshace una compensación ya aplicada (se borra deporte que ya había
      // repuesto energía en días futuros): hay que retirar esa energía de más,
      // no es un exceso nuevo. Mismo criterio que el picoteo, con el signo
      // invertido porque aquí `compensatedKcal` es negativo cuando hay algo
      // compensado.
      reversing: first.exercise.compensatedKcal < 0 && firstPending > 0,
    });
    if (!decision.compensate) {
      await recordOutcome(decision.reason);
      return { outcome: decision.reason, kcal: firstPending };
    }
    if (!planRow) {
      await recordOutcome("no-plan");
      return { outcome: "no-plan", kcal: firstPending };
    }

    const { householdContext } = await import("@/lib/household.server");
    const home = await householdContext(supabase as never, userId);
    const window = compensationWindow({
      today,
      sharedSlots: home.sharedSlots,
      selectedSlots: effectiveMealSlots(
        profile as { meal_slots?: unknown; meals_to_plan?: string | null },
      ),
      soloAdult: home.members.length <= 1,
    });
    if (window.reason) {
      await recordOutcome(window.reason);
      return { outcome: window.reason, kcal: firstPending };
    }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");
    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(userId, "plan-adjust");

    // Reserva: se apunta como compensado ANTES de llamar a la IA, releyendo lo
    // último, para que otro asentamiento a la vez no compense lo mismo.
    let reserved = 0;
    let entries: ExerciseEntry[] = [];
    await patchExercise(supabase, userId, today, (current) => {
      const base = current ?? { entries: [], compensatedKcal: 0 };
      reserved = pendingExerciseKcal(base);
      entries = base.entries;
      return { ...base, compensatedKcal: base.compensatedKcal + reserved };
    });
    if (reserved === 0) return { outcome: "nothing", kcal: 0 };

    try {
      const { reflowMeals } = await import("@/lib/plan.functions");
      const { plan, before, summary } = await reflowMeals({
        supabase,
        userId,
        key,
        month,
        today,
        note: exerciseNote(entries, reserved),
        kcalDelta: reserved,
        window: window.dates,
        soloOnly: true,
      });
      const changes = diffFutureMeals(before, plan, today);
      // Un desvío por encima del umbral que no mueve ningún plato no está
      // compensado: si se diera por bueno, el déficit se perdería en silencio.
      // Se trata como un intento fallido (se devuelve la reserva abajo) y el
      // cliente lo reintenta más tarde.
      if (!changes.length) throw new Error("El reajuste no ha cambiado ningún plato");
      await patchExercise(supabase, userId, today, (current) => {
        const base = current ?? { entries: [], compensatedKcal: reserved };
        return {
          ...base,
          adjustment: mergeExerciseAdjustment(base.adjustment, {
            changes,
            summary,
            kcal: reserved,
          }),
          lastOutcome: "adjusted",
        };
      });
      return { outcome: "adjusted", kcal: reserved, changes, summary };
    } catch (error) {
      // Se devuelve la reserva: lo pendiente se volverá a intentar.
      await patchExercise(supabase, userId, today, (current) => {
        const base = current ?? { entries: [], compensatedKcal: reserved };
        return { ...base, compensatedKcal: base.compensatedKcal - reserved };
      }).catch((releaseError) => console.error("settleExercise: release", releaseError));
      throw error;
    }
  });
