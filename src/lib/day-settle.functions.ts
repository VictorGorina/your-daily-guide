import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import {
  cleanDayAdjustment,
  dayBalance,
  dayNote,
  dayReversing,
  mergeDayAdjustment,
  type DayAdjustmentRecord,
  type DayOutcome,
} from "@/lib/day-balance";
import { cleanDayExercise, pendingExerciseKcal, type DayExercise } from "@/lib/exercise";
import { compensationNeed } from "@/lib/nutrition/compensation";
import {
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  type MealChange,
  type MealHabit,
} from "@/lib/plan-shared";
import { cleanDaySnacks, pendingSnackKcal, type DaySnacks } from "@/lib/snacks";
import { zonedTodayISO } from "@/lib/zoned-date";

/**
 * Asentamiento del día (feature `balance-del-dia`).
 *
 * Sustituye a los tres asentamientos que había —`compensateDishChanges`
 * (cambio de plato), `settleSnacks` (picoteo) y `settleExercise` (deporte)—,
 * que hacían exactamente lo mismo sobre la misma ventana de días sin hablarse
 * entre ellos. El porqué, con los dos fallos que eso provocaba, está en
 * `day-balance.ts`.
 *
 * Aquí el día se resuelve de una pieza:
 *
 *  1. Si vienen cambios de plato, sus desvíos se funden en `habits`.
 *  2. Se suma el día entero (`dayBalance`) y se decide UNA vez
 *     (`compensationNeed`). Un día que se cancela solo no gasta ninguna llamada
 *     a la IA.
 *  3. Si hay que compensar, se reservan los tres libros de cuentas a la vez y
 *     se llama UNA vez a `reflowMeals` con la nota del día completo.
 *  4. El resultado se guarda a nivel de día (`daily_logs.adjustment`), que es
 *     lo que lee la tarjeta "Balance de hoy".
 *
 * Los tres libros de cuentas siguen existiendo y se reservan/liberan igual que
 * antes: son la procedencia del desglose que se enseña, y mantienen la garantía
 * de no compensar dos veces lo mismo. Lo que desaparece es que cada uno
 * decidiera por su cuenta.
 *
 * Ruta espejo en `src/routes/api/v1/day/settle.ts`.
 */

type Client = SupabaseClient<never, never, never>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayOf = (raw: unknown) => {
  const value = String(raw ?? "");
  return ISO_DATE.test(value) ? value : zonedTodayISO();
};

/** Veces que se relee y reintenta una escritura que se cruzó con otra. */
const WRITE_ATTEMPTS = 3;

/** Cambios de plato como mucho por lote: un tope contra un bucle. */
const DISH_CHANGE_MAX = 10;

type DishChange = {
  label: string;
  slot: string;
  dish: string;
  plannedDish: string;
  kcalDelta: number;
  /** `null` si no se sabe (cifra manual): no decide nada. */
  proteinDelta: number | null;
};

/** Lo que manda el cliente: una app móvil anterior al ticket 13 no manda proteína. */
type DishChangeInput = Omit<DishChange, "proteinDelta"> & { proteinDelta?: number | null };

type DayRow = {
  habits: MealHabit[];
  snacks: DaySnacks | null;
  exercise: DayExercise | null;
  record: DayAdjustmentRecord | null;
  updatedAt: string;
};

/** Lo que una pasada puede cambiar de la fila del día. */
type DayPatch = {
  habits?: MealHabit[];
  snacks?: DaySnacks | null;
  exercise?: DayExercise | null;
  record?: DayAdjustmentRecord | null;
};

/**
 * `daily_logs.adjustment` es la columna nueva de esta feature. Mientras la
 * migración no esté aplicada, PostgREST responde 42703: se detecta una vez y se
 * sigue sin ella (se compensa igual, solo que la tarjeta no puede enseñar los
 * platos movidos). Mismo criterio que `reflowMeals` con `snacks` — un despliegue
 * por delante de la migración no debe dejar la app sin compensar.
 */
let hasAdjustmentColumn = true;
const DAY_COLUMNS = "habits, snacks, exercise, adjustment, updated_at";
const DAY_COLUMNS_LEGACY = "habits, snacks, exercise, updated_at";

const isMissingColumn = (error: unknown) => (error as { code?: string } | null)?.code === "42703";

async function readDayRow(supabase: Client, userId: string, date: string): Promise<DayRow | null> {
  const query = () =>
    supabase
      .from("daily_logs")
      .select(hasAdjustmentColumn ? DAY_COLUMNS : DAY_COLUMNS_LEGACY)
      .eq("user_id", userId)
      .eq("log_date", date)
      .maybeSingle();

  let { data, error } = await query();
  if (error && hasAdjustmentColumn && isMissingColumn(error)) {
    hasAdjustmentColumn = false;
    ({ data, error } = await query());
  }
  if (error) throw error;
  if (!data) return null;

  const row = data as {
    habits?: unknown;
    snacks?: unknown;
    exercise?: unknown;
    adjustment?: unknown;
    updated_at: string;
  };
  return {
    habits: (Array.isArray(row.habits) ? row.habits : []) as MealHabit[],
    snacks: cleanDaySnacks(row.snacks),
    exercise: cleanDayExercise(row.exercise),
    record: cleanDayAdjustment(row.adjustment),
    updatedAt: row.updated_at,
  };
}

async function writeDayIfUnchanged(
  supabase: Client,
  userId: string,
  date: string,
  row: DayRow,
  patch: DayPatch,
): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (patch.habits !== undefined) update.habits = patch.habits;
  if (patch.snacks !== undefined) update.snacks = patch.snacks;
  if (patch.exercise !== undefined) update.exercise = patch.exercise;
  if (patch.record !== undefined && hasAdjustmentColumn) update.adjustment = patch.record;
  if (!Object.keys(update).length) return true;

  const { data, error } = await supabase
    .from("daily_logs")
    .update(update as never)
    .eq("user_id", userId)
    .eq("log_date", date)
    .eq("updated_at", row.updatedAt)
    .select("id");
  if (error && isMissingColumn(error) && hasAdjustmentColumn) {
    // La migración todavía no está: se reintenta sin la columna nueva.
    hasAdjustmentColumn = false;
    return false;
  }
  if (error) throw error;
  return !!data?.length;
}

/**
 * Lee, transforma y escribe la fila del día entera, reintentando si otra
 * escritura se cruzó.
 *
 * Que sea UNA lectura y UNA escritura de las cuatro columnas es parte del
 * arreglo: antes los tres asentamientos patcheaban columnas distintas de la
 * MISMA fila, cada uno con su guarda sobre `updated_at`, así que se invalidaban
 * entre sí y reintentaban sin necesidad.
 *
 * `null` si el día todavía no existe: la fila la crea siempre el cliente al
 * abrir Hoy, nunca esta función, así que sin fila no hay nada que asentar.
 */
async function patchDay(
  supabase: Client,
  userId: string,
  date: string,
  update: (row: DayRow) => DayPatch,
): Promise<DayRow | null> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = await readDayRow(supabase, userId, date);
    if (!row) return null;
    const patch = update(row);
    if (await writeDayIfUnchanged(supabase, userId, date, row, patch)) {
      return {
        ...row,
        ...(patch.habits !== undefined ? { habits: patch.habits } : {}),
        ...(patch.snacks !== undefined ? { snacks: patch.snacks } : {}),
        ...(patch.exercise !== undefined ? { exercise: patch.exercise } : {}),
        ...(patch.record !== undefined ? { record: patch.record } : {}),
      };
    }
  }
  throw new Error("No hemos podido guardar el ajuste del día. Inténtalo de nuevo.");
}

/** Dirección del objetivo, con el mismo criterio que `reflowMeals`. */
function goalOf(p: Record<string, unknown>): string | null {
  if (p.target_weight_kg != null) {
    const target = Number(p.target_weight_kg);
    const current = Number(p.current_weight_kg ?? p.start_weight_kg ?? target);
    return deriveGoalType(current, target);
  }
  return p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
}

/** Lo reservado en cada libro de cuentas, para poder devolverlo si algo falla. */
type Reservation = {
  labels: string[];
  snackKcal: number;
  exerciseKcal: number;
  total: number;
  /** Proteína pendiente (g, con signo) que se reservó con las comidas. */
  protein: number;
};

export type SettleDayResult = {
  outcome: DayOutcome;
  /** Desvío pendiente que se analizó, con signo. */
  kcal: number;
  changes?: MealChange[];
  summary?: string;
};

export const settleDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { today?: string; changes?: DishChangeInput[] }) => {
    const changes = (Array.isArray(input?.changes) ? input.changes : [])
      .slice(0, DISH_CHANGE_MAX)
      .map((c) => ({
        label: String(c?.label ?? "").slice(0, 60),
        slot: String(c?.slot ?? "").slice(0, 20),
        dish: String(c?.dish ?? "").slice(0, 200),
        plannedDish: String(c?.plannedDish ?? "").slice(0, 200),
        kcalDelta: Number.isFinite(Number(c?.kcalDelta)) ? Math.round(Number(c.kcalDelta)) : 0,
        proteinDelta:
          c?.proteinDelta != null && Number.isFinite(Number(c.proteinDelta))
            ? Math.round(Number(c.proteinDelta))
            : null,
      }))
      .filter((c) => c.label);
    return { today: todayOf(input?.today), changes };
  })
  .handler(async ({ data, context }): Promise<SettleDayResult> => {
    const supabase = context.supabase as never as Client;
    const { userId } = context;
    const { today, changes } = data;
    const month = today.slice(0, 7);

    const recordOutcome = async (outcome: DayOutcome) => {
      await patchDay(supabase, userId, today, (row) => ({
        record: { adjustment: row.record?.adjustment ?? null, lastOutcome: outcome },
      })).catch((err) => console.error("settleDay: recordOutcome", err));
    };

    // 1. Los desvíos de los platos cambiados en este lote entran en `habits`
    //    (sobrescriben el de la misma comida si ya se había cambiado hoy), y de
    //    paso se lee el día entero.
    const row = changes.length
      ? await patchDay(supabase, userId, today, (current) => {
          const byLabel = new Map(changes.map((c) => [c.label, c]));
          return {
            habits: current.habits.map((h) => {
              const c = byLabel.get(h.label);
              if (!c) return h;
              const { swapProteinDelta: _previous, ...rest } = h;
              return {
                ...rest,
                swapKcalDelta: c.kcalDelta,
                ...(c.proteinDelta != null ? { swapProteinDelta: c.proteinDelta } : {}),
                swapCompensated: false,
              };
            }),
          };
        })
      : await readDayRow(supabase, userId, today);
    if (!row) return { outcome: "no-plan", kcal: 0 };

    // 2. El día entero, de una pieza.
    const balance = dayBalance(row.habits, row.snacks, row.exercise);
    if (!balance.pending && !balance.proteinPending) return { outcome: "nothing", kcal: 0 };

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

    // 3. UNA decisión, con el desvío sumado de los tres orígenes: kcal y, desde
    //    el ticket 13, proteína (una bajada de ≥ 20 g se compensa siempre).
    const needInput = {
      deltaKcal: balance.pending,
      goal: goalOf(profile),
      pregnancyStatus: (profile.pregnancy_status as string | null) ?? null,
      reversing: dayReversing(balance),
    };
    const decision = compensationNeed({ ...needInput, deltaProtein: balance.proteinPending });
    // ¿Dispara SOLO la proteína? Cambia qué se hace si el modelo no mueve nada.
    const proteinOnly = decision.compensate && !compensationNeed(needInput).compensate;
    if (!decision.compensate) {
      await recordOutcome(decision.reason);
      return { outcome: decision.reason, kcal: balance.pending };
    }
    if (!planRow) {
      await recordOutcome("no-plan");
      return { outcome: "no-plan", kcal: balance.pending };
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
      return { outcome: window.reason, kcal: balance.pending };
    }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");
    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(userId, "plan-adjust");

    // 4. Reserva: los tres libros se marcan como compensados ANTES de llamar a
    //    la IA, releyendo lo último, para que un asentamiento simultáneo no
    //    compense lo mismo dos veces.
    let reservation: Reservation = {
      labels: [],
      snackKcal: 0,
      exerciseKcal: 0,
      total: 0,
      protein: 0,
    };
    const reserved = await patchDay(supabase, userId, today, (current) => {
      const now = dayBalance(current.habits, current.snacks, current.exercise);
      const labels = current.habits
        .filter(
          (h) => (h.swapKcalDelta != null || h.swapProteinDelta != null) && !h.swapCompensated,
        )
        .map((h) => h.label);
      const pendingSnacks = pendingSnackKcal(current.snacks);
      const pendingExercise = pendingExerciseKcal(current.exercise);
      reservation = {
        labels,
        snackKcal: pendingSnacks,
        exerciseKcal: pendingExercise,
        total: now.pending,
        protein: now.proteinPending,
      };
      return {
        habits: current.habits.map((h) =>
          labels.includes(h.label) ? { ...h, swapCompensated: true } : h,
        ),
        ...(pendingSnacks && current.snacks
          ? {
              snacks: {
                ...current.snacks,
                compensatedKcal: current.snacks.compensatedKcal + pendingSnacks,
              },
            }
          : {}),
        ...(pendingExercise && current.exercise
          ? {
              exercise: {
                ...current.exercise,
                compensatedKcal: current.exercise.compensatedKcal + pendingExercise,
              },
            }
          : {}),
      };
    });
    if (!reserved || (!reservation.total && !reservation.protein)) {
      return { outcome: "nothing", kcal: 0 };
    }

    const release = async () => {
      await patchDay(supabase, userId, today, (current) => ({
        habits: current.habits.map((h) =>
          reservation.labels.includes(h.label) ? { ...h, swapCompensated: false } : h,
        ),
        ...(reservation.snackKcal && current.snacks
          ? {
              snacks: {
                ...current.snacks,
                compensatedKcal: current.snacks.compensatedKcal - reservation.snackKcal,
              },
            }
          : {}),
        ...(reservation.exerciseKcal && current.exercise
          ? {
              exercise: {
                ...current.exercise,
                compensatedKcal: current.exercise.compensatedKcal - reservation.exerciseKcal,
              },
            }
          : {}),
      })).catch((err) => console.error("settleDay: release", err));
    };

    try {
      const { reflowMeals } = await import("@/lib/plan.functions");
      const changedMeals = row.habits
        .filter((h) => h.status === "distinto" && h.swapKcalDelta != null)
        .map((h) => ({
          label: h.label,
          dish: h.confirmedIdea || h.actual || "",
          plannedDish: h.plannedIdea || h.wasIdea || "",
        }));
      const { plan, before, summary, absorbedKcal, partial } = await reflowMeals({
        supabase,
        userId,
        key,
        month,
        today,
        note: dayNote({
          // Los platos de ESTE lote se conocen con su texto exacto; para los de
          // lotes anteriores del mismo día vale lo que quedó en el registro.
          changedMeals: changes.length ? changes : changedMeals,
          snackEntries: row.snacks?.entries ?? [],
          exerciseEntries: row.exercise?.entries ?? [],
          pendingKcal: reservation.total,
          reversing: dayReversing(balance),
          proteinDrop: decision.proteinDelta,
        }),
        kcalDelta: decision.kcalDelta,
        window: window.dates,
        soloOnly: true,
        // Ticket 18: lo que la tarjeta dice haber movido es lo que se midió.
        measure: true,
      });
      const futureChanges = diffFutureMeals(before, plan, today);
      // Solo la proteína disparaba y el modelo no ha movido nada: se devuelve la
      // reserva (no está compensado) pero SIN lanzar, para que el cliente no lo
      // reintente cada minuto; el siguiente asentamiento del día lo retoma.
      if (!futureChanges.length && proteinOnly) {
        await release();
        await recordOutcome("below-threshold");
        return { outcome: "below-threshold", kcal: reservation.total };
      }
      // Un desvío por encima del umbral que no mueve ningún plato no está
      // compensado: si se diera por bueno, el exceso se perdería en silencio.
      // Se trata como intento fallido (se devuelve la reserva) y el cliente lo
      // reintenta más tarde.
      if (!futureChanges.length) throw new Error("El reajuste no ha cambiado ningún plato");

      await patchDay(supabase, userId, today, (current) => ({
        record: {
          adjustment: mergeDayAdjustment(current.record?.adjustment, {
            changes: futureChanges,
            summary,
            kcal: reservation.total,
            ...(absorbedKcal != null ? { absorbedKcal } : {}),
            ...(partial ? { partial: true } : {}),
          }),
          lastOutcome: "adjusted",
        },
      }));
      return {
        outcome: "adjusted",
        kcal: reservation.total,
        changes: futureChanges,
        summary,
      };
    } catch (error) {
      await release();
      throw error;
    }
  });
