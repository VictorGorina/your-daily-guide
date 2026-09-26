import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, streamText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_MODEL,
  coachSystemPrompt,
  createAiProvider,
  currencySymbol,
  PLAN_MODEL,
} from "@/lib/ai-provider.server";
import { assertCleanFood, BLOCKED_FOOD_MESSAGE, VAGUE_DISH_MESSAGE } from "@/lib/content-guard";
import { showsNutritionNumbers } from "@/lib/macros";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import {
  describeServings,
  describeSharedSlots,
  EMPTY_SCHEDULE,
  isSharedSlot,
  MEAL_KEYS as HOUSEHOLD_MEAL_KEYS,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";
import {
  cadenceOf,
  carryOwnedByName,
  carryOwnedCanonical,
  childPureeGaps,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  cleanTripActuals,
  cleanTripConfirmations,
  cleanTripReceipts,
  completePlan,
  composeMonthlyPlanForMember,
  compensationWindow,
  coverageRatio,
  diffFutureMeals,
  effectiveMealSlots,
  addKcalAdjust,
  applyPlanChanges,
  applyPlanFitChanges,
  awayPlanLine,
  cleanReflowChanges,
  dateOfPlanCell,
  daysInMonth,
  formatShoppingQty,
  ingredientNames,
  isCanonicalShopping,
  isNextMonthUnlocked,
  isPinned,
  mealsForDate,
  mergeFuturePlan,
  mergeFutureKids,
  monthCoverage,
  nextMonthISO,
  pendingSwapKcal,
  planForDate,
  repartitionTrips,
  tripDayRange,
  tripsForCoverage,
  type MealChange,
  type MealHabit,
  type PlanCoverage,
  type ShoppingCadence,
  MEAL_SLOTS,
  MEAL_SLOT_LABEL,
  parseJsonLoose,
  planCursor,
  planDayOf,
  planSlotIndex,
  shoppingTotal,
  normName,
  weekdayName,
  type ChildMeal,
  type KcalAdjustCell,
  type MealSlot,
  type MonthConstraints,
  type MonthlyPlan,
  type PantryExtra,
  PLAN_TARGETS_VERSION,
  type PlanChange,
  type PlanDay,
  type PlanFitMark,
  type ShoppingList,
  type TripActuals,
  type TripConfirmations,
  type TripReceipts,
  withPlanMeal,
  monthTitle,
  assertShoppingStateColumns,
  withOwnedMark,
} from "@/lib/plan-shared";
import { cleanIntakeText, monthIntakeNotes, type IntakeAnswers } from "@/lib/month-intake";
import { absorbedKcal, absorbsTooLittle } from "@/lib/day-balance";
import { PLAN_STRUCTURE_REMINDER } from "@/lib/nutrition/plan-targets";
import { compensationNeed } from "@/lib/nutrition/compensation";
import { logEvent } from "@/lib/log.server";
import { RateLimitError } from "@/lib/rate-limit-error";
import { cleanDaySnacks } from "@/lib/snacks";
import { zonedTodayISO } from "@/lib/zoned-date";
import { ValidationError } from "@/lib/validation-error";
// Solo el tipo: se borra en compilación, así que no arrastra `household.server`
// (ni su cliente de servicio) al bundle del navegador. El runtime de este
// contexto se carga siempre con `await import("@/lib/household.server")`.
import type { HouseholdContext } from "@/lib/household.server";
import type { Misfit, WeeklyIdea } from "@/lib/nutrition/plan-fit";
import type { RotationMisfit } from "@/lib/nutrition/plan-fit.server";

export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";

/**
 * `MealSlot` (plan-shared, 4 comidas) y `MealKey` (household-shared, issue 03)
 * comparten los mismos 3 nombres para desayuno/comida/cena — solo el snack no
 * tiene equivalente, porque nunca es una comida compartida del hogar (D5).
 */
const mealKeyOf = (slot: MealSlot): MealKey | null => (slot === "snack" ? null : slot);

/** Lee lo que la persona avisó para un mes antes de generar el plan (§`setMonthConstraints`). */
async function fetchMonthConstraints(
  supabase: SupabaseClient,
  userId: string,
  month: string,
): Promise<MonthConstraints | null> {
  const { data } = await supabase
    .from("month_constraints")
    .select("away_start, away_end, notes")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (!data) return null;
  const row = data as { away_start: string | null; away_end: string | null; notes: string | null };
  return { month, awayStart: row.away_start, awayEnd: row.away_end, notes: row.notes };
}

/**
 * Lee la fila `monthly_plans` PROPIA del que llama para un mes. Se filtra por
 * `user_id` siempre: desde issue 05 hay una policy de SELECT en `monthly_plans`
 * que también deja a un miembro del hogar leer la fila del planificador, así que
 * un `.maybeSingle()` filtrado solo por `month` devolvería 2 filas (y un error
 * PGRST116) cuando lo llama un no planificador. Toda escritura de estas server
 * functions ya usa el mismo filtro `.eq("user_id", context.userId)`; esto lo
 * hace también en la lectura previa.
 */
function ownPlanRow(
  supabase: SupabaseClient<never, never, never>,
  userId: string,
  month: string,
  columns: string,
) {
  return supabase
    .from("monthly_plans")
    .select(columns)
    .eq("month", month)
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * Fila `monthly_plans` sobre la que se escribe el ESTADO de compra: marcas
 * "lo tengo en casa"/"comprado", gasto real, tiquets, despensa extra y cierre
 * de tramos. En un hogar esa lista vive en la fila del planificador y cualquier
 * miembro con cuenta puede tocar su estado (issue 06) — nunca los platos ni las
 * cantidades.
 *
 *  - Sin hogar, o si quien llama ES el planificador → su propia fila
 *    (`isMine: true`), lectura y escritura con el cliente de sesión.
 *  - Miembro no planificador → la fila del planificador (`isMine: false`); RLS
 *    solo deja LEER esa fila (policy de issue 05), así que las lecturas y
 *    escrituras van con `supabaseAdmin` y limitadas a columnas de estado.
 *
 * La membresía queda verificada por `householdPlannerId`: solo devuelve un id
 * no nulo cuando quien llama es miembro del mismo hogar. Es una sola consulta,
 * mucho más ligera que `householdContext`, porque este camino se recorre en
 * cada marca de "lo tengo en casa".
 */
async function resolveShoppingRow(
  supabase: unknown,
  userId: string,
): Promise<{ targetUserId: string; isMine: boolean }> {
  const { householdPlannerId } = await import("@/lib/household.server");
  const plannerId = await householdPlannerId(supabase as never, userId);
  if (!plannerId || plannerId === userId) {
    return { targetUserId: userId, isMine: true };
  }
  return { targetUserId: plannerId, isMine: false };
}

/** Lee la fila objetivo del estado de compra (propia con el cliente de sesión;
 *  la del planificador con `supabaseAdmin`, ver `resolveShoppingRow`). */
async function readShoppingRow<T>(
  supabase: unknown,
  target: { targetUserId: string; isMine: boolean },
  month: string,
  columns: string,
): Promise<T | null> {
  if (target.isMine) {
    const { data } = await ownPlanRow(supabase as never, target.targetUserId, month, columns);
    return (data as T | null) ?? null;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("monthly_plans")
    .select(columns)
    .eq("user_id", target.targetUserId)
    .eq("month", month)
    .maybeSingle();
  return (data as T | null) ?? null;
}

/** Escribe SOLO columnas de estado de compra en la fila objetivo. El `patch`
 *  nunca incluye `plan` ni `weekQty`: un no planificador jamás toca los platos
 *  ni las cantidades de la lista de la casa (issue 06). */
async function writeShoppingState(
  supabase: unknown,
  target: { targetUserId: string; isMine: boolean },
  month: string,
  patch: Record<string, unknown>,
): Promise<{ error: unknown }> {
  // Barandilla, no comentario: cuando la fila es de otra persona esto escribe
  // con `supabaseAdmin`, que se salta RLS. Se comprueba aquí en vez de confiar
  // en que cada sitio que llama respete la lista.
  assertShoppingStateColumns(patch);
  if (target.isMine) {
    const { error } = await (supabase as SupabaseClient<never, never, never>)
      .from("monthly_plans")
      .update(patch as never)
      .eq("month", month)
      .eq("user_id", target.targetUserId);
    return { error };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("monthly_plans")
    .update(patch as never)
    .eq("user_id", target.targetUserId)
    .eq("month", month);
  return { error };
}

/**
 * Si esa comida de ese día es compartida y quien llama NO es quien planifica
 * en casa, el cambio no es suyo que hacer (D2). `date` decide el día de la
 * semana; si no hay hogar o la comida no se comparte, no hay nada que impedir.
 */
async function guardSharedSlotWrite(
  supabase: unknown,
  userId: string,
  date: string,
  slot: MealSlot,
): Promise<void> {
  const mealKey = mealKeyOf(slot);
  if (!mealKey) return;
  const { householdContext } = await import("@/lib/household.server");
  const home = await householdContext(supabase as never, userId);
  if (!home.plannerId || home.plannerId === userId) return;
  const weekday = planCursor(date).dayIndex;
  if (!isSharedSlot(home.sharedSlots, mealKey, weekday)) return;
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  throw new ValidationError(
    `Esa comida la lleva ${plannerName} de tu casa. Puedo cambiar tus comidas en solitario.`,
  );
}

/**
 * Vacía en un plan las comidas que ese día son compartidas del hogar. Lo usa
 * el modo "solo mis comidas" de un no planificador: su fila `monthly_plans`
 * no debe guardar el plato de una comida de la casa (lo pone el espejo /
 * la composición en lectura). El desayuno se comparte "todo o nada" a nivel
 * de rotación semanal, igual que en `syncSharedMeals` / `composeDayForUser`.
 */
function blankSharedSlots(plan: MonthlyPlan, sharedSlots: SharedSlots): MonthlyPlan {
  const desayunoShared = sharedSlots.desayuno.length > 0;
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      breakfasts: desayunoShared ? [] : week.breakfasts,
      days: week.days.map((day, di) => {
        const next: PlanDay = { ...day };
        if (isSharedSlot(sharedSlots, "comida", di)) next.lunch = "";
        if (isSharedSlot(sharedSlots, "cena", di)) next.dinner = "";
        if (desayunoShared) delete next.breakfast;
        // Los platos aparte de un niño (issue 07) los lleva el planificador:
        // la fila de un no planificador solo conserva los de un slot que ese
        // día no sea compartido (raro), el resto los pone el espejo.
        const kids = (next.kids ?? []).filter(
          (k) => k.slot !== "snack" && !isSharedSlot(sharedSlots, k.slot, di),
        );
        if (kids.length) next.kids = kids;
        else delete next.kids;
        return next;
      }),
    })),
  };
}

/**
 * Vacía en un plan las comidas de un slot que la persona no eligió planificar
 * (`effectiveMealSlots`, slots elegidos para el plan). Es el cinturón, no el único freno: el
 * prompt ya le pide a la IA que no rellene esos slots, pero un modelo no
 * siempre obedece al pie de la letra, así que esto lo garantiza pase lo que
 * pase. `mealsForDate` (plan-shared.ts) es el otro cinturón, en el lado de
 * lectura: aunque quedara contenido aquí por lo que sea, ese filtro de
 * pantalla tampoco lo enseñaría.
 */
function blankUnselectedSlots(plan: MonthlyPlan, selected: readonly MealSlot[]): MonthlyPlan {
  const wants = new Set(selected);
  const keep = (slot: MealSlot) => wants.has(slot);
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      breakfasts: keep("desayuno") ? week.breakfasts : [],
      snacks: keep("snack") ? week.snacks : [],
      days: week.days.map((day) => {
        const next: PlanDay = { ...day };
        if (!keep("desayuno")) delete next.breakfast;
        if (!keep("comida")) next.lunch = "";
        if (!keep("cena")) next.dinner = "";
        if (!keep("snack")) delete next.snack;
        // El plato aparte de un niño (issue 07) tampoco tiene sentido en un
        // slot que la persona ni planifica para sí misma.
        const kids = (next.kids ?? []).filter((k) => keep(k.slot));
        if (kids.length) next.kids = kids;
        else delete next.kids;
        return next;
      }),
    })),
  };
}

/** Pide el JSON al modelo en streaming (evita cortes por timeout) y lo intenta varias veces. */
async function askForJson<T>(
  opts: { key: string; userId: string; system: string; prompt: string; model?: string },
  extract: (parsed: unknown) => T | null,
  attempts = 3,
): Promise<T> {
  const ai = createAiProvider(opts.key, opts.userId);
  let lastError: unknown = null;

  for (let i = 0; i < attempts; i++) {
    // Un error del modelo en streaming no llega tal cual a `result.text` (que
    // rechaza con un genérico "No output generated"), solo a `onError`.
    let streamError: unknown = null;
    try {
      const result = streamText({
        model: ai(opts.model ?? COACH_MODEL),
        system: opts.system,
        prompt:
          i === 0
            ? opts.prompt
            : `${opts.prompt}\n\nIMPORTANTE: el intento anterior no fue válido. Devuelve EXCLUSIVAMENTE el JSON completo y cerrado, sin markdown, sin comentarios y sin texto antes o después.`,
        temperature: i === 0 ? 0.7 : 0.3,
        onError: ({ error }) => {
          streamError = error;
          // Sustituye al log por defecto del SDK; el tope ya se registra al saltar.
          if (!(error instanceof RateLimitError)) console.error("askForJson stream", error);
        },
      });
      const text = await result.text;
      const value = extract(parseJsonLoose(text));
      if (value) return value;
      lastError = new Error("JSON incompleto");
    } catch (e) {
      // Tope de gasto: reintentar no lo cambia y el mensaje ya viene escrito
      // para la persona, así que sube tal cual (429 en `apiPost`).
      if (streamError instanceof RateLimitError) throw streamError;
      if (e instanceof RateLimitError) throw e;
      lastError = streamError ?? e;
    }
  }

  console.error("askForJson agotó los intentos", lastError);
  throw new Error("No hemos podido crear el plan ahora mismo. Inténtalo otra vez en un momento.");
}

/**
 * Garantiza que la lista no supere el presupuesto. Primero pide al modelo que la
 * recorte con números concretos; si aun así se pasa, escala la compra de forma
 * proporcional como último recurso (`scaleShoppingToBudget`: cantidad y precio a
 * la vez) para que el total nunca exceda el tope. Es best-effort: si el recorte
 * por IA falla, no rompe la generación.
 */
async function enforceBudget(
  key: string,
  userId: string,
  system: string,
  shopping: ShoppingList,
  target: number,
  sym = "€",
  model = COACH_MODEL,
): Promise<ShoppingList> {
  if (!(target > 0) || shoppingTotal(shopping) <= target * 1.02) return shopping;

  let result = shopping;
  try {
    const ai = createAiProvider(key, userId);
    const { text } = await generateText({
      model: ai(model),
      system,
      temperature: 0.2,
      prompt:
        `Lista de la compra actual (JSON): ${JSON.stringify(shopping)}\n` +
        `Suma ${shoppingTotal(shopping)} ${sym} y el tope es ${target} ${sym}.\n` +
        `Recórtala hasta NO superar ${target} ${sym}: baja "weekQty" y "weekPrice" a la vez, elige alternativas más baratas y quita lo prescindible, manteniendo una compra equilibrada y platos cocinables. ` +
        "Conserva EXACTAMENTE la misma estructura (claves category/items/name/unit/weekQty/weekPrice/perishable; weekQty y weekPrice son arrays de 4, uno por semana). " +
        'Devuelve solo JSON: {"shopping": [...]}',
    });
    const parsed = (parseJsonLoose(text) ?? {}) as { shopping?: unknown };
    const cleaned = cleanShopping(parsed.shopping ?? parsed);
    if (cleaned.length) result = cleaned;
  } catch (e) {
    console.error("enforceBudget", e);
  }

  const total = shoppingTotal(result);
  if (total > target && total > 0) {
    result = scaleShoppingToBudget(result, target / total);
  }
  return result;
}

/**
 * Último recurso si el recorte por IA no bastó: escala la compra por un factor
 * < 1. En la lista canónica baja `weekQty` y `weekPrice` juntos (bajar solo el
 * precio dejaría cantidad y coste contradiciéndose); en una lista antigua solo
 * puede tocar el precio.
 */
const scaleShoppingToBudget = (shopping: ShoppingList, factor: number): ShoppingList =>
  shopping.map((g) => ({
    ...g,
    items: g.items.map((i) => {
      if (Array.isArray(i.weekQty)) {
        const weekQty = i.weekQty.map((n) => Math.round(n * factor * 100) / 100);
        const weekPrice = (i.weekPrice ?? []).map((n) => Math.round(n * factor * 100) / 100);
        return {
          ...i,
          weekQty,
          weekPrice,
          qty: formatShoppingQty(
            i.name,
            weekQty.reduce((s, n) => s + n, 0),
            i.unit ?? "ud",
          ),
          price_eur: Math.round(weekPrice.reduce((s, n) => s + n, 0) * 100) / 100,
        };
      }
      return { ...i, price_eur: Math.round(i.price_eur * factor * 100) / 100 };
    }),
  }));

/**
 * Núcleo de generación de un plan del mes y su lista de la compra: construye el
 * prompt con el perfil y el hogar, se lo pide a la IA, encaja el presupuesto y
 * aplica los "cinturones" de comidas compartidas / slots no elegidos. NO lee ni
 * escribe la base de datos ni consume cuota — de eso se encarga quien lo llama
 * (`generateMonthlyPlan` al crear el mes, `reflowMonthlyPlan` al regenerar por
 * un cambio de mesa). `coverage` lo fija el llamante para que un reflow a media
 * de mes conserve el rango de días original en vez de recortarlo a "de hoy en
 * adelante".
 */
async function generatePlanBody(opts: {
  key: string;
  userId: string;
  month: string;
  cadence: ShoppingCadence;
  coverage: PlanCoverage;
  home: HouseholdContext;
  profile: unknown;
  constraints: MonthConstraints | null;
  /** Objetivo medio de las comidas compartidas del hogar (`householdMealTargets`). */
  sharedTargets?: Awaited<
    ReturnType<(typeof import("@/lib/household.server"))["householdMealTargets"]>
  >;
}): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> {
  const { key, userId, month, cadence, coverage, home, profile, constraints } = opts;

  // Objetivo por comida y estructura de la comida (ticket 23): con la ración de
  // AESAN un solo plato no llena una comida. Informativo: las cantidades las
  // pone el código (ración personal, ticket 21).
  const { energyTargets } = await import("@/lib/nutrition/energy");
  const { planTargetsPrompt } = await import("@/lib/nutrition/plan-targets");
  const targetsLine = planTargetsPrompt({
    targets: energyTargets(profile as never),
    shared: opts.sharedTargets,
  });

  // Qué comidas quiere que se le planifiquen (issue merienda/slots elegidos):
  // único punto de lectura, compartido con `mealsForDate` en la pantalla, así
  // que el generador y lo que se pinta nunca pueden desincronizarse.
  const selectedSlots = effectiveMealSlots(
    (profile ?? {}) as { meal_slots?: unknown; meals_to_plan?: string | null },
  );
  const mealSlotsLine =
    selectedSlots.length < MEAL_SLOTS.length
      ? `COMIDAS A PLANIFICAR: solo ${selectedSlots.map((s) => MEAL_SLOT_LABEL[s].toLowerCase()).join(", ")}. No propongas nada para ${MEAL_SLOTS.filter(
          (s) => !selectedSlots.includes(s),
        )
          .map((s) => MEAL_SLOT_LABEL[s].toLowerCase())
          .join(
            ", ",
          )}: deja esos campos vacíos ("" en "lunch"/"dinner", sin platos de desayuno/merienda) y no incluyas sus ingredientes en la compra. `
      : "";

  const coveredDays = coverage.toDay - coverage.fromDay + 1;
  const ratio = coverageRatio(coverage, month);

  const rawBudget = Number(
    (profile as { budget_month_eur?: number | null } | null)?.budget_month_eur,
  );
  const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 0;
  // Presupuesto prorrateado a los días que cubre el plan: un plan que empieza a
  // media de mes solo puede gastar la parte proporcional del mes que le queda.
  const proratedBudget = budget > 0 ? Math.round(budget * ratio) : 0;
  // Moneda/país para las referencias de precio (la salida estructurada del
  // plan sigue en español canónico; solo cambian el símbolo y el país).
  const sym = currencySymbol((profile as { currency?: string | null } | null)?.currency);
  const country = (profile as { country?: string | null } | null)?.country || "ES";
  const marketRef = country === "ES" ? "supermercado en España" : `supermercado de ${country}`;
  const budgetLine =
    proratedBudget > 0
      ? `El coste total de la lista de la compra NO puede superar ${proratedBudget} ${sym} para el periodo que cubre el plan. Ajusta cantidades y elige alimentos económicos hasta encajar en ese presupuesto.`
      : `Ajusta la lista a un presupuesto contenido y realista de ${marketRef}.`;

  const coverageLine =
    coverage.fromDay > 1
      ? `IMPORTANTE: este plan empieza a media de mes. Cubre SOLO del día ${coverage.fromDay} al ${coverage.toDay} de este mes (${coveredDays} días). La lista de la compra y todas las comidas son únicamente para esos días; no planifiques ni compres para días anteriores al ${coverage.fromDay}.`
      : `El plan cubre el mes completo (días 1 al ${coverage.toDay}).`;

  const trips = tripsForCoverage(cadence, coverage);
  const tripRanges = Array.from({ length: trips }, (_, t) => {
    const { from, to } = tripDayRange(coverage, trips, t);
    return `días ${from}-${to}`;
  });
  const cadenceLine =
    trips === 1
      ? "COMPRA MENSUAL: la persona hará UNA sola compra para todo el periodo. Apóyate en despensa, congelados, conservas, legumbre seca, huevos, tubérculos y verdura resistente. Puedes incluir algún fresco, pero el que no aguante ~2 semanas se comprará aparte sobre la marcha (se le avisa en pantalla), así que no cargues la compra de pescado, verdura de hoja ni fruta blanda."
      : `COMPRA REPARTIDA en ${trips} compras (${tripRanges.join(" / ")}). No asignes compras a mano: con el "weekQty" por semana basta, el sistema calcula cuánto lleva cada compra. Reparte los frescos por las semanas en que se usan para que no se acumulen.`;

  const coveredWeeksNote =
    coverage.fromDay > 1
      ? `Pon 0 en "weekQty"/"weekPrice" de las semanas del mes anteriores al día ${coverage.fromDay} (este plan no las cubre). `
      : "";

  // No planificador (issue 05, D1): genera SOLO sus comidas en solitario —
  // las compartidas ya las cubre el plan del planificador, que se espeja
  // por lectura (`fetchMonthlyPlan`/`composeMonthlyPlanForMember`) y por
  // escritura (`syncSharedMeals`). No es el planificador ni un usuario en
  // solitario si `plannerId` existe y no es quien llama.
  const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== userId;
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  const myPortion = home.members.find((m) => m.userId === userId)?.portion ?? 1;

  // Raciones exactas del hogar (issue 04): sustituye la frase vaga de "cubre
  // las raciones extra" por la tabla real que ya calculó `householdContext`,
  // para que la IA dimensione `weekQty` sin adivinar cuánta gente come.
  const servingsLine = isNonPlannerInHousehold
    ? `SOLO TUS COMIDAS EN SOLITARIO: en tu casa, ${describeSharedSlots(home.sharedSlots)} ya las cubre el plan de ${plannerName} — NO las incluyas ni en "plan" ni en "shopping" (deja esos campos de "lunch"/"dinner" vacíos, "" ). Dimensiona lo que sí planifiques para ${myPortion} ración(es). `
    : home.householdId && HOUSEHOLD_MEAL_KEYS.some((m) => home.sharedSlots[m].length)
      ? `RACIONES: ${describeServings(home.servings, home.sharedSlots)} (mismo plato para toda la mesa esos días, sin los alérgenos de los niños). Las comidas en solitario (snack, y las que no compartes) piden ${home.servings.plannerSolo} ración(es). Dimensiona cada "weekQty" para esas raciones exactas, ni de más ni de menos. `
      : "";

  // Plato aparte de un niño (issue 07): solo lo genera el planificador (o un
  // usuario en solitario con niños en casa, caso raro pero posible).
  const tableKids = home.children.filter((c) => c.stage === "mesa");
  const puréeKids = home.children.filter((c) => c.stage === "triturados");
  const milkKids = home.children.filter((c) => c.stage === "pecho");
  const kidsLine =
    !isNonPlannerInHousehold && home.children.length
      ? [
          tableKids.length
            ? `NIÑOS QUE COMEN DEL PLATO: ${JSON.stringify(
                tableKids.map((c) => ({
                  childId: c.id,
                  nombre: c.name,
                  edad: c.age,
                  alergias: c.allergies || "ninguna",
                  racion: c.portion,
                })),
              )}. Si un plato compartido no le sirve a un niño (lleva su alérgeno, no encaja con su edad, o no se lo va a comer), añade para ESE niño ESE día un plato alternativo sencillo en "days[].kids" — objeto {"childId" (el de la lista), "slot": "desayuno"|"comida"|"cena", "dish": plato corto} — y suma sus ingredientes al "weekQty" a ración de ese niño. Si el plato compartido le vale, no pongas nada: por defecto el niño come lo mismo que la mesa.`
            : "",
          puréeKids.length
            ? `BEBÉS DE TRITURADOS (comen aparte, NO del plato de la mesa): ${JSON.stringify(
                puréeKids.map((c) => ({
                  childId: c.id,
                  nombre: c.name,
                  edad: c.age,
                  alergias: c.allergies || "ninguna",
                  racion: c.portion,
                })),
              )}. Para CADA uno, añade en "days[].kids" su propio plato en comida y cena de cada día: un puré o triturado sencillo, sin sal ni azúcar, adaptado a su edad y sin sus alérgenos. Suma sus ingredientes al "weekQty" a su ración (pequeña). El plato de la mesa NO se dimensiona para ellos.`
            : "",
          milkKids.length
            ? `BEBÉS DE PECHO O BIBERÓN: ${milkKids
                .map((c) => c.name)
                .join(
                  ", ",
                )}. No comen alimentos sólidos: no les pongas plato en "days[].kids" ni sumes nada a la compra por ellos.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  // Viaje/ausencia avisada antes de generar el plan (ver `setMonthConstraints`):
  // solo cambia las comidas personales de quien la avisó, nunca las
  // compartidas del hogar.
  const awayLine = constraints
    ? awayPlanLine({
        month,
        coverage,
        awayStart: constraints.awayStart,
        awayEnd: constraints.awayEnd,
        notes: constraints.notes,
        sharedSlots: home.sharedSlots,
        mealSlots: selectedSlots,
      })
    : "";

  const { plan: rawPlan, shopping: rawShopping } = await askForJson(
    {
      key,
      userId,
      model: PLAN_MODEL,
      system: coachSystemPrompt(profile as never, home.text),
      prompt:
        `Crea el plan del mes ${month} y su lista de la compra. Devuelve solo JSON válido:\n` +
        '{"shopping": [objetos {"category": "Verdura y fruta"|"Proteína"|"Despensa"|"Lácteos"|"Otros", ' +
        '"items": [{"name": string (ingrediente), "unit": "g"|"ml"|"ud" (g para sólidos, ml para líquidos, ud para piezas/manojos/latas), ' +
        '"weekQty": [4 números] (cantidad en "unit" que piden los platos de CADA semana del mes para las raciones del hogar; 0 si esa semana no se usa), ' +
        `"weekPrice": [4 números] (${sym} orientativo de ${marketRef} para la cantidad de cada semana), ` +
        '"perishable": boolean (true si es fresco y aguanta pocos días)}]}], ' +
        '"plan": {"intro": string (2 frases motivadoras y comprensivas), "focus": [3 focos del mes, cortos], ' +
        '"weeks": [4 objetos {"label": "Semana 1".."Semana 4", "focus": string corto, "breakfasts": [2 ideas de desayuno], "snacks": [2 ideas de snack], ' +
        '"days": [7 objetos {"day": "Lunes".."Domingo", "lunch": plato, "dinner": plato, "kids": [opcional, solo si un niño necesita otro plato: {"childId", "slot": "desayuno"|"comida"|"cena", "dish"}]}]}]}}\n' +
        "REGLA CLAVE: todos los platos, desayunos y snacks del plan deben poder prepararse ÚNICAMENTE con los ingredientes de la lista de la compra (más sal, aceite, agua y especias básicas). No menciones ningún alimento que no esté en la lista. " +
        'CANTIDADES: cada número de "weekQty" es lo que de verdad piden los platos de esa semana, ni de más ni de menos. Si un plato se repite en varias semanas, refleja su parte en el "weekQty" de cada una. ' +
        `${coverageLine} ${coveredWeeksNote}` +
        `${budgetLine} ` +
        `${cadenceLine} ` +
        "FRESCURA: marca perishable=true en frescos (verdura de hoja, pescado, carne fresca, fruta blanda, lácteos frescos) y false en despensa, congelados y conservas. " +
        'Ten en cuenta cuándo cocina y come en casa y cuándo come fuera: incluso en las comidas fuera de casa da SIEMPRE un plato concreto y realista, tipo fiambrera o menú de oficina (ensalada de atún, pechuga con arroz, sándwich de pavo...), nunca "come fuera", un menú del día o un restaurante genéricos — la única excepción es un cheat day puntual (por ejemplo, tras hacer mucho deporte o comer poco ese día), donde sí vale dejarlo abierto. No cuentes los ingredientes de esas comidas fuera de casa en la lista de la compra. ' +
        `${mealSlotsLine}` +
        `${servingsLine}` +
        `${kidsLine}` +
        `${awayLine ? `${awayLine} ` : ""}` +
        `${targetsLine} ` +
        'Los componentes de cada comida (pan, fruta, lácteo del postre) también van en la compra, en su "weekQty". ' +
        "Platos sencillos, repetibles y realistas (puedes repetir platos entre semanas). Frases cortas para que el JSON quepa completo. Sin gramajes rígidos en los platos. Sin markdown ni explicaciones.",
    },
    (parsed) => {
      const p = (parsed ?? {}) as { plan?: unknown; shopping?: unknown };
      const plan = completePlan(cleanPlan(p.plan));
      const shopping = cleanShopping(p.shopping);
      if (!plan || !shopping.length) return null;
      return { plan, shopping };
    },
  );

  // Deja la lista dentro del presupuesto prorrateado y fija la cadencia/cobertura
  // del plan como fuente de verdad para las etiquetas de días y compras.
  const shopping = await enforceBudget(
    key,
    userId,
    coachSystemPrompt(profile as never, home.text),
    rawShopping,
    proratedBudget,
    sym,
    PLAN_MODEL,
  );
  // Cinturón para el modo "solo mis comidas": si la IA rellenó igualmente
  // una comida compartida, se vacía aquí — la fila de un no planificador
  // nunca guarda el plato de una comida de la casa (lo pone el espejo).
  const sharedBlanked = isNonPlannerInHousehold
    ? blankSharedSlots(rawPlan, home.sharedSlots)
    : rawPlan;
  // Cinturón para las comidas que esta persona no quiere planificar en
  // absoluto (independiente de si comparte mesa o no): `mealSlotsLine` ya
  // se lo pidió a la IA, esto lo garantiza aunque no haya obedecido.
  const planBody = blankUnselectedSlots(sharedBlanked, selectedSlots);
  const plan: MonthlyPlan = {
    ...planBody,
    coverage,
    cadence,
    targetsVersion: PLAN_TARGETS_VERSION,
  };
  return { plan, shopping };
}

/** Solo para `bun run eval:plan-lite` (ticket 23): el mismo generador que producción. */
export const _generatePlanBodyForEval = generatePlanBody;

export const generateMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; cadence?: ShoppingCadence; today?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    // No se planifica el pasado (no se puede cumplir y gasta tokens) ni más allá
    // del mes que viene, y este último solo en su última semana — mismo umbral
    // con el que la pantalla Plan lo desbloquea (ver `isNextMonthUnlocked`).
    // `today` lo manda el cliente en su zona horaria; el fallback es Madrid.
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    const currentMonth = today.slice(0, 7);
    if (input.month < currentMonth) throw new ValidationError("No se planifican meses pasados");
    const nm = nextMonthISO(today);
    if (input.month > nm) throw new ValidationError("Solo puedes preparar hasta el mes que viene");
    if (input.month === nm && !isNextMonthUnlocked(today)) {
      throw new ValidationError(
        "Aún no toca preparar el mes que viene; podrás la última semana del mes",
      );
    }
    const cadence: ShoppingCadence =
      input?.cadence === "semanal" || input?.cadence === "bisemanal" ? input.cadence : "mensual";
    return { month: input.month, cadence, today };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList; firstPlan: boolean }> => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      // Un mes se genera UNA vez: rehacerlo a mano no es un camino (gasta IA y
      // pierde los cambios de la persona). Lo que sí cambia el plan después —el
      // hogar, la despensa— lo recoloca `reflowMonthlyPlan` sin pasar por aquí, y
      // lo que la persona tenga que contar del mes se pregunta ANTES de generar
      // (`MonthIntakeChat`). Va antes de la cuota: un rechazo no la gasta.
      const { data: existing } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        data.month,
        "id",
      );
      if (existing) {
        const title = monthTitle(data.month);
        throw new ValidationError(
          `${title.charAt(0).toUpperCase()}${title.slice(1)} ya tiene su plan. Si cambia tu hogar se recalcula solo.`,
        );
      }

      // ¿Es el primer plan de la persona? Entonces el cliente pide además la
      // bienvenida del coach (`welcomeBriefing`). Se mira aquí y no por
      // `app_started_on`: quien se da de alta el día 28 puede preparar primero
      // el mes que viene, y un perfil demo trae ese campo en el pasado.
      const { count: earlierPlans } = await context.supabase
        .from("monthly_plans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId);

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "plan-generate");

      const [{ data: profile }, constraints] = await Promise.all([
        context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
        fetchMonthConstraints(context.supabase as never, context.userId, data.month),
      ]);

      const { householdContext, householdMealTargets, syncSharedMeals } =
        await import("@/lib/household.server");
      const [home, sharedTargets] = await Promise.all([
        householdContext(context.supabase as never, context.userId),
        householdMealTargets(context.supabase as never, context.userId),
      ]);

      const { plan, shopping } = await generatePlanBody({
        sharedTargets,
        key,
        userId: context.userId,
        month: data.month,
        cadence: data.cadence,
        coverage: monthCoverage(data.month, data.today),
        home,
        profile,
        constraints,
      });

      const { error } = await context.supabase.from("monthly_plans").upsert(
        {
          user_id: context.userId,
          month: data.month,
          plan: plan as never,
          shopping: shopping as never,
          confirmed_at: null,
        } as never,
        { onConflict: "user_id,month" },
      );
      if (error) {
        console.error("saveMonthlyPlan", error);
        throw new Error("No hemos podido guardar el plan del mes. Inténtalo otra vez.");
      }

      await syncSharedMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        month: data.month,
        today: data.today,
      });

      return { plan, shopping, firstPlan: !earlierPlans };
    },
  );

/**
 * La petición de cambios de la ronda de `planFit` (ticket 10): cada plato que no
 * encaja, con el objetivo de su comida y el motivo en cifras. Misma forma de
 * respuesta que `reflowMeals` (`{"cambios": [...]}` + `cleanReflowChanges`), y
 * solo con los ingredientes de la compra: la lista no cambia al recolocar.
 */
function askPlanFit(opts: {
  key: string;
  userId: string;
  profile: unknown;
  homeText: string;
  shopping: ShoppingList;
  pantry: string[];
}) {
  return async (
    misfits: Misfit[],
    rotations: RotationMisfit[],
  ): Promise<{ changes: PlanChange[]; ideas: WeeklyIdea[] }> => {
    const { cleanWeeklyIdeas, misfitReasonText } = await import("@/lib/nutrition/plan-fit");
    const allowedDates = [...new Set(misfits.map((m) => m.date))];
    const allowedIdeas = new Set(rotations.map((r) => `${r.week}|${r.slot}|${r.option}`));
    const goal = (m: Misfit) =>
      `~${Math.round(m.kcalGoal / 10) * 10} kcal y ${m.proteinGoal} g de proteína`;
    const dishes = misfits.map((m) => ({
      fecha: m.date,
      comida: m.slot,
      plato: m.dish,
      objetivo: goal(m),
      motivo: misfitReasonText(m),
    }));
    const weekly = rotations.map((r) => ({
      semana: r.week + 1,
      comida: r.slot === "snack" ? "merienda" : "desayuno",
      opcion: r.option + 1,
      plato: r.misfit.dish,
      objetivo: goal(r.misfit),
      motivo: misfitReasonText(r.misfit),
    }));
    return askForJson(
      {
        key: opts.key,
        userId: opts.userId,
        model: PLAN_MODEL,
        system: coachSystemPrompt(opts.profile as never, opts.homeText),
        prompt:
          "El sistema ajusta la cantidad de cada plato al objetivo de su comida, pero solo hasta " +
          "un límite para que siga siendo el mismo plato. Estos platos del plan no llegan a su " +
          "objetivo ni ajustando la cantidad.\n" +
          (dishes.length ? `Platos de comida y cena:\n${JSON.stringify(dishes)}\n` : "") +
          (weekly.length
            ? `Ideas de desayuno y merienda de la semana (cada una se repite varios días):\n${JSON.stringify(weekly)}\n`
            : "") +
          "\nPropón para CADA uno otro que sí pueda llegar: si se queda corto, con más energía " +
          "(legumbre, arroz, pasta, patata o pan, y un postre lácteo o fruta); si se pasa, más " +
          "ligero; si le falta proteína, con una fuente clara (carne, pescado, huevo, legumbre, " +
          "yogur griego o skyr, queso fresco). Un desayuno o una merienda nunca es solo fruta o " +
          `verdura. ${PLAN_STRUCTURE_REMINDER} ` +
          `Usa SOLO estos ingredientes (más sal, aceite, agua y especias): ${ingredientNames(opts.shopping)}` +
          (opts.pantry.length ? `, ${opts.pantry.join(", ")}` : "") +
          ". No repitas el mismo plato en días seguidos. Platos concretos y realistas.\n" +
          'Devuelve solo JSON válido: {"cambios": [{"fecha": "AAAA-MM-DD", "comida": string, "cena": string}], ' +
          '"ideas": [{"semana": número, "comida": "desayuno"|"merienda", "opcion": número, "plato": string}]}, ' +
          'con "comida" o "cena" solo en la que se pide cambiar y la misma "semana" y "opcion" de cada idea. ' +
          "Listas vacías si no hay nada que cambiar. Sin markdown.",
      },
      (parsed) => {
        const o = (parsed ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.cambios) && !Array.isArray(o.ideas)) return null;
        const changes =
          cleanReflowChanges({ cambios: Array.isArray(o.cambios) ? o.cambios : [] }, allowedDates)
            ?.changes ?? [];
        return { changes, ideas: cleanWeeklyIdeas(o, allowedIdeas) };
      },
    );
  };
}

/** Solo para `bun run eval:plan-lite`: la misma ronda que producción, sin base de datos. */
export async function _fitPlanForEval(opts: {
  key: string;
  plan: MonthlyPlan;
  shopping: ShoppingList;
  month: string;
  profile: unknown;
}) {
  const { fitPlanMeals } = await import("@/lib/nutrition/plan-fit.server");
  return fitPlanMeals({
    plan: opts.plan,
    month: opts.month,
    after: `${opts.month}-00`,
    profile: opts.profile,
    shared: () => ({}),
    canTouchShared: true,
    apiKey: opts.key,
    userId: null,
    ask: askPlanFit({
      key: opts.key,
      userId: "",
      profile: opts.profile,
      homeText: "",
      shopping: opts.shopping,
      pantry: [],
    }),
  });
}

/**
 * Comprueba el plan del mes contra el objetivo y corrige lo que no encaja, en
 * UNA ronda (ticket 10 de `precision-nutricional`, `fitPlanMeals`). La lanza el
 * cliente cuando termina el precalentado de recetas (`recipe-warm.ts`): con
 * todas en la caché, medir el mes solo lee. Generar ya tarda ~100 s y las
 * recetas del mes no caben además en la misma función.
 *
 * - Como mucho una vez por plan: la marca `plan.fit` se guarda aunque no cambie
 *   nada, y un plan regenerado nace sin ella. Solo planes con `targetsVersion`.
 * - Solo días posteriores a hoy; nunca un plato puesto a mano (`pinned`).
 * - Comidas propias primero (D4); una compartida solo la cambia quien planifica.
 * - La compra no cambia: los platos nuevos usan sus ingredientes.
 *
 * Devuelve lo que cambió para enseñarlo: un cambio automático del plan tiene
 * que verse. Ruta espejo: `POST /api/v1/plan/fit`.
 */
export const fitMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; today?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    return { month: input.month, today };
  })
  .handler(async ({ data, context }): Promise<{ fit: PlanFitMark | null }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");
    const supabase = context.supabase as never as SupabaseClient<never, never, never>;

    const { data: row } = await ownPlanRow(
      supabase,
      context.userId,
      data.month,
      "plan, shopping, pantry_extras",
    );
    const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!current) return { fit: null };
    if (current.fit) return { fit: current.fit };
    // Un mes pasado es un hecho, no un plan. Un plan anterior al objetivo por
    // comida (ticket 23) tampoco se corrige: Hoy ya explica que el que viene
    // cuadrará, y cambiarle media rejilla a mitad de mes no ayuda.
    if (data.month < data.today.slice(0, 7) || !current.targetsVersion) return { fit: null };

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-fit");

    const [{ data: profile }, household, { fitPlanMeals }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      import("@/lib/household.server"),
      import("@/lib/nutrition/plan-fit.server"),
    ]);
    const [home, shared] = await Promise.all([
      household.householdContext(supabase as never, context.userId),
      household.sharedMealPortionsByDate(supabase as never, context.userId),
    ]);
    const canTouchShared = !home.plannerId || home.plannerId === context.userId;

    const { report } = await fitPlanMeals({
      plan: current,
      month: data.month,
      after: data.today,
      profile,
      shared,
      canTouchShared,
      apiKey: key,
      userId: context.userId,
      ask: askPlanFit({
        key,
        userId: context.userId,
        profile,
        homeText: home.text,
        shopping: cleanShopping((row as { shopping?: unknown } | null)?.shopping),
        pantry: cleanPantryExtras((row as { pantry_extras?: unknown } | null)?.pantry_extras).map(
          (e) => e.name,
        ),
      }),
    });
    const pct = (n: number) => `${Math.round(n * 100)} %`;
    console.info(
      `fitMonthlyPlan ${data.month}: ${pct(report.before)} → ${pct(report.after)} de ` +
        `${report.measuredDays} días; ${report.misfits} a cambiar, ${report.changed.length} ` +
        `cambiados, ${report.discarded} descartados${report.skipped ? ` (${report.skipped})` : ""}` +
        (report.seconds ? ` · ${JSON.stringify(report.seconds)} s` : ""),
    );

    // Se relee antes de escribir: la ronda tarda y la persona puede haber
    // cambiado un plato mientras. Solo entra un cambio cuya celda sigue igual.
    const { data: fresh } = await ownPlanRow(supabase, context.userId, data.month, "plan");
    const latest = cleanPlan((fresh as { plan?: unknown } | null)?.plan);
    if (!latest || latest.fit) return { fit: latest?.fit ?? null };
    const { plan: applied, applied: stillThere } = applyPlanFitChanges(
      latest,
      report.changed,
      data.today,
    );
    const fit: PlanFitMark = {
      at: new Date().toISOString(),
      before: report.before,
      after: report.after,
      changed: stillThere,
    };
    const next: MonthlyPlan = { ...applied, fit };
    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ plan: next as never } as never)
      .eq("user_id", context.userId)
      .eq("month", data.month);
    if (error) {
      console.error("fitMonthlyPlan: guardar", error);
      throw new Error("No hemos podido guardar el plan ajustado. Inténtalo otra vez.");
    }
    if (stillThere.length && canTouchShared) {
      await household.syncSharedMeals({
        supabase: supabase as never,
        userId: context.userId,
        month: data.month,
        today: data.today,
      });
    }
    return { fit };
  });

/**
 * Cambia la cadencia de compra (semanal/bisemanal/mensual). No regenera el plan
 * ni llama a la IA: la lista canónica ya guarda el desglose por semana, así que
 * cambiar de cadencia solo cambia cómo se agrupa en pantalla (`projectTrips`).
 * Una lista antigua (sin desglose) se reparte con `repartitionTrips` como antes,
 * y `carryOwnedByName` conserva las marcas "en casa"/"comprado".
 */
export const recadenceMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; cadence?: ShoppingCadence }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const cadence: ShoppingCadence =
      input?.cadence === "semanal" || input?.cadence === "bisemanal" ? input.cadence : "mensual";
    return { month: input.month, cadence };
  })
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> => {
    const { data: row } = await ownPlanRow(
      context.supabase as never,
      context.userId,
      data.month,
      "plan, shopping",
    );
    const typed = row as { plan?: unknown; shopping?: unknown } | null;

    const current = cleanPlan(typed?.plan);
    if (!current) throw new ValidationError("Todavía no hay plan de este mes");
    const prevShopping = cleanShopping(typed?.shopping);
    // Una lista antigua se reparte entre EXACTAMENTE las compras que la
    // pantalla va a enseñar para esta cobertura: repartir entre más las dejaría
    // fuera de la vista (ver `repartitionTrips`).
    const tripCount = tripsForCoverage(
      data.cadence,
      current.coverage ?? monthCoverage(data.month, zonedTodayISO()),
    );
    const shopping = isCanonicalShopping(prevShopping)
      ? prevShopping
      : carryOwnedByName(prevShopping, repartitionTrips(prevShopping, data.cadence, tripCount));
    const plan: MonthlyPlan = { ...current, cadence: data.cadence };

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ plan: plan as never, shopping: shopping as never } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) {
      console.error("recadenceMonthlyPlan", error);
      throw new Error("No hemos podido cambiar la frecuencia de la compra");
    }

    return { plan, shopping };
  });

/**
 * Marca un ingrediente como comprado ("fridge": ya lo tenía en casa, "store":
 * lo ha comprado en el súper) o lo deja sin decidir (source null) — no cambia
 * la lista en sí (cantidades y precio siguen igual), solo anota de dónde ha
 * salido cada uno. La marca es por ingrediente Y compra: un mismo fresco puede
 * hacer falta en varias compras y marcar una no marca las demás. En la lista
 * canónica eso vive en `ownedTrips[trip]`; en una lista antigua, en el `owned`
 * de la fila de ese `trip`.
 */
export const toggleShoppingOwned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      month: string;
      itemName: string;
      trip: number;
      source: "fridge" | "store" | null;
    }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const itemName = String(input?.itemName ?? "").trim();
      if (!itemName) throw new ValidationError("Falta el ingrediente");
      const trip = Number(input?.trip);
      if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
      const source = input?.source === "fridge" || input?.source === "store" ? input.source : null;
      return { month: input.month, itemName, trip: Math.round(trip), source };
    },
  )
  .handler(async ({ data, context }): Promise<{ shopping: ShoppingList }> => {
    // La lista puede ser la de la casa: cualquier miembro con cuenta marca su
    // estado, aunque la escritura vaya a la fila del planificador (issue 06).
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const row = await readShoppingRow<{ shopping?: unknown }>(
      context.supabase,
      target,
      data.month,
      "shopping",
    );
    const current = cleanShopping(row?.shopping);
    if (!current.length) throw new ValidationError("Todavía no hay lista de la compra este mes");

    const shopping = withOwnedMark(current, data.itemName, data.trip, data.source);

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      shopping: shopping as never,
    });
    if (error) {
      console.error("toggleShoppingOwned", error);
      throw new Error("No hemos podido guardar el cambio");
    }

    return { shopping };
  });

/**
 * Guarda lo que se ha gastado de verdad en un viaje de compra concreto. Los
 * precios de `shopping` son la estimación de la IA hecha al generar el plan;
 * esto es aparte y no los toca, para poder comparar estimado contra real.
 */
export const setTripActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; amount: number | null }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    const amount = input?.amount == null ? null : Number(input.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      throw new ValidationError("Importe no válido");
    }
    return { month: input.month, trip: Math.round(trip), amount };
  })
  .handler(async ({ data, context }): Promise<{ trip_actuals: TripActuals }> => {
    // El gasto real de la compra de la casa lo puede anotar cualquier miembro
    // (issue 06): resuelve la fila objetivo y escribe solo esa columna.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const row = await readShoppingRow<{ trip_actuals?: unknown }>(
      context.supabase,
      target,
      data.month,
      "trip_actuals",
    );
    const current = cleanTripActuals(row?.trip_actuals);
    const next = { ...current };
    if (data.amount == null) delete next[data.trip];
    else next[data.trip] = data.amount;

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      trip_actuals: next as never,
    });
    if (error) {
      console.error("setTripActual", error);
      throw new Error("No hemos podido guardar el gasto");
    }

    return { trip_actuals: next };
  });

/**
 * Añade o quita un ingrediente de la "despensa extra" del mes: cosas que la
 * persona ya tiene en casa y NO salen de la lista de la compra (añadidas a mano
 * o detectadas al escanear un tiquet). El planificador las trata como
 * disponibles al recolocar los días futuros; la lista de la compra (`shopping`)
 * no se toca nunca por esto. El emparejamiento al quitar es por nombre
 * normalizado (`normName`), no por igualdad exacta.
 */
export const setPantryExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; name: string; qty?: string; remove?: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const name = String(input?.name ?? "")
      .trim()
      .slice(0, 80);
    if (!name) throw new ValidationError("Falta el ingrediente");
    assertCleanFood(name);
    const qty = String(input?.qty ?? "")
      .trim()
      .slice(0, 40);
    return { month: input.month, name, qty, remove: Boolean(input?.remove) };
  })
  .handler(async ({ data, context }): Promise<{ pantry_extras: PantryExtra[] }> => {
    // La despensa "ya lo tenemos en casa" es del hogar (issue 06): cualquier
    // miembro la edita, aunque viva en la fila del planificador.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const row = await readShoppingRow<{ pantry_extras?: unknown }>(
      context.supabase,
      target,
      data.month,
      "pantry_extras",
    );
    const current = cleanPantryExtras(row?.pantry_extras);
    const key = normName(data.name);
    const withoutIt = current.filter((e) => normName(e.name) !== key);
    const next: PantryExtra[] = data.remove
      ? withoutIt
      : [
          ...withoutIt,
          {
            name: data.name,
            ...(data.qty ? { qty: data.qty } : {}),
            source: "manual" as const,
            addedAt: new Date().toISOString(),
          },
        ].slice(0, 40);

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      pantry_extras: next as never,
    });
    if (error) {
      console.error("setPantryExtra", error);
      throw new Error("No hemos podido guardar el ingrediente");
    }

    return { pantry_extras: next };
  });

export type ReceiptScan = {
  trip_actuals: TripActuals;
  pantry_extras: PantryExtra[];
  trip_receipts: TripReceipts;
  total: number;
  itemCount: number;
  added: string[];
  discarded: { name: string; reason: string }[];
};

/**
 * Lee la foto de un tiquet de compra con el modelo de visión y hace dos cosas
 * sin tocar nunca la lista de la compra (`shopping`):
 *  1. Guarda el importe real de la compra en `trip_actuals[trip]` (misma columna
 *     que el gasto a mano) y un resumen en `trip_receipts[trip]`.
 *  2. De los productos del tiquet que NO estén ya cubiertos por la compra ni por
 *     la despensa extra, añade a `pantry_extras` los que encajan en los
 *     objetivos y la dieta de la persona (`source: "receipt"`) y descarta el
 *     resto devolviendo el motivo, para enseñarlo en pantalla.
 * La imagen no se guarda: se manda al modelo y se descarta.
 */
export const scanTripReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; imageBase64: string; mime?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    const imageBase64 = String(input?.imageBase64 ?? "").trim();
    if (!imageBase64) throw new ValidationError("Falta la foto del tiquet");
    if (imageBase64.length > 4_500_000) {
      throw new ValidationError(
        "La foto es demasiado grande: baja la calidad e inténtalo otra vez",
      );
    }
    const mime = /^image\/(jpeg|png|webp|heic)$/.test(input?.mime ?? "")
      ? input!.mime!
      : "image/jpeg";
    return { month: input.month, trip: Math.round(trip), imageBase64, mime };
  })
  .handler(async ({ data, context }): Promise<ReceiptScan> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "receipt");

    // La foto del tiquet la sube quien va al súper — puede no ser el
    // planificador (issue 06). El perfil para clasificar los productos es
    // siempre el de quien llama; la fila de compra, la que resuelva el hogar.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const [{ data: profile }, row] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      readShoppingRow<{
        shopping?: unknown;
        pantry_extras?: unknown;
        trip_actuals?: unknown;
        trip_receipts?: unknown;
      }>(
        context.supabase,
        target,
        data.month,
        "shopping, pantry_extras, trip_actuals, trip_receipts",
      ),
    ]);
    const typed = row;
    const shopping = cleanShopping(typed?.shopping);
    const pantryExtras = cleanPantryExtras(typed?.pantry_extras);
    const tripActuals = cleanTripActuals(typed?.trip_actuals);
    const tripReceipts = cleanTripReceipts(typed?.trip_receipts);

    const ai = createAiProvider(key, context.userId);
    const dataUrl = `data:${data.mime};base64,${data.imageBase64}`;

    // 1) Leer el tiquet (visión).
    const receipt = await (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { text } = await generateText({
            model: ai(COACH_MODEL),
            temperature: 0,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      `Esta es la foto de un tiquet de compra de supermercado${
                        (profile as { country?: string | null } | null)?.country &&
                        (profile as { country?: string | null }).country !== "ES"
                          ? ` de ${(profile as { country?: string | null }).country}`
                          : " en España"
                      }. ` +
                      "Extrae el importe total pagado y la lista de productos con su precio. " +
                      "Ignora descuentos, puntos, IVA desglosado y medios de pago. " +
                      'Devuelve SOLO JSON: {"total_eur": number, "store": string, "items": [{"name": string (producto, en minúsculas y sin marca si se puede), "price_eur": number}]}. ' +
                      "Sin markdown ni texto alrededor.",
                  },
                  { type: "image", image: dataUrl },
                ],
              },
            ],
          });
          const parsed = (parseJsonLoose(text) ?? {}) as {
            total_eur?: unknown;
            store?: unknown;
            items?: unknown;
          };
          const total = Number(parsed.total_eur);
          const items = (Array.isArray(parsed.items) ? parsed.items : [])
            .map((it) => {
              const o = (it ?? {}) as Record<string, unknown>;
              const name = String(o.name ?? "")
                .trim()
                .toLowerCase()
                .slice(0, 80);
              const price = Number(o.price_eur);
              return name
                ? { name, price_eur: Number.isFinite(price) && price >= 0 ? price : 0 }
                : null;
            })
            .filter((x): x is { name: string; price_eur: number } => Boolean(x))
            .slice(0, 80);
          if (Number.isFinite(total) && total >= 0) {
            return {
              total: Math.round(total * 100) / 100,
              store: String(parsed.store ?? ""),
              items,
            };
          }
        } catch (e) {
          // Tope de gasto: otro intento no lo cambia, y "foto más nítida" confundiría.
          if (e instanceof RateLimitError) throw e;
          console.error("scanTripReceipt vision", e);
        }
      }
      throw new Error("No hemos podido leer el tiquet. Prueba con una foto más nítida.");
    })();

    // 2) Quitar lo que ya está cubierto (mismo nombre exacto) y clasificar el
    // resto: el modelo decide, viendo la lista de la compra, si un producto ya
    // lo tiene por un equivalente ("tomate pera" lo cubre "tomate triturado"),
    // si encaja con sus objetivos, o si se descarta.
    const availableNames = new Set([
      ...shopping.flatMap((g) => g.items.map((i) => normName(i.name))),
      ...pantryExtras.map((e) => normName(e.name)),
    ]);
    const candidateItems = receipt.items.filter((i) => !availableNames.has(normName(i.name)));
    const boughtList = ingredientNames(shopping);

    let added: string[] = [];
    const discarded: { name: string; reason: string }[] = [];

    if (candidateItems.length) {
      try {
        const { text } = await generateText({
          model: ai(COACH_MODEL),
          system: coachSystemPrompt(profile as never),
          temperature: 0.2,
          prompt:
            `Ingredientes que ya tiene comprados este mes: ${boughtList || "ninguno"}\n\n` +
            `Productos del tiquet a clasificar: ${JSON.stringify(candidateItems.map((i) => i.name))}\n\n` +
            "Para cada producto elige una opción:\n" +
            '- "cubierto": ya lo tiene por un equivalente de la lista de arriba (p. ej. "tomate pera" lo cubre "tomate triturado", "aceite oliva 1l" lo cubre "aceite de oliva virgen extra").\n' +
            '- "encaja": es nuevo y sirve para sus platos (base mediterránea; respeta sus restricciones, alergias, patrón de alimentación y objetivo).\n' +
            '- "descartar": es un ultraprocesado, un capricho o choca con sus restricciones o su objetivo.\n' +
            'Devuelve SOLO JSON: {"decisiones": [{"name": string (igual que te lo doy), "estado": "cubierto"|"encaja"|"descartar", "motivo": string (máx. 8 palabras, solo si "descartar")}]}. Sin markdown.',
        });
        const parsed = (parseJsonLoose(text) ?? {}) as { decisiones?: unknown };
        const decisions = new Map<string, { estado: string; motivo: string }>();
        for (const d of Array.isArray(parsed.decisiones) ? parsed.decisiones : []) {
          const o = (d ?? {}) as Record<string, unknown>;
          const name = String(o.name ?? "")
            .trim()
            .toLowerCase();
          if (name) {
            decisions.set(normName(name), {
              estado: String(o.estado ?? "encaja"),
              motivo: String(o.motivo ?? "").trim(),
            });
          }
        }
        for (const item of candidateItems) {
          const d = decisions.get(normName(item.name));
          if (d?.estado === "cubierto") continue;
          if (d?.estado === "descartar") {
            discarded.push({ name: item.name, reason: d.motivo || "no encaja con tu objetivo" });
          } else {
            added.push(item.name);
          }
        }
      } catch (e) {
        // Si la clasificación falla, no inventamos: se descartan todos con un
        // motivo genérico en vez de meter cosas raras en la despensa.
        console.error("scanTripReceipt classify", e);
        for (const item of candidateItems) {
          discarded.push({ name: item.name, reason: "no se pudo comprobar" });
        }
        added = [];
      }
    }

    // 3) Persistir: importe real + resumen del tiquet + extras que encajan.
    const nextActuals: TripActuals = { ...tripActuals, [data.trip]: receipt.total };
    const nextReceipts: TripReceipts = {
      ...tripReceipts,
      [data.trip]: {
        total: receipt.total,
        itemCount: receipt.items.length,
        scannedAt: new Date().toISOString(),
      },
    };
    const nowIso = new Date().toISOString();
    const nextPantry = cleanPantryExtras([
      ...pantryExtras,
      ...added.map((name) => ({ name, source: "receipt" as const, addedAt: nowIso })),
    ]);

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      trip_actuals: nextActuals as never,
      trip_receipts: nextReceipts as never,
      pantry_extras: nextPantry as never,
    });
    if (error) {
      console.error("scanTripReceipt save", error);
      throw new Error("Hemos leído el tiquet pero no hemos podido guardarlo. Inténtalo otra vez.");
    }

    return {
      trip_actuals: nextActuals,
      pantry_extras: nextPantry,
      trip_receipts: nextReceipts,
      total: receipt.total,
      itemCount: receipt.items.length,
      added,
      discarded,
    };
  });

/**
 * "Fija" (o deshace) los ingredientes de un tramo de compra: la persona
 * confirma que ese tramo ya está resuelto (comprado o en casa) y deja de
 * pedir más marcas. Cuando quedan fijados TODOS los tramos del mes, también
 * marca `confirmed_at` del plan — es la señal que ya usa `syncSharedMeals`
 * para no tocar la compra de alguien cuyo mes ya está cerrado del todo; si se
 * deshace cualquier tramo, `confirmed_at` se limpia otra vez.
 */
export const setTripConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; confirmed: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    return { month: input.month, trip: Math.round(trip), confirmed: Boolean(input?.confirmed) };
  })
  .handler(async ({ data, context }): Promise<{ confirmed_trips: TripConfirmations }> => {
    // Fijar un tramo de la compra de la casa lo puede hacer cualquier miembro
    // (issue 06); `confirmed_at` se cierra en la fila del planificador cuando
    // todos los tramos quedan fijados — `syncSharedMeals` lo respeta.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const typed = await readShoppingRow<{
      plan?: unknown;
      shopping?: unknown;
      confirmed_trips?: unknown;
    }>(context.supabase, target, data.month, "plan, shopping, confirmed_trips");
    const shopping = cleanShopping(typed?.shopping);
    if (!shopping.length) throw new ValidationError("Todavía no hay lista de la compra este mes");

    const current = cleanTripConfirmations(typed?.confirmed_trips);
    const next = { ...current };
    if (data.confirmed) next[data.trip] = zonedTodayISO();
    else delete next[data.trip];

    // El número "oficial" de tramos es el de la cadencia guardada, no el que se
    // deduzca de los datos (un tramo sin artículos asignados no debe contar de
    // menos y dar por fijado el mes entero antes de tiempo).
    const planRow = cleanPlan(typed?.plan);
    const cadence = planRow?.cadence ?? cadenceOf(shopping);
    // El nº de compras sale de la cobertura real del plan, igual que en pantalla
    // (`tripsForCoverage`): con una cadencia semanal sobre los últimos 12 días
    // del mes hay 2 compras, no 4, y esperar a 4 dejaría el mes sin poder
    // fijarse nunca.
    const allConfirmed =
      Object.keys(next).length >=
      tripsForCoverage(cadence, planRow?.coverage ?? monthCoverage(data.month, zonedTodayISO()));

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      confirmed_trips: next as never,
      confirmed_at: allConfirmed ? new Date().toISOString() : null,
    });
    if (error) {
      console.error("setTripConfirmed", error);
      throw new Error("No hemos podido fijar los ingredientes");
    }

    return { confirmed_trips: next };
  });

/**
 * Recoloca los días FUTUROS del plan del mes con la IA, sin tocar hoy, el pasado
 * ni la lista de la compra. Es el núcleo compartido por `adjustMonthlyPlan` (la
 * persona cuenta algo — "comí de más", "hice deporte") y por el modo "meals" de
 * `reflowMonthlyPlan` (cambió la despensa). No consume cuota: el bucket lo
 * decide quien llama (`plan-adjust` vs `plan-reflow`).
 */
/**
 * A partir de este desvío (en kcal, en valor absoluto) recolocar deja de ser
 * opcional para la IA. Por debajo se compensa "de forma suave", que puede
 * significar no tocar nada — cambiar una fruta por otra no debe reescribir la
 * semana.
 */
const FORCE_ADJUST_KCAL = 200;

export async function reflowMeals(opts: {
  supabase: SupabaseClient<never, never, never>;
  userId: string;
  key: string;
  month: string;
  today: string;
  note: string;
  kcalDelta: number | null;
  /**
   * Fechas en las que se puede recolocar (ver `compensationWindow`). Sin ella,
   * cualquier día futuro del mes.
   */
  window?: readonly string[];
  /**
   * Desvío personal (el picoteo): tampoco quien planifica toca las comidas
   * compartidas, que son de toda la casa. Se corrige en las suyas en solitario.
   */
  soloOnly?: boolean;
  /**
   * Medir cuánto mueven los cambios con sus recetas y, si se quedan cortos,
   * insistir UNA vez con los números (ticket 18). Lo usa `settleDay`.
   */
  measure?: boolean;
}): Promise<{
  plan: MonthlyPlan;
  before: MonthlyPlan;
  summary: string;
  synced: number;
  /** Lo que compensan de verdad (ver `absorbedKcal`); `null` sin medir. */
  absorbedKcal: number | null;
  /** Se insistió y siguió corto. */
  partial: boolean;
}> {
  const { supabase, userId, key, month, today, note, kcalDelta } = opts;

  const { data: row } = await ownPlanRow(supabase, userId, month, "plan, shopping, pantry_extras");
  const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
  const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
  const pantryExtras = cleanPantryExtras(
    (row as { pantry_extras?: unknown } | null)?.pantry_extras,
  );
  if (!current) throw new ValidationError("Todavía no hay plan de este mes");

  const recentLogsQuery = (columns: string) =>
    supabase
      .from("daily_logs")
      .select(columns)
      .eq("user_id", userId)
      .lte("log_date", today)
      .order("log_date", { ascending: false })
      .limit(7);
  const [{ data: profile }, withSnacks] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    recentLogsQuery("log_date, weight_kg, habits, mood, notes, snacks"),
  ]);
  // Sin la migración `daily_logs_snacks` la columna no existe (42703): se
  // relee sin ella en vez de quedarse sin los últimos días en el prompt.
  const { data: logs } =
    (withSnacks.error as { code?: string } | null)?.code === "42703"
      ? await recentLogsQuery("log_date, weight_kg, habits, mood, notes")
      : withSnacks;
  // El picoteo va resumido: el libro de cuentas y el último ajuste no le
  // aportan nada al modelo y alargarían mucho el prompt.
  const recentLogs = ((logs ?? []) as Record<string, unknown>[]).map(({ snacks, ...log }) => {
    const entries = cleanDaySnacks(snacks)?.entries ?? [];
    return entries.length
      ? { ...log, picoteo: entries.map((e) => `${e.text} (~${e.kcal} kcal)`) }
      : log;
  });

  const p = (profile ?? {}) as Record<string, unknown>;
  const cursor = planCursor(today);
  const goalLine = (() => {
    if (p.target_weight_kg != null) {
      const target = Number(p.target_weight_kg);
      const current = Number(p.current_weight_kg ?? p.start_weight_kg ?? target);
      const diff = Math.abs(current - target);
      const dir = deriveGoalType(current, target);
      const datePart = p.goal_target_date ? `, fecha orientativa ${p.goal_target_date}` : "";
      if (dir === "mantener" || diff < 1)
        return `Peso objetivo: ${target} kg (actual: ${current} kg — en mantenimiento${datePart}). Equilibra, no restrinjas.`;
      const verb = dir === "perder" ? "perder" : "ganar";
      return `Peso objetivo: ${target} kg (actual: ${current} kg, falta: ${diff.toFixed(1)} kg por ${verb}${datePart}). Ritmo saludable: máx ~1 kg/semana de pérdida, ~0.5 kg/semana de ganancia; nunca déficit mayor de 500 kcal/día.`;
    }
    // Fallback legacy
    const gt = p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
    return gt
      ? `Objetivo: ${gt} ${p.goal_amount ?? ""} kg, fecha objetivo ${String(p.goal_target_date ?? "sin fecha")}, peso actual ${String(p.current_weight_kg ?? "?")} kg, peso inicial ${String(p.start_weight_kg ?? "?")} kg.`
      : "La persona no tiene un objetivo de peso definido: no asumas uno ni recoloques el plan para adelgazar; céntrate en comidas equilibradas y hábitos.";
  })();
  // Por debajo de este desvío, compensar es opcional (cambiar un plátano por
  // una manzana no debe recolocar la semana). Por encima, el prompt lo exige:
  // sin esto el modelo respondía "el plan ya está equilibrado" incluso ante una
  // pizza con cerveza, que es justo lo que la persona nota como incoherente.
  const strongDelta = kcalDelta != null && Math.abs(kcalDelta) >= FORCE_ADJUST_KCAL;
  const kcalLine = kcalDelta
    ? kcalDelta > 0
      ? `Hoy hay un EXCESO estimado de ${kcalDelta} kcal sobre lo que preveía el plan.` +
        (strongDelta
          ? " Es un desvío grande: NO devuelvas el plan igual. Tienes que recolocar al menos DOS días posteriores a hoy para absorberlo (cenas más ligeras, más verdura y proteína, raciones algo menores), repartido y nunca todo en un día ni con platos de castigo."
          : " Compénsalo de forma suave repartida entre los días siguientes (nunca todo en un día, nunca con platos de castigo).")
      : `Hoy hay un DÉFICIT extra estimado de ${Math.abs(kcalDelta)} kcal (por ejemplo ejercicio) sobre lo que preveía el plan.` +
        (strongDelta
          ? " Es un desvío grande: NO devuelvas el plan igual. Tienes que reponerlo en al menos DOS días posteriores a hoy con comidas algo más completas, sin pasar hambre."
          : " Reponlo en los días siguientes con algo más de energía en las comidas, sin pasar hambre.")
    : "Si de lo que cuenta se deduce un exceso o un déficit de energía, compénsalo de forma suave en los días siguientes.";

  const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
  const home = await householdContext(supabase as never, userId);
  // Un no planificador recoloca sus comidas en solitario; las compartidas
  // las lleva quien planifica en casa (D2). Se lo decimos a la IA en el
  // prompt Y, por si no lo respeta, se congelan mecánicamente después
  // (mismo patrón "cinturón y tirantes" que el resto de REGLAs).
  const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== userId;
  const hasSharedSlots = HOUSEHOLD_MEAL_KEYS.some((m) => home.sharedSlots[m].length);
  // Sin otro adulto en la mesa, "compartido" no protege a nadie más (p. ej.
  // una persona adulta sola con peques a cargo): sus comidas se tratan como
  // propias igualmente, igual que en `compensationWindow`.
  const soloAdultHousehold = home.members.length <= 1;
  // Quien planifica también deja quietas las compartidas si el desvío es solo
  // suyo (`soloOnly`): su picoteo no cambia la cena de toda la casa.
  const freezeShared =
    isNonPlannerInHousehold ||
    (!!opts.soloOnly && !!home.plannerId && hasSharedSlots && !soloAdultHousehold);
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  const sharedSlotsLine = isNonPlannerInHousehold
    ? `REGLA 5: Hay comidas compartidas en tu casa que lleva ${plannerName}: ${describeSharedSlots(home.sharedSlots)}. NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo tus comidas en solitario.\n`
    : freezeShared
      ? `REGLA 5: Estas comidas se comparten con el resto de la casa: ${describeSharedSlots(home.sharedSlots)}. Este ajuste es solo de esta persona: NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo sus comidas en solitario.\n`
      : "";

  // Comidas que esta persona quiere planificar (ver generateMonthlyPlan):
  // una recolocación tampoco debe reintroducir un slot que ya excluyó.
  const selectedSlots = effectiveMealSlots(
    p as { meal_slots?: unknown; meals_to_plan?: string | null },
  );
  const mealSlotsLine =
    selectedSlots.length < MEAL_SLOTS.length
      ? `REGLA 6: solo planifica ${selectedSlots.map((s) => MEAL_SLOT_LABEL[s].toLowerCase()).join(", ")}. No propongas nada para ${MEAL_SLOTS.filter(
          (s) => !selectedSlots.includes(s),
        )
          .map((s) => MEAL_SLOT_LABEL[s].toLowerCase())
          .join(", ")}: esos campos se quedan vacíos.\n`
      : "";

  // El plan guardado no tiene fechas: es una rejilla de 4 semanas × Lunes…
  // Domingo, y qué fecha es cada celda lo decide `dateOfPlanCell` (la semana la
  // marca el día del mes, no el orden natural). Sin esa anotación el modelo
  // entendía "posterior a hoy" como "más abajo en la fila", y en un lunes eso
  // son los días 1 al 6 — ya pasados. Recolocaba de verdad, pero siempre en
  // días que no se podían tocar, y el ajuste no aparecía por ningún lado.
  // Las comidas elegidas a mano van como "fijo": el modelo no debe proponer
  // cambiarlas (y si lo hace, `applyPlanChanges` las ignora igualmente).
  const dated = {
    ...current,
    weeks: current.weeks.map((week, wi) => ({
      ...week,
      days: week.days.map(({ pinned, ...d }, di) => ({
        fecha: dateOfPlanCell(month, wi, di),
        ...d,
        ...(pinned?.length ? { fijo: pinned } : {}),
      })),
    })),
  };
  // Fechas que sí se pueden recolocar, dichas de forma explícita: es más difícil
  // de ignorar que una regla en prosa.
  const editableDates = current.weeks
    .flatMap((week, wi) => week.days.map((_, di) => dateOfPlanCell(month, wi, di)))
    .filter((d): d is string => !!d && d > today && (!opts.window || opts.window.includes(d)));

  /**
   * Una pasada de recolocación. `insist` solo lleva texto en el reintento: ver
   * abajo por qué hace falta pedirlo dos veces.
   *
   * Se le pide SOLO la lista de días a cambiar, no el plan entero de vuelta.
   * Pidiendo las cuatro semanas completas para mover dos cenas, el modelo
   * devolvía casi siempre el plan copiado tal cual (y cuando cambiaba algo lo
   * ponía en la fila equivocada): mucho texto de salida por un cambio mínimo.
   * Una lista corta con fechas explícitas es barata de generar, fácil de
   * validar y se aplica de forma determinista aquí, no a base de confiar.
   */
  const askReflow = (insist: string) =>
    askForJson(
      {
        key,
        userId,
        model: PLAN_MODEL,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          insist +
          `Plan actual del mes ${month} (cada día lleva su "fecha" real):\n${JSON.stringify(dated)}\n\n` +
          `Ingredientes ya comprados (no pueden cambiar): ${ingredientNames(shopping)}\n\n` +
          (pantryExtras.length
            ? `Además la persona dice tener ya en casa (fuera de la lista de la compra, puedes usarlos en los platos): ${pantryExtras.map((e) => e.name).join(", ")}\n\n`
            : "") +
          `${goalLine}\n` +
          `Últimos días reales registrados: ${JSON.stringify(recentLogs)}\n\n` +
          `Hoy es ${today} (${cursor.dayName}, semana ${cursor.weekIndex + 1} del plan).\n` +
          `Lo que ha pasado / lo que cuenta la persona: ${note}\n\n` +
          `REGLA 1: las ÚNICAS fechas que puedes cambiar son ${editableDates.join(", ") || "ninguna"}. Hoy y los días anteriores están cerrados. Guíate por la "fecha" de cada día, no por su posición en la semana. Si un día lleva "fijo", esas comidas las eligió la persona a mano: no las cambies (puedes cambiar la otra comida de ese día).\n` +
          `REGLA 2: usa SOLO los ingredientes ya comprados y los que la persona dice tener en casa (más sal, aceite, agua y especias). No cambies la lista de la compra ni añadas alimentos nuevos que no estén en ninguna de esas dos listas.\n` +
          `REGLA 3: ${kcalLine}\n` +
          "REGLA 4: mantén el rumbo del objetivo con ajustes realistas (más verdura y proteína, raciones algo menores o mayores, cenas más ligeras o más completas). Tono comprensivo, sin culpar ni compensar en exceso. " +
          `${PLAN_STRUCTURE_REMINDER} ` +
          `${sharedSlotsLine}` +
          `${mealSlotsLine}` +
          "En 'intro', 1-2 frases en lenguaje sencillo explicando qué has recolocado y por qué. " +
          'Devuelve SOLO los días que cambias, no el plan entero, como JSON válido: {"intro": string, "cambios": [{"fecha": "AAAA-MM-DD", "comida": string, "cena": string}]}. Incluye "comida" o "cena" solo si cambian ese plato. Sin markdown.',
      },
      (parsed) => {
        const clean = cleanReflowChanges(parsed, editableDates);
        const raw = (parsed as { cambios?: unknown } | null)?.cambios;
        if (clean && Array.isArray(raw) && raw.length > clean.changes.length) {
          // Cambios que la IA propuso fuera de las fechas permitidas: se
          // descartan, pero conviene verlo (un "ajuste" que no cambia nada).
          logEvent("warn", "reflow_changes_discarded", {
            proposed: raw.length,
            kept: clean.changes.length,
          });
        }
        return clean;
      },
    );

  let reflow = await askReflow("");
  let absorbed: number | null = null;
  let partial = false;
  /** Lo que mueve cada plato recolocado del reflow elegido (ver `addKcalAdjust`). */
  let movedCells: KcalAdjustCell[] = [];

  /**
   * Ticket 18: cuánto compensan de verdad unos cambios, con las recetas de la
   * caché a la ración del plan (solo se recolocan comidas propias). Hasta que
   * el reajuste sea código (ticket 12), es lo que evita dar por "compensado" un
   * cambio de lentejas por garbanzos que mueve 30 kcal de 400.
   *
   * Devuelve también lo que mueve cada plato: es lo que se guarda en el día como
   * `kcalAdjust`, porque los platos del plan se escalan al objetivo de su comida
   * (`plannedMacros`) y un plato más ligero, escalado, ya no aligera nada.
   */
  const measure = async (
    changes: PlanChange[],
  ): Promise<{ absorbed: number; cells: KcalAdjustCell[] } | null> => {
    const cells = diffFutureMeals(current, applyPlanChanges(current, changes, today), today);
    if (!cells.length) return { absorbed: 0, cells: [] };
    const [{ getRecipes }, { macrosOfRecipe }, { energyTargets }, { portionFactors }] =
      await Promise.all([
        import("@/lib/nutrition/recipes.server"),
        import("@/lib/nutrition/recipe"),
        import("@/lib/nutrition/energy"),
        import("@/lib/nutrition/portion"),
      ]);
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const factor = portionFactors(energyTargets(profile as never), profile as never).plan;
    const recipes = await getRecipes(
      cells.flatMap((c) => [c.before, c.after]),
      { apiKey: key, userId },
    );
    const kcalOf = (dish: string) => {
      const recipe = recipes.get(dish.trim())?.recipe;
      return recipe ? macrosOfRecipe(recipe, factor).kcal : null;
    };
    const total = absorbedKcal(cells, kcalOf);
    if (total == null) return null;
    return {
      absorbed: total,
      cells: cells.map((c) => ({
        date: c.date,
        slot: c.slot,
        kcal: (kcalOf(c.after) ?? 0) - (kcalOf(c.before) ?? 0),
      })),
    };
  };

  if (opts.measure && kcalDelta) {
    const first = await measure(reflow.changes).catch((error) => {
      console.error("reflowMeals: medir", error);
      return null;
    });
    absorbed = first?.absorbed ?? null;
    movedCells = first?.cells ?? [];
    // Corto (o nada): UNA insistencia, con los números. Sustituye a la genérica
    // de "no has cambiado nada".
    if (absorbed != null && strongDelta && absorbsTooLittle(absorbed, kcalDelta)) {
      const sign = Math.sign(kcalDelta);
      const missing = Math.round(Math.abs(kcalDelta) - Math.max(0, absorbed * sign));
      const second = await askReflow(
        `AVISO: tus cambios mueven unas ${Math.max(0, Math.round(absorbed * sign))} de las ` +
          `${Math.abs(kcalDelta)} kcal que hay que ${sign > 0 ? "quitar" : "reponer"}; faltan unas ` +
          `${missing}. ${sign > 0 ? "Cambia platos por otros más ligeros" : "Cambia platos por otros más completos"} ` +
          "en los días permitidos hasta cubrir esa diferencia, repartida en al menos dos días.\n\n",
      );
      const again = second.changes.length ? await measure(second.changes).catch(() => null) : null;
      if (again != null && again.absorbed * sign > absorbed * sign) {
        reflow = second;
        absorbed = again.absorbed;
        movedCells = again.cells;
      }
      partial = absorbsTooLittle(absorbed, kcalDelta);
    }
    // Para comparar después con el reajuste en código (ticket 12).
    console.info("reflowMeals: absorbido", {
      pending: kcalDelta,
      absorbed,
      ratio: absorbed != null ? Math.round((absorbed / kcalDelta) * 100) / 100 : null,
    });
  }

  // Un desvío grande sin ni un cambio es, casi siempre, el modelo escurriendo
  // el bulto. Se le insiste UNA vez: cuesta una llamada extra y solo pasa en el
  // caso que la persona nota como incoherente ("me he comido una pizza y dice
  // que no cambia nada"). Con `measure`, la insistencia de arriba ya lo cubre.
  if (!opts.measure && strongDelta && !reflow.changes.length) {
    console.warn(`reflowMeals: ${kcalDelta} kcal de desvío y ningún cambio; insistiendo`);
    const second = await askReflow(
      "AVISO: en tu respuesta anterior no cambiaste ningún día, y para este desvío eso no vale. Devuelve al menos DOS días con platos distintos.\n\n",
    );
    if (second.changes.length) reflow = second;
    else console.warn("reflowMeals: sigue sin cambiar nada tras insistir");
  }
  // Sin `measure` (el coach, un plato futuro cambiado a mano), si hay desvío que
  // compensar también se guarda lo que mueve cada plato: si no, el escalado al
  // objetivo de la comida lo borraría y el cambio no compensaría nada.
  if (!opts.measure && kcalDelta && reflow.changes.length) {
    const moved = await measure(reflow.changes).catch((error) => {
      console.error("reflowMeals: medir", error);
      return null;
    });
    movedCells = moved?.cells ?? [];
  }
  const merged: MonthlyPlan = {
    ...addKcalAdjust(applyPlanChanges(current, reflow.changes, today), movedCells, today),
    intro: reflow.intro || current.intro,
  };
  // Cinturón: si la IA tocó igualmente un día compartido, se restaura desde
  // `current` (congelado) — un no planificador nunca puede acabar
  // escribiendo, ni por accidente, el plato de una comida de la casa.
  const sharedComposed = freezeShared
    ? (composeMonthlyPlanForMember(merged, current, home.sharedSlots) ?? merged)
    : merged;
  // Mismo cinturón que en generateMonthlyPlan: si la IA reintrodujo un slot
  // que la persona no quiere planificar, se vacía aquí también.
  const final = blankUnselectedSlots(sharedComposed, selectedSlots);

  const { error } = await supabase
    .from("monthly_plans")
    .update({ plan: final as never } as never)
    .eq("month", month)
    .eq("user_id", userId);
  if (error) throw error;

  // Quien planifica con las compartidas congeladas (`soloOnly`) no ha cambiado
  // nada de la casa: no hay nada que espejar al resto.
  const { synced } =
    freezeShared && !isNonPlannerInHousehold
      ? { synced: 0 }
      : await syncSharedMeals({ supabase: supabase as never, userId, month, today });

  const summary = isNonPlannerInHousehold
    ? `${final.intro} Las comidas compartidas de tu hogar no las toco — esas las lleva ${plannerName}.`
    : freezeShared
      ? `${final.intro} Las comidas que compartes con tu casa no las toco.`
      : synced
        ? `${final.intro} También he ajustado las comidas compartidas de tu hogar.`
        : final.intro;

  return { plan: final, before: current, summary, synced, absorbedKcal: absorbed, partial };
}

export const adjustMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { month: string; note: string; today?: string; kcalDelta?: number | null }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      const kcal = Number(input?.kcalDelta);
      return {
        month: input.month,
        note: String(input?.note ?? "").slice(0, 1500),
        today,
        kcalDelta: Number.isFinite(kcal) && kcal !== 0 ? Math.round(kcal) : null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; summary: string }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-adjust");

    const { plan, summary } = await reflowMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      key,
      month: data.month,
      today: data.today,
      note: data.note,
      kcalDelta: data.kcalDelta,
    });
    return { plan, summary };
  });

// ---------------------------------------------------------------------------
// Compensación de un cambio de plato de un día FUTURO
// ---------------------------------------------------------------------------

/**
 * Relee, modifica y escribe `daily_logs.habits` de un día, reintentando si otra
 * escritura se cruzó — mismo patrón que `patchSnacks` en `snacks.functions.ts`,
 * pero para la columna `habits`. `null` si el día todavía no existe: lo crea
 * siempre el cliente al abrir Hoy, nunca esta función, así que sin fila no hay
 * nada que compensar.
 */
type HabitsRow = { habits: MealHabit[]; updatedAt: string };
const HABITS_WRITE_ATTEMPTS = 3;

async function readHabitsRow(
  supabase: SupabaseClient<never, never, never>,
  userId: string,
  date: string,
): Promise<HabitsRow | null> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("habits, updated_at")
    .eq("user_id", userId)
    .eq("log_date", date)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { habits?: unknown; updated_at: string };
  return {
    habits: (Array.isArray(row.habits) ? row.habits : []) as MealHabit[],
    updatedAt: row.updated_at,
  };
}

async function writeHabitsIfUnchanged(
  supabase: SupabaseClient<never, never, never>,
  userId: string,
  date: string,
  row: HabitsRow,
  habits: MealHabit[],
): Promise<boolean> {
  const { data, error } = await supabase
    .from("daily_logs")
    .update({ habits } as never)
    .eq("user_id", userId)
    .eq("log_date", date)
    .eq("updated_at", row.updatedAt)
    .select("id");
  if (error) throw error;
  return !!data?.length;
}

async function patchHabits(
  supabase: SupabaseClient<never, never, never>,
  userId: string,
  date: string,
  update: (current: MealHabit[]) => MealHabit[],
): Promise<MealHabit[] | null> {
  for (let attempt = 0; attempt < HABITS_WRITE_ATTEMPTS; attempt++) {
    const row = await readHabitsRow(supabase, userId, date);
    if (!row) return null;
    const next = update(row.habits);
    if (await writeHabitsIfUnchanged(supabase, userId, date, row, next)) return next;
  }
  throw new Error("No hemos podido guardar el cambio de plato. Inténtalo de nuevo.");
}

/** `goal` que pide `compensationNeed`, a partir del perfil — mismo criterio que
 * usa el prompt del coach (peso objetivo si existe, si no el legacy `goal_type`). */
function resolveCompensationGoal(profile: Record<string, unknown>) {
  return profile.target_weight_kg != null
    ? deriveGoalType(
        Number(profile.current_weight_kg ?? profile.start_weight_kg ?? profile.target_weight_kg),
        Number(profile.target_weight_kg),
      )
    : profile.goal_type
      ? normalizeGoalType(String(profile.goal_type))
      : null;
}

/**
 * Compensación de un cambio de plato de un día FUTURO (ticket 10 de
 * `hoy-semanas-editables`: el coach cambia un plato que no es el de hoy, p.
 * ej. "el jueves quiero pollo en vez de pechuga"). No pasa por `habits` (eso
 * es solo de la pestaña Hoy, que solo existe para el día de hoy): aquí no
 * hace falta acumular entre llamadas porque el coach manda un cambio a la
 * vez, así que se decide y se aplica en el momento con las macros reales de
 * los dos platos (`decomposeDishes`, la misma descomposición que usa la guía
 * diaria, sin atarla a "hoy"). Sin cifras fiables de alguno de los dos platos
 * no se compensa a ciegas.
 */
export const compensateFutureDishChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      today?: string;
      date?: string;
      label?: string;
      slot?: string;
      dish?: string;
      plannedDish?: string;
    }) => {
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      const date = String(input?.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today) {
        throw new ValidationError("Fecha no válida: tiene que ser un día futuro");
      }
      const label = String(input?.label ?? "").slice(0, 60);
      const slot = String(input?.slot ?? "").slice(0, 20);
      const dish = String(input?.dish ?? "").slice(0, 200);
      const plannedDish = String(input?.plannedDish ?? "").slice(0, 200);
      if (!label || !dish || !plannedDish || dish === plannedDish) {
        throw new ValidationError("No hay cambio que compensar");
      }
      return { today, date, label, slot, dish, plannedDish };
    },
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      adjusted: boolean;
      reason?: string;
      changes?: MealChange[];
      summary?: string;
      kcalDelta?: number;
    }> => {
      const supabase = context.supabase as never as SupabaseClient<never, never, never>;
      const { userId } = context;
      const { today, date, label, dish, plannedDish } = data;
      const month = today.slice(0, 7);

      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(userId, "plan-adjust");

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      const profile = (profileRow ?? {}) as Record<string, unknown>;
      const goal = resolveCompensationGoal(profile);

      // El día entero servido como plan, con un plato y con el otro: cada plato
      // al objetivo de su comida (`plannedMacros`) y el día cerrado
      // (`closeDay`). Lo que el escalado de ese plato no cubre lo absorben las
      // demás comidas propias del mismo día; solo lo que queda fuera del día
      // es desvío que compensar en otros.
      const { getRecipes } = await import("@/lib/nutrition/recipes.server");
      const { serveDay } = await import("@/lib/nutrition/day-close");
      const { plannedServingsFor, readOwnPlan } =
        await import("@/lib/nutrition/planned-serving.server");
      const ownPlan = await readOwnPlan(supabase, userId, date.slice(0, 7)).catch((error) => {
        console.error("compensateFutureDishChange: plan", error);
        return null;
      });
      const others = mealsForDate(
        ownPlan,
        date,
        effectiveMealSlots(profile as { meal_slots?: unknown; meals_to_plan?: string | null }),
      ).filter((m) => m.idea && m.moment !== label);
      const dayMeals = [
        ...others.map((m) => ({ moment: m.moment, idea: m.idea })),
        { moment: label },
      ];
      const [recipes, servings] = await Promise.all([
        getRecipes([plannedDish, dish, ...others.map((m) => m.idea)], { apiKey: key, userId }),
        plannedServingsFor({ supabase: supabase as never, userId, profile, date }),
      ]);
      const fromRecipe = recipes.get(plannedDish.trim())?.recipe;
      const toRecipe = recipes.get(dish.trim())?.recipe;
      // Solo con las dos cifras calculadas (D13): sin una, no se compensa a ciegas.
      if (!fromRecipe || !toRecipe) return { adjusted: false, reason: "no-macros" };
      const dayWith = (recipe: typeof fromRecipe) =>
        serveDay(
          dayMeals.map((m) => {
            const { serving, goal, shared } = servings.planned(m.moment);
            const own = "idea" in m ? (recipes.get(m.idea.trim())?.recipe ?? null) : recipe;
            return { recipe: own, serving, goal, shared };
          }),
        ).total;
      const from = dayWith(fromRecipe);
      const to = dayWith(toRecipe);

      const decision = compensationNeed({
        deltaKcal: to.kcal - from.kcal,
        deltaProtein: to.protein_g - from.protein_g,
        goal,
        pregnancyStatus: (profile.pregnancy_status as string | null) ?? null,
      });
      if (!decision.compensate) return { adjusted: false, reason: decision.reason };

      const { householdContext } = await import("@/lib/household.server");
      const home = await householdContext(supabase, userId);
      const window = compensationWindow({
        today,
        sharedSlots: home.sharedSlots,
        selectedSlots: effectiveMealSlots(
          profile as { meal_slots?: unknown; meals_to_plan?: string | null },
        ),
        soloAdult: home.members.length <= 1,
      });
      if (window.reason) return { adjusted: false, reason: window.reason };

      const note = `Ha elegido «${dish}» en vez de «${plannedDish}» para ${label.toLowerCase()} del ${weekdayName(date)} ${Number(date.slice(8, 10))}.`;
      const { plan, before, summary } = await reflowMeals({
        supabase,
        userId,
        key,
        month,
        today,
        note,
        kcalDelta: decision.kcalDelta,
        window: window.dates,
        soloOnly: true,
      });
      const futureChanges = diffFutureMeals(before, plan, today);
      if (!futureChanges.length) return { adjusted: false, reason: "no-change" };
      return { adjusted: true, changes: futureChanges, summary, kcalDelta: decision.kcalDelta };
    },
  );

export type ReflowResult = {
  /** Motivo por el que no se hizo nada (no es un error: el cliente no lo enseña). */
  skipped?: "past" | "not-planner" | "no-plan";
  scope?: "meals" | "full";
  plan?: MonthlyPlan;
  shopping?: ShoppingList;
  summary?: string;
};

/**
 * Recálculo automático y silencioso del plan cuando cambia algo que lo invalida
 * (issue 05). Lo dispara el cliente con un debounce tras un cambio de despensa o
 * de mesa — nunca la persona a mano, nunca por tiempo.
 *
 *  - `scope: "meals"` (cambió la despensa extra): recoloca los platos de los días
 *    futuros con `reflowMeals`. La lista de la compra NO se toca (la despensa
 *    extra nunca entra en la lista).
 *  - `scope: "full"` (entró o salió alguien de la mesa, cambió una ración,
 *    alergia o etapa): regenera plan Y cantidades con el hogar nuevo y luego hace
 *    merge — hoy y el pasado se conservan, y las marcas "en casa"/"comprado"
 *    viajan por nombre de ingrediente a la lista nueva.
 *
 * Solo lo ejecuta quien planifica en casa (o quien va en solitario): un no
 * planificador que toca la despensa compartida (issue 06) no dispara la
 * regeneración del plan de otra persona.
 */
export const reflowMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; today?: string; scope?: "meals" | "full" }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    const scope: "meals" | "full" = input?.scope === "full" ? "full" : "meals";
    return { month: input.month, today, scope };
  })
  .handler(async ({ data, context }): Promise<ReflowResult> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    // Un mes pasado no se recalcula: no se puede cumplir y gastaría tokens.
    if (data.month < data.today.slice(0, 7)) return { skipped: "past" };

    const { householdPlannerId, householdContext } = await import("@/lib/household.server");
    const plannerId = await householdPlannerId(context.supabase as never, context.userId);
    if (plannerId && plannerId !== context.userId) return { skipped: "not-planner" };

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-reflow");

    const { data: row } = await ownPlanRow(
      context.supabase as never,
      context.userId,
      data.month,
      "plan, shopping",
    );
    const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!current) return { skipped: "no-plan" };

    if (data.scope === "meals") {
      const { plan, summary } = await reflowMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        key,
        month: data.month,
        today: data.today,
        note: "Ha cambiado lo que hay en la despensa de casa: alguien ha añadido o quitado un ingrediente que ya se tiene. Recoloca SOLO los días posteriores a hoy para aprovechar mejor lo que hay en casa y lo ya comprado. La lista de la compra no cambia.",
        kcalDelta: null,
      });
      return { scope: "meals", plan, summary };
    }

    // scope: "full" — cambió la mesa. Regenera plan y cantidades con el hogar
    // nuevo y hace merge conservando hoy/pasado y las marcas de compra.
    const { syncSharedMeals } = await import("@/lib/household.server");
    const [{ data: profile }, home, constraints] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      householdContext(context.supabase as never, context.userId),
      fetchMonthConstraints(context.supabase as never, context.userId, data.month),
    ]);
    const currentShopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
    const cadence: ShoppingCadence = current.cadence ?? cadenceOf(currentShopping);
    const coverage = current.coverage ?? monthCoverage(data.month, data.today);

    const { householdMealTargets } = await import("@/lib/household.server");
    const sharedTargets = await householdMealTargets(context.supabase as never, context.userId);
    const fresh = await generatePlanBody({
      sharedTargets,
      key,
      userId: context.userId,
      month: data.month,
      cadence,
      coverage,
      home,
      profile,
      constraints,
    });

    const validChildIds = home.children.map((c) => c.id);
    const mergedPlan = mergeFutureKids(
      mergeFuturePlan(current, fresh.plan, data.today),
      fresh.plan,
      data.today,
      validChildIds,
    );
    const finalPlan: MonthlyPlan = { ...mergedPlan, coverage, cadence };
    const finalShopping = carryOwnedCanonical(currentShopping, fresh.shopping);

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({
        plan: finalPlan as never,
        shopping: finalShopping as never,
        // La compra cambió → el mes deja de estar "cerrado del todo".
        // `confirmed_trips` se conserva (los tramos ya hechos siguen marcados);
        // `setTripConfirmed` recalcula el agregado la próxima vez.
        confirmed_at: null,
      } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) {
      console.error("reflowMonthlyPlan", error);
      throw new Error("No hemos podido actualizar el plan con los cambios");
    }

    const { synced } = await syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today: data.today,
    });

    return {
      scope: "full",
      plan: finalPlan,
      shopping: finalShopping,
      summary: synced
        ? `${finalPlan.intro} También he ajustado las comidas compartidas de tu hogar.`
        : finalPlan.intro,
    };
  });

/**
 * Corrige la ortografía de un plato escrito a mano y calcula, en la MISMA
 * llamada al modelo, qué ingredientes necesita que no están en la compra. Un
 * plato a mano se guarda tal cual en el plan y se ve así para siempre (sin
 * corrección posterior) en Hoy, el calendario y la compra — de ahí que haga
 * falta corregirlo aquí: `setPlanMeal`/`setChildMeal` no pasan por el coach
 * (que ya cuida su propia ortografía, ver "Ortografía siempre correcta..." en
 * `coachSystemPrompt`), así que sin esto un cambio directo desde "Comí
 * distinto" se quedaba con las erratas tal cual las escribió la persona.
 *
 * El emparejamiento de ingredientes se resuelve con el modelo porque casar
 * texto libre con la lista no funciona a ojo ("pechuga de pollo" está
 * cubierto por "pollo", "tomates cherry" por "tomate"). Si la llamada falla,
 * el plato se guarda tal cual lo escribió la persona y sin avisos: preferimos
 * no corregir ni avisar antes que corregir mal o avisar en falso.
 *
 * No tiene cuota horaria propia (el cambio de plato no debe fallar por ella),
 * pero sí cuenta contra el tope de gasto: al llegar a él, el middleware del
 * modelo lanza, cae en el `catch` y el plato se guarda igual, sin corregir.
 */
async function resolveDish(
  userId: string,
  dish: string,
  shopping: ShoppingList,
  pantryExtras: PantryExtra[] = [],
  /**
   * ¿Se rechaza un texto vago ("algo rápido")? Sí en un cambio pedido por la
   * persona; no al deshacer (se restaura el plato del plan) ni cuando apunta
   * las kcal a mano, que es justo la salida que se le ofrece (ticket 13).
   */
  rejectVague = false,
): Promise<{ dish: string; off: string[] }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { dish, off: [] };

  const bought = ingredientNames(shopping);
  const extra = pantryExtras.map((e) => e.name).join(", ");
  const names = [bought, extra].filter(Boolean).join(", ");

  try {
    const ai = createAiProvider(key, userId);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      temperature: 0,
      prompt:
        `Plato: "${dish}"\n\n` +
        "Corrige solo la ortografía de ese nombre de plato (acentos/tildes, mayúscula inicial, " +
        "erratas), sin cambiar el plato en sí ni añadir nada. Si ya está bien escrito, devuélvelo " +
        "igual.\n" +
        "Dime también si eso es comida de verdad: cualquier plato, alimento o bebida vale, por " +
        "raro, casero o poco saludable que sea. Solo NO es comida si es una broma, un insulto o " +
        "algo que no se come.\n" +
        'Y si es vago: true SOLO si el texto no permite saber qué se comió ("algo rápido", ' +
        '"lo de siempre", "lo que había en la oficina", "cualquier cosa"). Un plato genérico pero ' +
        'reconocible ("un bocadillo", "ensalada", "pasta") NO es vago.\n' +
        (names
          ? `Ingredientes disponibles (comprados y los que dice tener en casa): ${names}\n` +
            "Además, ¿qué ingredientes necesarios para ese plato NO están disponibles? " +
            "Da por disponibles la sal, el aceite, el vinagre, el agua y las especias básicas. " +
            "Cuenta como cubierto todo ingrediente equivalente aunque el nombre no sea idéntico " +
            "(p. ej. 'pechuga de pollo' lo cubre 'pollo'; 'tomate cherry' lo cubre 'tomate').\n"
          : "") +
        `Devuelve solo JSON: {"comida": true|false, "vago": true|false, "plato": "nombre del plato con la ortografía corregida"${
          names
            ? ', "fuera": [ingredientes que faltan, en minúsculas, máx. 5; lista vacía si no falta ninguno]'
            : ""
        }}`,
    });
    const parsed = (parseJsonLoose(text) ?? {}) as {
      plato?: unknown;
      fuera?: unknown;
      comida?: unknown;
      vago?: unknown;
    };
    // Segunda red, después de `assertCleanFood`: la lista corta lo evidente sin
    // gastar nada, y esto coge lo que una lista nunca cogerá (otros idiomas,
    // eufemismos, "un plato de heces"). Solo con un `false` explícito: si el
    // campo no llega, se deja pasar, como todo lo demás de esta función.
    if (parsed.comida === false) throw new ValidationError(BLOCKED_FOOD_MESSAGE);
    // Texto que no dice qué se comió: no se guarda un plato que luego no se
    // puede calcular, se le pide a la persona que concrete (D13). Igual que con
    // "comida", solo con un `true` explícito.
    if (rejectVague && parsed.vago === true) throw new ValidationError(VAGUE_DISH_MESSAGE);
    const corrected = typeof parsed.plato === "string" ? parsed.plato.trim() : "";
    const off = (Array.isArray(parsed.fuera) ? parsed.fuera : [])
      .map((n) => String(n).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    return { dish: corrected && corrected.length <= 200 ? corrected : dish, off };
  } catch (error) {
    // "Esto no es comida" es una decisión, no un fallo del modelo: tiene que
    // salir fuera en vez de caer en el respaldo de "guárdalo tal cual".
    if (error instanceof ValidationError) throw error;
    console.error("resolveDish", error);
    return { dish, off: [] };
  }
}

/**
 * Cambia UN plato de UN día (hoy o futuro), sin pasar por la IA de planificación:
 * lo que pide la persona se escribe tal cual en el plan. Complementa a
 * `adjustMonthlyPlan`, que recoloca varios días para compensar; aquí el cambio
 * es literal y verificable, que es lo que se espera al pedir "cámbiame el
 * desayuno de mañana". Los días pasados no se tocan (ya están cerrados) y la
 * lista de la compra tampoco: si el plato pide algo que no se compró, se guarda
 * igualmente pero queda marcado para avisar en el chat y en pantalla.
 */
export const setPlanMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      date: string;
      slot: string;
      dish: string;
      today?: string;
      pin?: boolean;
      /** La persona apunta las kcal a mano: se acepta un texto vago (ticket 13). */
      manual?: boolean;
    }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
        throw new ValidationError("Fecha no válida");
      if (!MEAL_SLOTS.includes(input?.slot as MealSlot))
        throw new ValidationError("Comida no válida");
      const dish = String(input?.dish ?? "")
        .trim()
        .slice(0, 200);
      if (!dish) throw new ValidationError("Falta el plato nuevo");
      // Frontera de verdad: cubre a la vez la web, la app móvil (vía
      // `/api/v1/plan/meal`) y la herramienta `cambiar_plato` del coach.
      assertCleanFood(dish);
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      if (input.date < today) {
        throw new ValidationError(
          "Los días pasados ya están cerrados: solo puedo cambiar de hoy en adelante",
        );
      }
      // Un plato pedido a mano queda fijado por defecto; `pin: false` solo lo
      // manda "Deshacer", para devolver el día al estado exacto de antes.
      const pin = input?.pin !== false;
      return {
        date: input.date,
        slot: input.slot as MealSlot,
        dish,
        today,
        pin,
        manual: input?.manual === true,
      };
    },
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      plan: MonthlyPlan;
      label: string;
      dish: string;
      off: string[];
      previousIdea: string;
      /** ¿Esa comida ya estaba elegida a mano antes del cambio? Para "Deshacer". */
      previousPinned: boolean;
    }> => {
      await guardSharedSlotWrite(context.supabase, context.userId, data.date, data.slot);

      const month = data.date.slice(0, 7);
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        month,
        "plan, shopping, pantry_extras",
      );

      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new ValidationError(`Todavía no hay plan del mes ${month}`);
      const at = planSlotIndex(current, data.date);
      if (!at) throw new ValidationError("Ese día todavía no tiene menú en el plan");

      // Plato resuelto tal cual se veía en pantalla antes de este cambio (con
      // la rotación semanal ya aplicada para desayuno/snack si no había un
      // plato pedido a mano ese día), para que el caller pueda guardarlo como
      // "lo que había antes" — ver `wasIdea` en daily.ts.
      const previousIdea =
        mealsForDate(current, data.date).find((m) => m.slot === data.slot)?.idea ?? "";

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const { dish, off } = await resolveDish(
        context.userId,
        data.dish,
        shopping,
        pantryExtras,
        data.pin && !data.manual,
      );
      const previousPinned = isPinned(current.weeks[at.weekIndex]?.days[at.dayIndex], data.slot);

      const next = withPlanMeal(current, data.date, data.slot, dish, { off, pin: data.pin });
      if (!next) throw new ValidationError("Ese día todavía no tiene menú en el plan");

      const { error } = await context.supabase
        .from("monthly_plans")
        .update({ plan: next as never } as never)
        .eq("month", month)
        .eq("user_id", context.userId);
      if (error) {
        console.error("setPlanMeal", error);
        throw new Error("No hemos podido guardar el cambio de plato");
      }

      const { syncSharedMeals } = await import("@/lib/household.server");
      await syncSharedMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        month,
        today: data.today,
      });

      return {
        plan: next,
        label: MEAL_SLOT_LABEL[data.slot],
        dish,
        off,
        previousIdea,
        previousPinned,
      };
    },
  );

/**
 * Guarda lo que la persona contó antes de generar el plan de un mes, en la
 * conversación con el coach que va SIEMPRE antes de generar (`MonthIntakeChat`,
 * `month-intake.ts`): si va a estar fuera de casa un tramo (fechas) y las
 * otras cuatro respuestas (eventos, rutina, ingredientes, notas), que se
 * guardan juntas en `notes` con su etiqueta. Como un mes se genera una sola
 * vez, esto es lo que lo personaliza. Dato personal: no se comparte con el resto del hogar
 * (`generatePlanBody` solo lo aplica a las comidas propias de quien lo
 * guardó, nunca a las compartidas).
 */
export const setMonthConstraints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      month: string;
      awayStart?: string | null;
      awayEnd?: string | null;
      notes?: string | null;
      /** Respuestas de la conversación previa al plan (`MonthIntakeChat`). */
      answers?: IntakeAnswers | null;
    }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const hasStart = input?.awayStart != null && input.awayStart !== "";
      const hasEnd = input?.awayEnd != null && input.awayEnd !== "";
      if (hasStart !== hasEnd) throw new ValidationError("Rango de fechas no válido");
      if (
        hasStart &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(input.awayStart!) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(input.awayEnd!) ||
          input.awayStart! > input.awayEnd!)
      ) {
        throw new ValidationError("Rango de fechas no válido");
      }
      // Las respuestas se arman aquí (nunca un texto ya compuesto por el
      // cliente): etiqueta por pregunta, chips solo de su lista, cada una
      // limpia para entrar al prompt como dato. `notes` a pelo sigue valiendo
      // para un cliente antiguo.
      const notes = input?.answers
        ? (monthIntakeNotes(input.answers) ?? "")
        : cleanIntakeText(input?.notes);
      return {
        month: input.month,
        awayStart: hasStart ? input.awayStart! : null,
        awayEnd: hasStart ? input.awayEnd! : null,
        notes: notes || null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<MonthConstraints> => {
    const { error } = await context.supabase.from("month_constraints").upsert(
      {
        user_id: context.userId,
        month: data.month,
        away_start: data.awayStart,
        away_end: data.awayEnd,
        notes: data.notes,
      } as never,
      { onConflict: "user_id,month" },
    );
    if (error) {
      console.error("setMonthConstraints", error);
      throw new Error("No hemos podido guardar esto. Inténtalo otra vez.");
    }
    return data;
  });

/**
 * Pone (o quita) el plato aparte de un niño para un día concreto — paralela a
 * `setPlanMeal`, pero sobre `PlanDay.kids`. El plato aparte es parte del plan
 * compartido de la casa, así que solo lo cambia el planificador (D2): un no
 * planificador recibe un aviso y no se toca nada. `childId` puede venir como el
 * id real del niño o como su nombre (lo usa el coach). `dish` vacío quita el
 * override y el niño vuelve a comer el plato compartido. Los días pasados no se
 * tocan y la lista de la compra tampoco: si el plato pide algo no comprado, se
 * guarda igual y queda en `kids[].off` para avisar.
 */
export const setChildMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { date: string; slot: string; childId: string; dish: string; today?: string }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
        throw new ValidationError("Fecha no válida");
      // Solo las 3 comidas principales: el snack nunca es compartido ni lleva
      // plato aparte de un niño (D5), así que no se espejaría a nadie.
      if (!HOUSEHOLD_MEAL_KEYS.includes(input?.slot as MealKey))
        throw new ValidationError("Comida no válida");
      const childId = String(input?.childId ?? "").trim();
      if (!childId) throw new ValidationError("Falta el niño");
      const dish = String(input?.dish ?? "")
        .trim()
        .slice(0, 200);
      // Vacío es legítimo aquí (quita el plato aparte y el niño vuelve a lo
      // compartido); lo que no vale es que tenga contenido y sea una broma.
      if (dish) assertCleanFood(dish);
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      if (input.date < today) {
        throw new ValidationError(
          "Los días pasados ya están cerrados: solo puedo cambiar de hoy en adelante",
        );
      }
      return { date: input.date, slot: input.slot as MealSlot, childId, dish, today };
    },
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      plan: MonthlyPlan;
      childName: string;
      label: string;
      dish: string;
      off: string[];
    }> => {
      const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
      const home = await householdContext(context.supabase as never, context.userId);
      const child =
        home.children.find((c) => c.id === data.childId) ??
        home.children.find((c) => normName(c.name) === normName(data.childId));
      if (!child) throw new ValidationError("Ese niño no está en tu casa");
      // El plato aparte de un niño va con la comida compartida: lo fija el
      // planificador, igual que el resto de días compartidos (D2).
      if (home.plannerId && home.plannerId !== context.userId) {
        const plannerName =
          home.members.find((m) => m.userId === home.plannerId)?.displayName ??
          "quien lleva la cocina";
        throw new ValidationError(`El plato de ${child.name} lo pone ${plannerName} de tu casa.`);
      }

      const month = data.date.slice(0, 7);
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        month,
        "plan, shopping, pantry_extras",
      );
      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new ValidationError(`Todavía no hay plan del mes ${month}`);
      const at = planSlotIndex(current, data.date);
      if (!at) throw new ValidationError("Ese día todavía no tiene menú en el plan");

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const { dish, off } = data.dish
        ? await resolveDish(context.userId, data.dish, shopping, pantryExtras)
        : { dish: "", off: [] as string[] };

      const next: MonthlyPlan = {
        ...current,
        weeks: current.weeks.map((week, wi) =>
          wi !== at.weekIndex
            ? week
            : {
                ...week,
                days: week.days.map((day, di) => {
                  if (di !== at.dayIndex) return day;
                  const others = (day.kids ?? []).filter(
                    (k) => !(k.childId === child.id && k.slot === data.slot),
                  );
                  const kids: ChildMeal[] = dish
                    ? [
                        ...others,
                        {
                          childId: child.id,
                          slot: data.slot,
                          dish,
                          ...(off.length ? { off } : {}),
                        },
                      ]
                    : others;
                  const updated: PlanDay = { ...day };
                  if (kids.length) updated.kids = kids;
                  else delete updated.kids;
                  return updated;
                }),
              },
        ),
      };

      const { error } = await context.supabase
        .from("monthly_plans")
        .update({ plan: next as never } as never)
        .eq("month", month)
        .eq("user_id", context.userId);
      if (error) {
        console.error("setChildMeal", error);
        throw new Error("No hemos podido guardar el plato del niño");
      }

      await syncSharedMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        month,
        today: data.today,
      });

      return {
        plan: next,
        childName: child.name,
        label: MEAL_SLOT_LABEL[data.slot],
        dish,
        off,
      };
    },
  );

/**
 * Rellena los platos de los bebés de triturados que faltan en el plan del mes
 * en curso — pasa cuando se da de alta o se cambia de etapa a un bebé DESPUÉS
 * de que `generateMonthlyPlan` ya generó el mes, porque solo esa IA rellena
 * `days[].kids`. Detecta los huecos con `childPureeGaps` (comida/cena, de hoy
 * en adelante) y le pide a la IA SOLO el plato de cada hueco, a partir del
 * plato de la mesa de ese día. Incluso con la IA de por medio, el contrato es
 * el mismo que `setChildMeal`: nunca toca `lunch`/`dinner`/`breakfast` de los
 * adultos ni la lista de la compra — un ingrediente que falte se guarda igual
 * y queda en `kids[].off` para avisar.
 */
export const fillChildMeals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { today?: string }) => ({
    today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input!.today! : zonedTodayISO(),
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ plan: MonthlyPlan; filled: number; children: string[] }> => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "child-meals");

      const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
      const home = await householdContext(context.supabase as never, context.userId);

      // El plato de un peque va con la comida compartida: lo pone el
      // planificador (D2), igual que `setChildMeal`.
      if (home.plannerId && home.plannerId !== context.userId) {
        const plannerName =
          home.members.find((m) => m.userId === home.plannerId)?.displayName ??
          "quien lleva la cocina";
        throw new ValidationError(`Los platos de los peques los pone ${plannerName} de tu casa.`);
      }

      const month = data.today.slice(0, 7);
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        month,
        "plan, shopping, pantry_extras",
      );
      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new ValidationError(`Todavía no hay plan del mes ${month}`);

      const pending = home.children
        .map((child) => ({
          child,
          gaps: childPureeGaps(
            current,
            {
              id: child.id,
              stage: child.stage,
              homeSchedule: child.homeSchedule ?? EMPTY_SCHEDULE,
            },
            data.today,
          ),
        }))
        .filter((p) => p.gaps.length > 0);

      if (!pending.length) return { plan: current, filled: 0, children: [] };

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const available = [ingredientNames(shopping), pantryExtras.map((e) => e.name).join(", ")]
        .filter(Boolean)
        .join(", ");

      const { data: profile } = await context.supabase
        .from("profiles")
        .select("*")
        .eq("id", context.userId)
        .maybeSingle();

      const items = pending.flatMap(({ child, gaps }) =>
        gaps.map((g) => ({
          childId: child.id,
          name: child.name,
          age: child.age,
          allergies: child.allergies,
          date: g.date,
          slot: g.slot,
          adultDish:
            (g.slot === "comida"
              ? planForDate(current, g.date)?.day?.lunch
              : planForDate(current, g.date)?.day?.dinner) || "",
        })),
      );

      const proposals = await askForJson(
        {
          key,
          userId: context.userId,
          model: PLAN_MODEL,
          system: coachSystemPrompt(profile as never, home.text),
          prompt:
            "A un plan del mes ya hecho le faltan platos de bebés de triturados (se dieron de alta después de generar el plan). NO cambies ni menciones el plato de la mesa: solo propón, para CADA hueco de esta lista, el puré o triturado de ese bebé:\n" +
            JSON.stringify(
              items.map((it) => ({
                childId: it.childId,
                nombre: it.name,
                edad: it.age,
                alergias: it.allergies || "ninguna",
                fecha: it.date,
                dia: weekdayName(it.date),
                slot: it.slot,
                platoDeLaMesaEseDia: it.adultDish || "(sin plato de mesa ese día)",
              })),
            ) +
            (available
              ? `\nIngredientes ya en la lista de la compra o en casa: ${available}\n`
              : "\n") +
            'Cada plato: sencillo, sin sal ni azúcar, adaptado a la edad y sin sus alérgenos — normalmente una versión triturada de "platoDeLaMesaEseDia" cuando tenga sentido, o algo sencillo y de temporada si no lo tiene. ' +
            "Devuelve solo JSON: " +
            '{"kids": [objetos {"childId", "fecha", "slot": "comida"|"cena", "dish": plato corto, ' +
            '"off": [ingredientes de ese plato que NO estén ya disponibles, minúsculas, máx. 3, vacío si no falta ninguno]}]}, ' +
            "uno por cada hueco de la lista de arriba, mismo childId/fecha/slot.",
        },
        (parsed) => {
          const o = (parsed ?? {}) as { kids?: unknown };
          const known = new Set(items.map((it) => `${it.childId}|${it.date}|${it.slot}`));
          const out = (Array.isArray(o.kids) ? o.kids : [])
            .map((k) => {
              const r = (k ?? {}) as Record<string, unknown>;
              const childId = String(r.childId ?? "").trim();
              const date = String(r.fecha ?? "").trim();
              const slot =
                r.slot === "cena"
                  ? ("cena" as const)
                  : r.slot === "comida"
                    ? ("comida" as const)
                    : null;
              const dish = String(r.dish ?? "")
                .trim()
                .slice(0, 200);
              if (!slot || !dish || !known.has(`${childId}|${date}|${slot}`)) return null;
              const off = (Array.isArray(r.off) ? r.off : [])
                .map((x) => String(x).trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 3);
              return { childId, date, slot, dish, off };
            })
            .filter((x): x is NonNullable<typeof x> => x != null);
          return out.length ? out : null;
        },
      );

      let next = current;
      let filled = 0;
      const filledChildIds = new Set<string>();
      for (const p of proposals) {
        const at = planSlotIndex(next, p.date);
        if (!at) continue;
        next = {
          ...next,
          weeks: next.weeks.map((week, wi) =>
            wi !== at.weekIndex
              ? week
              : {
                  ...week,
                  days: week.days.map((dayItem, di) => {
                    if (di !== at.dayIndex) return dayItem;
                    const already = (dayItem.kids ?? []).some(
                      (k) => k.childId === p.childId && k.slot === p.slot,
                    );
                    if (already) return dayItem;
                    const kid: ChildMeal = {
                      childId: p.childId,
                      slot: p.slot,
                      dish: p.dish,
                      ...(p.off.length ? { off: p.off } : {}),
                    };
                    filled++;
                    filledChildIds.add(p.childId);
                    return { ...dayItem, kids: [...(dayItem.kids ?? []), kid] };
                  }),
                },
          ),
        };
      }

      if (filled) {
        const { error } = await context.supabase
          .from("monthly_plans")
          .update({ plan: next as never } as never)
          .eq("month", month)
          .eq("user_id", context.userId);
        if (error) {
          console.error("fillChildMeals", error);
          throw new Error("No hemos podido guardar el menú de los peques");
        }

        await syncSharedMeals({
          supabase: context.supabase as never,
          userId: context.userId,
          month,
          today: data.today,
        });
      }

      return {
        plan: next,
        filled,
        children: pending
          .map((p) => p.child)
          .filter((c) => filledChildIds.has(c.id))
          .map((c) => c.name),
      };
    },
  );

/** Calcula cómo afecta lo ocurrido al objetivo y propone acortar el plazo o ser más laxo. */
export const goalImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { note: string; today?: string }) => ({
    note: String(input?.note ?? "").slice(0, 1500),
    today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO(),
  }))
  .handler(
    async ({ data, context }): Promise<{ text: string; suggested_target_date: string | null }> => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "coach-aux");

      const [{ data: profile }, { data: logs }] = await Promise.all([
        context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
        context.supabase
          .from("daily_logs")
          .select("log_date, weight_kg, habits")
          .eq("user_id", context.userId)
          .lte("log_date", data.today)
          .order("log_date", { ascending: false })
          .limit(14),
      ]);

      const result = await askForJson(
        {
          key,
          userId: context.userId,
          system: coachSystemPrompt(profile as never),
          prompt:
            `Perfil: ${JSON.stringify(profile ?? {})}\n` +
            `Últimos días registrados: ${JSON.stringify(logs ?? [])}\n` +
            `Hoy es ${data.today}.\n` +
            `Lo que cuenta la persona: ${data.note}\n\n` +
            "Estima en kcal el impacto de lo que cuenta (exceso o déficit) y calcula cómo afecta a su objetivo de peso y a su fecha objetivo (7700 kcal ≈ 1 kg). " +
            "Después ofrécele dos caminos: 1) mantener el ritmo y adelantar la fecha objetivo, o 2) ser algo más laxo y mantener la fecha. Sin culpar, sin dramatizar, con números orientativos y frases cortas. " +
            // Ticket 01: con "ocultar", el cálculo se hace igual pero el texto
            // que lee la persona no lleva ninguna cifra de energía.
            (showsNutritionNumbers(profile as never)
              ? ""
              : "IMPORTANTE: esta persona NO quiere ver cifras de calorías ni de macros: el campo text no puede llevar ninguna cifra de kcal ni de gramos; habla de fechas y de sensaciones. ") +
            'Devuelve solo JSON: {"kcal_delta": number (positivo = exceso, negativo = déficit), "text": string (máx. 6 líneas, sin markdown, hablándole de tú y terminando con una pregunta para que elija), "suggested_target_date": string "YYYY-MM-DD" o null (sólo si acortar el plazo es realista)}',
        },
        (parsed) => {
          const o = (parsed ?? {}) as Record<string, unknown>;
          const text = String(o.text ?? "").trim();
          if (!text) return null;
          const date = String(o.suggested_target_date ?? "");
          return {
            text,
            suggested_target_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
          };
        },
      );

      return result;
    },
  );

export const welcomeBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string }) => ({ month: String(input?.month ?? "") }))
  .handler(async ({ data, context }): Promise<{ text: string }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "coach-aux");

    const { householdContext } = await import("@/lib/household.server");
    const [{ data: profile }, { data: row }, home] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      ownPlanRow(context.supabase as never, context.userId, data.month, "plan, shopping"),
      householdContext(context.supabase as never, context.userId),
    ]);
    const plan = cleanPlan((row as { plan?: unknown } | null)?.plan);
    const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);

    // Un no planificador del hogar (D1): el plan y la compra de las comidas
    // compartidas los lleva otra persona; él solo planifica sus comidas en
    // solitario. El mensaje de bienvenida tiene que explicar ese reparto en vez
    // de hablar de "tu plan del mes" como si fuera entero suyo.
    const isNonPlanner = !!home.plannerId && home.plannerId !== context.userId;
    const plannerName =
      home.members.find((m) => m.userId === home.plannerId)?.displayName ??
      "otra persona de tu casa";

    const ai = createAiProvider(key, context.userId);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      system: coachSystemPrompt(profile as never, home.householdId ? home.text : null),
      prompt: isNonPlanner
        ? "Escribe un mensaje de bienvenida corto (máx. 10 líneas, sin markdown) para alguien que acaba de entrar en un hogar compartido y NO es quien planifica. Explícale: " +
          `1) que el menú de las comidas compartidas de tu casa y su lista de la compra los prepara ${plannerName}, y que los ve en la app sin tener que generar nada; ` +
          "2) qué hace él: planifica sus comidas en solitario (las que no comparte) desde la pestaña Plan, registra cada día lo que come en la pestaña Hoy, y en Ingredientes marca lo que ya hay en casa o se ha comprado; " +
          "3) que el botón flotante sirve para hablar conmigo cuando quiera. " +
          "Tono motivador y cercano, sin presiones."
        : `Plan del mes creado: ${plan ? JSON.stringify({ intro: plan.intro, focus: plan.focus, semanas: plan.weeks.map((w) => w.focus) }) : "sin plan"}\n` +
          `Lista de la compra (${shoppingTotal(shopping)} ${currencySymbol((profile as { currency?: string | null } | null)?.currency)} aprox.): ${ingredientNames(shopping) || "sin lista"}\n\n` +
          "Escribe un mensaje de bienvenida corto (máx. 10 líneas, sin markdown) que: " +
          "1) resuma en 2 frases el enfoque de su plan del mes y su coste aproximado; " +
          "2) explique cómo funciona la app: la pestaña Hoy con su guía, platos y hábitos; la pestaña Plan con el mes y la lista de la compra que confirma cuando ya ha comprado; el botón flotante para hablar conmigo en cualquier momento; " +
          "3) deje claro que si un día se salta el plan solo tiene que contármelo y yo recoloco los días siguientes con lo que ya tiene comprado, sin cambiar la compra y sin juzgarle. " +
          "Tono motivador y comprensivo, sin presiones.",
    });

    return { text: text.trim() };
  });

export type DishRecipe = { ingredients: string[]; steps: string[] };

/**
 * Receta simplificada de un plato, a demanda: se pide solo cuando la persona
 * expande un plato del plan, para no inflar el JSON del plan ni encarecer cada
 * regeneración. Se apoya en los ingredientes ya comprados del mes si los hay.
 */
export const dishRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { dish: string; month?: string }) => {
    const dish = String(input?.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!dish) throw new ValidationError("Falta el plato");
    const month = /^\d{4}-\d{2}$/.test(input?.month ?? "") ? input!.month! : "";
    return { dish, month };
  })
  .handler(async ({ data, context }): Promise<DishRecipe> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "recipe");

    let pantry = "";
    if (data.month) {
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        data.month,
        "shopping",
      );
      pantry = ingredientNames(cleanShopping((row as { shopping?: unknown } | null)?.shopping));
    }

    return askForJson(
      {
        key,
        userId: context.userId,
        system:
          "Eres un cocinero que explica recetas caseras muy simples, en español, con frases cortas y claras, siempre dentro de la dieta mediterránea (verdura, fruta, legumbre, cereal integral, pescado y aceite de oliva virgen extra por delante; carne roja/procesada y ultraprocesados solo de forma ocasional).",
        prompt:
          `Plato: "${data.dish}"\n` +
          (pantry ? `Ingredientes disponibles en casa: ${pantry}\n` : "") +
          "Da una receta simplificada y realista para cocinar en casa. Usa sobre todo los ingredientes disponibles (más sal, aceite, agua y especias básicas). " +
          'Devuelve solo JSON: {"ingredients": [máx. 8 ingredientes con cantidad orientativa, strings cortos], "steps": [3 a 5 pasos cortos y claros]}',
      },
      (parsed) => {
        const o = (parsed ?? {}) as { ingredients?: unknown; steps?: unknown };
        const ingredients = (Array.isArray(o.ingredients) ? o.ingredients : [])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 8);
        const steps = (Array.isArray(o.steps) ? o.steps : [])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 6);
        return steps.length ? { ingredients, steps } : null;
      },
    );
  });
