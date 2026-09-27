import { goalDirection } from "@/lib/goal";
import { updateDailyLogCas } from "@/lib/daily-rows.server";
import {
  adjustmentColumn,
  cleanDayAdjustment,
  cleanPendingReservations,
  type DayAdjustmentRecord,
  dayBalance,
  dayNote,
  type DayOutcome,
  type DayReservation,
  dayReversing,
  EMPTY_RESERVATION,
  mergeDayAdjustment,
  type PendingReservation,
  releaseDay,
  releaseReservations,
  reserveDay,
  staleReservations,
} from "@/lib/day-balance";
import { requestDeadline } from "@/lib/deadline";
import { cleanDayExercise, type DayExercise } from "@/lib/exercise";
import { errorText, logEvent } from "@/lib/log.server";
import { compensationNeed } from "@/lib/nutrition/compensation";
import {
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  type MealHabit,
} from "@/lib/plan-shared";
import { cleanDaySnacks, type DaySnacks } from "@/lib/snacks";
import { requireAiKey } from "@/lib/ai-provider.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SettleDayDeps, SettleDayResult } from "./day-settle.functions";

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

export type DishChange = {
  label: string;
  slot: string;
  dish: string;
  plannedDish: string;
  kcalDelta: number;
  /** `null` si no se sabe (cifra manual): no decide nada. */
  proteinDelta: number | null;
};

type DayRow = {
  habits: MealHabit[];
  snacks: DaySnacks | null;
  exercise: DayExercise | null;
  record: DayAdjustmentRecord | null;
  /** Reservas en vuelo (ticket 22): viven en la misma columna que `record`. */
  pending: PendingReservation[];
};

/** Lo que una pasada puede cambiar de la fila del día. */
type DayPatch = {
  habits?: MealHabit[];
  snacks?: DaySnacks | null;
  exercise?: DayExercise | null;
  record?: DayAdjustmentRecord | null;
  pending?: PendingReservation[];
};

/**
 * `daily_logs.adjustment` es la columna nueva de esta feature. Mientras la
 * migración no esté aplicada, PostgREST responde 42703: se detecta una vez y se
 * sigue sin ella (se compensa igual, solo que la tarjeta no puede enseñar los
 * platos movidos). Mismo criterio que `reflowMeals` con `snacks` — un despliegue
 * por delante de la migración no debe dejar la app sin compensar.
 */
let hasAdjustmentColumn = true;
let warnedNoAdjustmentColumn = false;
const DAY_COLUMNS = "habits, snacks, exercise, adjustment, updated_at";
const DAY_COLUMNS_LEGACY = "habits, snacks, exercise, updated_at";

const isMissingColumn = (error: unknown) => (error as { code?: string } | null)?.code === "42703";

function toDayRow(row: Record<string, unknown>): DayRow {
  return {
    habits: (Array.isArray(row.habits) ? row.habits : []) as MealHabit[],
    snacks: cleanDaySnacks(row.snacks),
    exercise: cleanDayExercise(row.exercise),
    record: cleanDayAdjustment(row.adjustment),
    pending: cleanPendingReservations(row.adjustment),
  };
}

/** Las columnas que escribe `patch`; `null` si no cambia ninguna. */
function dayColumns(row: DayRow, patch: DayPatch): Record<string, unknown> | null {
  const update: Record<string, unknown> = {};
  if (patch.habits !== undefined) update.habits = patch.habits;
  if (patch.snacks !== undefined) update.snacks = patch.snacks;
  if (patch.exercise !== undefined) update.exercise = patch.exercise;
  // Registro y reservas comparten columna: se escribe siempre la pareja, con lo
  // leído en la parte que el parche no cambia (si no, guardar el resultado de
  // un asentamiento borraría la reserva en vuelo de otro).
  if ((patch.record !== undefined || patch.pending !== undefined) && hasAdjustmentColumn) {
    update.adjustment = adjustmentColumn(
      patch.record !== undefined ? patch.record : row.record,
      patch.pending ?? row.pending,
    );
  }
  return Object.keys(update).length ? update : null;
}

/**
 * Lee, transforma y escribe la fila del día entera con `updateDailyLogCas`,
 * reintentando si otra escritura se cruzó.
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
  // Lo que se leyó y se aplicó en el último intento (el que escribió).
  const last: { row?: DayRow; patch: DayPatch } = { patch: {} };
  const write = () =>
    updateDailyLogCas(
      supabase,
      userId,
      date,
      hasAdjustmentColumn ? DAY_COLUMNS : DAY_COLUMNS_LEGACY,
      (latest) => {
        last.row = toDayRow(latest);
        last.patch = update(last.row);
        return dayColumns(last.row, last.patch);
      },
      { exhaustedMessage: "No hemos podido guardar el ajuste del día. Inténtalo de nuevo." },
    );

  try {
    await write();
  } catch (error) {
    // La migración todavía no está: se repite sin la columna nueva.
    if (!hasAdjustmentColumn || !isMissingColumn(error)) throw error;
    hasAdjustmentColumn = false;
    last.row = undefined;
    await write();
  }
  const { row, patch } = last;
  if (!row) return null;
  return {
    ...row,
    ...(patch.habits !== undefined ? { habits: patch.habits } : {}),
    ...(patch.snacks !== undefined ? { snacks: patch.snacks } : {}),
    ...(patch.exercise !== undefined ? { exercise: patch.exercise } : {}),
    ...(patch.record !== undefined ? { record: patch.record } : {}),
    ...(patch.pending !== undefined ? { pending: patch.pending } : {}),
  };
}

export type SettleDayInput = { today: string; changes: DishChange[] };

export async function settleDayHandler(
  { data, context }: { data: SettleDayInput; context: { supabase: unknown; userId: string } },
  deps: SettleDayDeps = {},
): Promise<SettleDayResult> {
  const deadline = requestDeadline();
  const supabase = context.supabase as never as Client;
  const { userId } = context;
  const { today, changes } = data;
  const month = today.slice(0, 7);

  const recordOutcome = async (outcome: DayOutcome) => {
    await patchDay(supabase, userId, today, (row) => ({
      record: { adjustment: row.record?.adjustment ?? null, lastOutcome: outcome },
    })).catch((err) =>
      logEvent("warn", "settle_outcome_failed", { userId, date: today, error: errorText(err) }),
    );
  };

  // 1. Una reserva de otro asentamiento que murió a medias (ticket 22) se
  //    devuelve antes de nada: así su desvío entra en la cuenta de hoy en vez
  //    de quedarse "compensado" sin estarlo. Los desvíos de los platos
  //    cambiados en este lote entran en `habits` (sobrescriben el de la misma
  //    comida si ya se había cambiado hoy), y de paso se lee el día entero.
  //    Sin nada de eso no se escribe: el parche vacío es solo una lectura.
  const byLabel = new Map(changes.map((c) => [c.label, c]));
  let expired: PendingReservation[] = [];
  const row = await patchDay(supabase, userId, today, (current) => {
    expired = staleReservations(current.pending);
    const released: DayPatch = expired.length
      ? {
          ...releaseReservations(current, expired),
          pending: current.pending.filter((p) => !expired.includes(p)),
        }
      : {};
    if (!changes.length) return released;
    return {
      ...released,
      habits: (released.habits ?? current.habits).map((h) => {
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
  });
  if (!row) return { outcome: "no-plan", kcal: 0 };
  if (expired.length) {
    logEvent("warn", "settle_reservation_expired", {
      userId,
      date: today,
      count: expired.length,
      kcal: expired.reduce((sum, p) => sum + p.reservation.total, 0),
    });
  }

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
    goal: goalDirection(profile),
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

  const key = requireAiKey();
  const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
  await enforceUserRateLimit(userId, "plan-adjust");

  // 4. Reserva: los tres libros se marcan como compensados ANTES de llamar a
  //    la IA, releyendo lo último, para que un asentamiento simultáneo no
  //    compense lo mismo dos veces. En la misma escritura va la marca de la
  //    reserva (`pending`, ticket 22): si esta petición muere antes de dejar el
  //    resultado, la siguiente la encuentra caducada y la devuelve.
  let reservation: DayReservation = EMPTY_RESERVATION;
  const pendingId = crypto.randomUUID();
  const reserved = await patchDay(supabase, userId, today, (current) => {
    const reserve = reserveDay(current);
    reservation = reserve.reservation;
    if (!reservation.total && !reservation.protein) return reserve.patch;
    const mark = { id: pendingId, since: new Date().toISOString(), reservation };
    return { ...reserve.patch, pending: [...current.pending, mark] };
  });
  if (!reserved || (!reservation.total && !reservation.protein)) {
    return { outcome: "nothing", kcal: 0 };
  }
  if (!hasAdjustmentColumn && !warnedNoAdjustmentColumn) {
    // Sin la columna no hay dónde dejar la marca: la reserva no caduca.
    warnedNoAdjustmentColumn = true;
    logEvent("warn", "settle_no_adjustment_column", {});
  }
  /** Quita la marca de esta reserva (el resto de reservas en vuelo se queda). */
  const withoutMine = (current: DayRow) => current.pending.filter((p) => p.id !== pendingId);

  const release = async () => {
    await patchDay(supabase, userId, today, (current) => {
      // Ya devuelta por otro asentamiento (caducada): devolverla otra vez
      // restaría el picoteo y el deporte dos veces.
      if (hasAdjustmentColumn && !current.pending.some((p) => p.id === pendingId)) return {};
      return { ...releaseDay(current, reservation), pending: withoutMine(current) };
    }).catch((err) =>
      // La marca se queda: el siguiente asentamiento la devuelve al caducar.
      logEvent("error", "settle_release_failed", {
        userId,
        date: today,
        error: errorText(err),
      }),
    );
  };

  try {
    const reflowMeals = deps.reflow ?? (await import("@/lib/plan/reflow.server")).reflowMeals;
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
      deadline,
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
      pending: withoutMine(current),
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
}
