import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import type { MacroEstimate } from "@/lib/guide.functions";
import { compensationNeed } from "@/lib/nutrition/compensation";
import {
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  type MealChange,
} from "@/lib/plan-shared";
import {
  cleanDaySnacks,
  mergeAdjustment,
  pendingSnackKcal,
  SNACK_KCAL_MAX,
  SNACK_TEXT_MAX,
  SNACK_TEXT_MIN,
  snackNote,
  withSnack,
  withoutSnack,
  type DaySnacks,
  type SnackEntry,
  type SnackOutcome,
} from "@/lib/snacks";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";

/**
 * Picoteo de Hoy (feature `picoteo-hoy`, spec en `.scratch/picoteo-hoy/`).
 *
 * - `estimateSnack` calcula las kcal de lo que se picó (tabla de composición,
 *   una llamada barata al modelo para descomponerlo), para enseñarlas antes de
 *   guardar.
 * - `logSnack` / `removeSnack` escriben SOLO la columna `daily_logs.snacks` de
 *   hoy, así que no chocan con las escrituras de `habits` del cliente.
 * - `settleSnacks` decide en código (`compensationNeed`) si el picoteo aún no
 *   compensado pide recolocar días futuros, y en ese caso llama a
 *   `reflowMeals`. El cliente solo avisa de que hay algo que asentar; lo que
 *   hay pendiente lo dice la base de datos.
 *
 * Cada operación tiene su ruta espejo en `src/routes/api/v1/snacks/`.
 */

type Client = SupabaseClient<never, never, never>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayOf = (raw: unknown) => {
  const value = String(raw ?? "");
  return ISO_DATE.test(value) ? value : zonedTodayISO();
};

/** Veces que se relee y reintenta una escritura que se cruzó con otra. */
const WRITE_ATTEMPTS = 3;

type SnackRow = { snacks: DaySnacks | null; updatedAt: string } | null;

async function readSnackRow(supabase: Client, userId: string, date: string): Promise<SnackRow> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("snacks, updated_at")
    .eq("user_id", userId)
    .eq("log_date", date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { snacks?: unknown; updated_at: string };
  return { snacks: cleanDaySnacks(row.snacks), updatedAt: row.updated_at };
}

/**
 * Escribe la columna solo si nadie la ha tocado desde que se leyó
 * (`updated_at`). Devuelve false si se cruzó otra escritura.
 */
async function writeSnacksIfUnchanged(
  supabase: Client,
  userId: string,
  date: string,
  row: NonNullable<SnackRow>,
  snacks: DaySnacks,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("daily_logs")
    .update({ snacks } as never)
    .eq("user_id", userId)
    .eq("log_date", date)
    .eq("updated_at", row.updatedAt)
    .select("id");
  if (error) throw error;
  return !!data?.length;
}

/**
 * Lee, transforma y escribe la columna de hoy, reintentando si otra escritura
 * se cruzó. Crea la fila del día si todavía no existe (la policy "insert recent
 * own log" lo permite para hoy). `update` recibe `null` si no había picoteo.
 */
async function patchSnacks(
  supabase: Client,
  userId: string,
  date: string,
  update: (current: DaySnacks | null) => DaySnacks,
): Promise<DaySnacks> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = await readSnackRow(supabase, userId, date);
    const next = update(row?.snacks ?? null);
    if (!row) {
      const { error } = await supabase
        .from("daily_logs")
        .insert({ user_id: userId, log_date: date, snacks: next } as never);
      if (!error) return next;
      // 23505: el cliente creó la fila a la vez. Se relee y se actualiza.
      if ((error as { code?: string }).code !== "23505") throw error;
      continue;
    }
    if (await writeSnacksIfUnchanged(supabase, userId, date, row, next)) return next;
  }
  throw new Error("No hemos podido guardar el picoteo. Inténtalo de nuevo.");
}

const cleanMacros = (raw: unknown): MacroEstimate => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown, max: number) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) return 0;
    return Math.min(max, Math.round(x));
  };
  const kcal = Number(o.kcal);
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > SNACK_KCAL_MAX) {
    throw new ValidationError(`Las kcal tienen que estar entre 0 y ${SNACK_KCAL_MAX}.`);
  }
  return {
    kcal: Math.round(kcal),
    protein_g: n(o.protein_g, 300),
    carbs_g: n(o.carbs_g, 600),
    fat_g: n(o.fat_g, 300),
    fiber_g: n(o.fiber_g, 100),
  };
};

const cleanText = (raw: unknown) => {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < SNACK_TEXT_MIN) throw new ValidationError("Cuéntame qué has picado.");
  return text.slice(0, SNACK_TEXT_MAX);
};

// ---------------------------------------------------------------------------
// estimateSnack
// ---------------------------------------------------------------------------

export type SnackEstimate = {
  /** Hay cifra en la que confiar. Si no, la hoja pide las kcal a mano. */
  resolved: boolean;
  macros: MacroEstimate | null;
  /** Parte de lo descrito no se reconoció: conviene revisar la cifra. */
  lowConfidence: boolean;
  /** Lo que se ha entendido, para enseñarlo bajo la cifra. */
  ingredients: { name: string; grams: number }[];
};

/**
 * Por debajo de esta proporción de gramos identificados no se da cifra: la
 * precisión de las kcal es la base de la app, y un número inventado con el
 * alimento genérico es peor que pedirlo a mano.
 */
const MIN_QUALITY = 0.4;
/** Por debajo de esta, la cifra se da pero con aviso de revisarla. */
const SURE_QUALITY = 0.7;

export const estimateSnack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { text: string }) => ({ text: cleanText(input?.text) }))
  .handler(async ({ data, context }): Promise<SnackEstimate> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "snack-estimate");

    const { dishToIngredients } = await import("@/lib/nutrition/resolve-dish.server");
    const b = await dishToIngredients(data.text, {
      servings: 1,
      apiKey: key,
      userId: context.userId,
    });
    // Un refresco sin azúcar da 0 kcal de verdad: lo que decide es si se
    // entendió lo descrito, no que la cifra sea positiva.
    const resolved = b.source === "model" && b.ingredients.length > 0 && b.quality >= MIN_QUALITY;
    return {
      resolved,
      macros: resolved ? b.perServing : null,
      lowConfidence: resolved && b.quality < SURE_QUALITY,
      ingredients: b.ingredients.map((i) => ({ name: i.name, grams: i.grams })),
    };
  });

// ---------------------------------------------------------------------------
// logSnack / removeSnack
// ---------------------------------------------------------------------------

export const logSnack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { today?: string; text: string; macros: MacroEstimate; source?: string }) => ({
    today: todayOf(input?.today),
    text: cleanText(input?.text),
    macros: cleanMacros(input?.macros),
    source: input?.source === "manual" ? ("manual" as const) : ("lookup" as const),
  }))
  .handler(async ({ data, context }): Promise<{ snacks: DaySnacks; entry: SnackEntry }> => {
    const entry: SnackEntry = {
      id: crypto.randomUUID(),
      text: data.text,
      at: new Date().toISOString(),
      ...data.macros,
      source: data.source,
    };
    const snacks = await patchSnacks(
      context.supabase as never,
      context.userId,
      data.today,
      (current) => withSnack(current, entry),
    );
    return { snacks, entry };
  });

export const removeSnack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { today?: string; id: string }) => {
    const id = String(input?.id ?? "").trim();
    if (!id) throw new ValidationError("Falta el picoteo que quieres quitar.");
    return { today: todayOf(input?.today), id };
  })
  .handler(async ({ data, context }): Promise<{ snacks: DaySnacks }> => {
    const snacks = await patchSnacks(
      context.supabase as never,
      context.userId,
      data.today,
      (current) => withoutSnack(current, data.id),
    );
    return { snacks };
  });

// ---------------------------------------------------------------------------
// settleSnacks — la compensación
// ---------------------------------------------------------------------------

export type SettleSnacksResult = {
  /** `nothing`: no había nada pendiente. */
  outcome: SnackOutcome | "nothing";
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

export const settleSnacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { today?: string }) => ({ today: todayOf(input?.today) }))
  .handler(async ({ data, context }): Promise<SettleSnacksResult> => {
    const supabase = context.supabase as never as Client;
    const { userId } = context;
    const { today } = data;
    const month = today.slice(0, 7);

    const recordOutcome = (outcome: SnackOutcome) =>
      patchSnacks(supabase, userId, today, (current) => ({
        ...(current ?? { entries: [], compensatedKcal: 0 }),
        lastOutcome: outcome,
      }));

    const first = await readSnackRow(supabase, userId, today);
    const firstPending = pendingSnackKcal(first?.snacks);
    if (!first?.snacks || firstPending === 0) return { outcome: "nothing", kcal: 0 };

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
    let entries: SnackEntry[] = [];
    await patchSnacks(supabase, userId, today, (current) => {
      const base = current ?? { entries: [], compensatedKcal: 0 };
      reserved = pendingSnackKcal(base);
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
        note: snackNote(entries, reserved),
        kcalDelta: reserved,
        window: window.dates,
        soloOnly: true,
      });
      const changes = diffFutureMeals(before, plan, today);
      // Un desvío por encima del umbral que no mueve ningún plato no está
      // compensado: si se diera por bueno, el exceso se perdería en silencio.
      // Se trata como un intento fallido (se devuelve la reserva abajo) y el
      // cliente lo reintenta más tarde.
      if (!changes.length) throw new Error("El reajuste no ha cambiado ningún plato");
      await patchSnacks(supabase, userId, today, (current) => {
        const base = current ?? { entries: [], compensatedKcal: reserved };
        return {
          ...base,
          adjustment: mergeAdjustment(base.adjustment, { changes, summary, kcal: reserved }),
          lastOutcome: "adjusted",
        };
      });
      return { outcome: "adjusted", kcal: reserved, changes, summary };
    } catch (error) {
      // Se devuelve la reserva: lo pendiente se volverá a intentar.
      await patchSnacks(supabase, userId, today, (current) => {
        const base = current ?? { entries: [], compensatedKcal: reserved };
        return { ...base, compensatedKcal: base.compensatedKcal - reserved };
      }).catch((releaseError) => console.error("settleSnacks: release", releaseError));
      throw error;
    }
  });
