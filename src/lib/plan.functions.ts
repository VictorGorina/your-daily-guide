import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_MODEL,
  coachSystemPrompt,
  createAiProvider,
  currencySymbol,
  PLAN_MODEL,
} from "@/lib/ai-provider.server";
import { assertCleanFood, BLOCKED_FOOD_MESSAGE, VAGUE_DISH_MESSAGE } from "@/lib/content-guard";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import { requestDeadline } from "@/lib/deadline";
import {
  EMPTY_SCHEDULE,
  MEAL_KEYS as HOUSEHOLD_MEAL_KEYS,
  type MealKey,
} from "@/lib/household-shared";
import { showsNutritionNumbers } from "@/lib/macros";
import { cleanIntakeText, type IntakeAnswers, monthIntakeNotes } from "@/lib/month-intake";
import { compensationNeed } from "@/lib/nutrition/compensation";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  applyPlanFitChanges,
  cadenceOf,
  childPureeGaps,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  ingredientNames,
  isNextMonthUnlocked,
  isPinned,
  MEAL_SLOT_LABEL,
  MEAL_SLOTS,
  type MealChange,
  mealsForDate,
  type MealSlot,
  mergeRegeneratedPlan,
  type MonthConstraints,
  monthCoverage,
  type MonthlyPlan,
  monthTitle,
  nextMonthISO,
  normName,
  type PantryExtra,
  parseJsonLoose,
  type PlanFitMark,
  planForDate,
  planSlotIndex,
  type ShoppingCadence,
  type ShoppingList,
  shoppingTotal,
  weekdayName,
  withChildMeal,
  withPlanMeal,
} from "@/lib/plan-shared";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { askForJson } from "./plan/ai.server";
import { askPlanFit } from "./plan/fit.server";
import { fetchMonthConstraints, generatePlanBody } from "./plan/generate.server";
import { reflowMeals } from "./plan/reflow.server";
import { guardSharedSlotWrite, ownPlanRow } from "./plan/rows.server";

export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";
export { toggleShoppingOwnedHandler } from "./shopping/state.server";
export * from "./shopping/state.functions";
export { _generatePlanBodyForEval } from "./plan/generate.server";
export { _fitPlanForEval } from "./plan/fit.server";
export { reflowMeals } from "./plan/reflow.server";

/** Un mes se genera una sola vez (`generateMonthlyPlan`). */
function alreadyPlanned(month: string): ValidationError {
  const title = monthTitle(month);
  return new ValidationError(
    `${title.charAt(0).toUpperCase()}${title.slice(1)} ya tiene su plan. Si cambia tu hogar se recalcula solo.`,
  );
}

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
      const deadline = requestDeadline();
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
        throw alreadyPlanned(data.month);
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
        deadline,
        key,
        userId: context.userId,
        month: data.month,
        cadence: data.cadence,
        coverage: monthCoverage(data.month, data.today),
        home,
        profile,
        constraints,
      });

      // `insert`, no `upsert` (ticket 21): la comprobación de arriba va antes de
      // ~100 s de IA, y dos generaciones a la vez (doble toque, web y móvil) la
      // pasaban las dos; la segunda pisaba el plan que la persona ya veía. La
      // restricción única (user_id, month) hace de guarda en la base de datos.
      const { error } = await context.supabase.from("monthly_plans").insert({
        user_id: context.userId,
        month: data.month,
        plan: plan as never,
        shopping: shopping as never,
        confirmed_at: null,
      } as never);
      if ((error as { code?: string } | null)?.code === "23505") {
        throw alreadyPlanned(data.month);
      }
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
    const deadline = requestDeadline();
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
      deadline,
      ask: askPlanFit({
        key,
        userId: context.userId,
        deadline,
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

    // Se escribe sobre la versión más reciente (ticket 21): la ronda tarda y la
    // persona puede haber cambiado un plato mientras. Solo entra un cambio cuya
    // celda sigue igual, y si alguien escribe entre la lectura y la escritura se
    // vuelve a aplicar sobre lo nuevo.
    // `as`: sin él TypeScript no ve la asignación dentro de `rebuild` y los da por null.
    let fit = null as PlanFitMark | null;
    let existing = null as PlanFitMark | null;
    try {
      await updatePlanRowCas(supabase, context.userId, data.month, "plan", (row) => {
        const latest = cleanPlan(row.plan);
        existing = latest?.fit ?? null;
        if (!latest || latest.fit) return null;
        const { plan: applied, applied: stillThere } = applyPlanFitChanges(
          latest,
          report.changed,
          data.today,
        );
        fit = {
          at: new Date().toISOString(),
          before: report.before,
          after: report.after,
          changed: stillThere,
        };
        return { plan: { ...applied, fit } satisfies MonthlyPlan };
      });
    } catch (error) {
      console.error("fitMonthlyPlan: guardar", error);
      throw new Error("No hemos podido guardar el plan ajustado. Inténtalo otra vez.");
    }
    if (!fit) return { fit: existing };
    if (fit.changed.length && canTouchShared) {
      await household.syncSharedMeals({
        supabase: supabase as never,
        userId: context.userId,
        month: data.month,
        today: data.today,
      });
    }
    return { fit };
  });

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
    const deadline = requestDeadline();
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-adjust");

    const { plan, summary } = await reflowMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      key,
      deadline,
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

      const deadline = requestDeadline();
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
        getRecipes([plannedDish, dish, ...others.map((m) => m.idea)], {
          apiKey: key,
          userId,
          deadline,
        }),
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
        deadline,
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
    const deadline = requestDeadline();
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
        deadline,
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
      deadline,
      key,
      userId: context.userId,
      month: data.month,
      cadence,
      coverage,
      home,
      profile,
      constraints,
    });

    // Se aplica sobre la versión más reciente de la fila (ticket 21): generar
    // tarda ~100 s y entretanto la persona puede fijar un plato, marcar la
    // compra o cambiar la cadencia.
    const validChildIds = home.children.map((c) => c.id);
    let final = null as { plan: MonthlyPlan; shopping: ShoppingList } | null;
    try {
      await updatePlanRowCas(
        context.supabase as never,
        context.userId,
        data.month,
        "plan, shopping",
        (row) => {
          const latest = cleanPlan(row.plan);
          if (!latest) return null;
          final = mergeRegeneratedPlan(
            { plan: latest, shopping: cleanShopping(row.shopping) },
            fresh,
            data.today,
            validChildIds,
            { coverage, cadence },
          );
          return {
            plan: final.plan,
            shopping: final.shopping,
            // La compra cambió → el mes deja de estar "cerrado del todo".
            // `confirmed_trips` se conserva (los tramos ya hechos siguen
            // marcados); `setTripConfirmed` recalcula el agregado la próxima vez.
            confirmed_at: null,
          };
        },
      );
    } catch (error) {
      console.error("reflowMonthlyPlan", error);
      throw new Error("No hemos podido actualizar el plan con los cambios");
    }
    if (!final) return { skipped: "no-plan" };
    const { plan: finalPlan, shopping: finalShopping } = final;

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

      // Se escribe sobre la versión más reciente de la fila (ticket 21):
      // `resolveDish` tarda y entretanto una recolocación puede haber escrito.
      // Lo de "antes" sale de esa misma versión, que es la que se sobrescribe.
      let next = current;
      let previousIdea = "";
      let previousPinned = false;
      try {
        await updatePlanRowCas(context.supabase as never, context.userId, month, "plan", (r) => {
          const latest = cleanPlan(r.plan);
          const cell = latest && planSlotIndex(latest, data.date);
          const written =
            latest && withPlanMeal(latest, data.date, data.slot, dish, { off, pin: data.pin });
          if (!latest || !cell || !written) {
            throw new ValidationError("Ese día todavía no tiene menú en el plan");
          }
          // Plato resuelto tal cual se veía en pantalla antes de este cambio
          // (con la rotación semanal ya aplicada para desayuno/snack si no había
          // un plato pedido a mano ese día), para que el caller pueda guardarlo
          // como "lo que había antes" — ver `wasIdea` en daily.ts.
          previousIdea =
            mealsForDate(latest, data.date).find((m) => m.slot === data.slot)?.idea ?? "";
          previousPinned = isPinned(latest.weeks[cell.weekIndex]?.days[cell.dayIndex], data.slot);
          next = written;
          return { plan: written };
        });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
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

      // Sobre la versión más reciente de la fila (ticket 21): `resolveDish`
      // tarda y entretanto otra escritura puede haber llegado.
      const meal = { childId: child.id, slot: data.slot, dish, off };
      let next = current;
      try {
        await updatePlanRowCas(context.supabase as never, context.userId, month, "plan", (r) => {
          const latest = cleanPlan(r.plan);
          const written = latest && withChildMeal(latest, data.date, meal);
          if (!written) throw new ValidationError("Ese día todavía no tiene menú en el plan");
          next = written;
          return written === latest ? null : { plan: written };
        });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
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
      const deadline = requestDeadline();
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
          deadline,
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

      // Se rellena sobre la versión más reciente de la fila (ticket 21): la IA
      // tarda y entretanto el planificador puede haber puesto un plato a mano,
      // que `onlyIfEmpty` respeta. Lo rellenado se cuenta en esa versión.
      let next = current;
      let filled = 0;
      const filledChildIds = new Set<string>();
      try {
        await updatePlanRowCas(context.supabase as never, context.userId, month, "plan", (r) => {
          const latest = cleanPlan(r.plan);
          if (!latest) return null;
          next = latest;
          filled = 0;
          filledChildIds.clear();
          for (const p of proposals) {
            const after = withChildMeal(next, p.date, p, { onlyIfEmpty: true });
            if (!after || after === next) continue;
            next = after;
            filled++;
            filledChildIds.add(p.childId);
          }
          return filled ? { plan: next } : null;
        });
      } catch (error) {
        console.error("fillChildMeals", error);
        throw new Error("No hemos podido guardar el menú de los peques");
      }

      if (filled) {
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
      const deadline = requestDeadline();
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
          deadline,
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
    const deadline = requestDeadline();
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
        deadline,
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
