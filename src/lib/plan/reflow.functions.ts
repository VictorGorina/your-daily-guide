import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { goalDirection } from "@/lib/goal";
import { requestDeadline } from "@/lib/deadline";
import { compensationNeed } from "@/lib/nutrition/compensation";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  cadenceOf,
  cleanPlan,
  cleanShopping,
  compensationWindow,
  diffFutureMeals,
  effectiveMealSlots,
  type MealChange,
  mealsForDate,
  mergeRegeneratedPlan,
  monthCoverage,
  type MonthlyPlan,
  type ShoppingCadence,
  type ShoppingList,
  weekdayName,
} from "@/lib/plan-shared";
import { UserFacingError, ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";
import { requireAiKey } from "@/lib/ai-provider.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { fetchMonthConstraints, generatePlanBody } from "./generate.server";
import { reflowMeals } from "./reflow.server";
import { ownPlanRow } from "./rows.server";

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
    const key = requireAiKey();

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
      const key = requireAiKey();

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(userId, "plan-adjust");

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      const profile = (profileRow ?? {}) as Record<string, unknown>;
      const goal = goalDirection(profile);

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
  /** Con `scope: "full"`: a cuántos miembros con la app se copiaron las comidas compartidas. */
  synced?: number;
};

/**
 * Recálculo del plan cuando cambia algo que lo invalida (issue 05). Nunca por
 * tiempo:
 *
 *  - `scope: "meals"` (cambió la despensa extra): automático y silencioso, lo
 *    dispara el cliente con un debounce. Recoloca los platos de los días futuros
 *    con `reflowMeals`. La lista de la compra NO se toca (la despensa extra
 *    nunca entra en la lista).
 *  - `scope: "full"` (entró o salió alguien de la mesa, cambió una ración,
 *    alergia o etapa): lo pide quien planifica con "Rehacer plan con la familia"
 *    (Familia). Regenera plan Y cantidades con el hogar nuevo y luego hace
 *    merge — hoy y el pasado se conservan, y las marcas "en casa"/"comprado"
 *    viajan por nombre de ingrediente a la lista nueva. Al acabar copia las
 *    comidas compartidas a quien tiene la app (`syncSharedMeals`); quien no la
 *    tiene solo cuenta como raciones y no hay nada que copiarle.
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
    const key = requireAiKey();

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
      throw new UserFacingError("No hemos podido actualizar el plan con los cambios");
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
      synced,
      plan: finalPlan,
      shopping: finalShopping,
      summary: synced
        ? `${finalPlan.intro} También he ajustado las comidas compartidas de tu hogar.`
        : finalPlan.intro,
    };
  });
