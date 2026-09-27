import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_MODEL,
  coachSystemPrompt,
  createAiProvider,
  currencySymbol,
} from "@/lib/ai-provider.server";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import { requestDeadline } from "@/lib/deadline";
import { showsNutritionNumbers } from "@/lib/macros";
import { cleanIntakeText, type IntakeAnswers, monthIntakeNotes } from "@/lib/month-intake";
import { compensationNeed } from "@/lib/nutrition/compensation";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  applyPlanFitChanges,
  cadenceOf,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  ingredientNames,
  isNextMonthUnlocked,
  type MealChange,
  mealsForDate,
  mergeRegeneratedPlan,
  type MonthConstraints,
  monthCoverage,
  type MonthlyPlan,
  monthTitle,
  nextMonthISO,
  type PlanFitMark,
  type ShoppingCadence,
  type ShoppingList,
  shoppingTotal,
  weekdayName,
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
import { ownPlanRow } from "./plan/rows.server";

export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";
export { toggleShoppingOwnedHandler } from "./shopping/state.server";
export * from "./shopping/state.functions";
export { _generatePlanBodyForEval } from "./plan/generate.server";
export { _fitPlanForEval } from "./plan/fit.server";
export { reflowMeals } from "./plan/reflow.server";
export * from "./plan/dishes.functions";

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
