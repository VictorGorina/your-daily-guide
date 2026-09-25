/**
 * Con qué ración se sirve cada comida del plan de un día (ticket 08 de
 * `precision-nutricional`, adelantado para el 10): lo que necesita
 * `plannedMacros` para escalar el plato al objetivo de su comida.
 *
 * - Comida propia: la ración personal (`portionFactors().plan`) y el objetivo de
 *   esa comida (`energyTargets().perSlot`) más lo que la compensación de otro día
 *   le haya movido (`PlanDay.kcalAdjust`).
 * - Comida compartida del hogar (D4): la ración y el objetivo medios de los
 *   adultos que la comen (`sharedMealPortions`), iguales para todos. El ajuste
 *   propio no cuenta: la compensación nunca toca una compartida.
 *
 * `resolveServing` es puro; `plannedServingsFor` lee lo que haga falta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { sharedMealPortions, type SharedServing } from "@/lib/household.server";
import { cleanPlan, planDayOf, type PlanDay } from "@/lib/plan-shared";

import { energyTargets, type EnergyTargets } from "./energy";
import { portionFactors, type PortionFactors } from "./portion";
import type { PlannedServing } from "./scale";
import { recipeSlotOfMoment } from "./validate-recipe";

type MealKey = "desayuno" | "comida" | "cena";
type PerSlotKey = MealKey | "snack";

export type ServingContext = {
  own: Pick<PortionFactors, "plan" | "habitual">;
  energy:
    | (Pick<EnergyTargets, "perSlot" | "kcal"> & { basis: Pick<EnergyTargets["basis"], "tdee"> })
    | null;
  shared: Partial<Record<MealKey, SharedServing>>;
  kcalAdjust: PlanDay["kcalAdjust"] | null | undefined;
};

export type ResolvedServing = { serving: PlannedServing; shared: boolean };

const perSlotKey = (moment: string | null | undefined): PerSlotKey | null => {
  const slot = recipeSlotOfMoment(moment);
  return slot === "merienda" ? "snack" : slot === "distinto" ? null : slot;
};

/** La ración de un plato del plan en la comida de `moment` ("Comida", "Merienda"…). */
export function resolveServing(
  moment: string | null | undefined,
  ctx: ServingContext,
): ResolvedServing {
  const slot = perSlotKey(moment);
  const shared = slot && slot !== "snack" ? ctx.shared[slot] : undefined;
  if (shared) return { serving: { base: shared.factor, target: shared.target }, shared: true };

  const target = slot ? ctx.energy?.perSlot[slot] : undefined;
  const adjust = slot ? (ctx.kcalAdjust?.[slot] ?? 0) : 0;
  return {
    serving: {
      base: ctx.own.plan,
      target: target
        ? { kcal: Math.max(0, target.kcal + adjust), protein_g: target.protein_g }
        : null,
    },
    shared: false,
  };
}

/**
 * La ración de un plato COMIDO fuera del plan en esa comida ("comí distinto",
 * `eatenMacros`): la habitual (mantenimiento ÷ 2.000) y el objetivo de la
 * comida a mantenimiento, con el mismo reparto del día. Siempre la propia: lo
 * que uno se come no es la ración del hogar, ni lleva el ajuste de otro día.
 */
export function resolveEatenServing(
  moment: string | null | undefined,
  ctx: ServingContext,
): PlannedServing {
  const slot = perSlotKey(moment);
  const target = slot ? ctx.energy?.perSlot[slot] : undefined;
  const toMaintenance = ctx.energy?.kcal ? ctx.energy.basis.tdee / ctx.energy.kcal : 1;
  return {
    base: ctx.own.habitual,
    target: target
      ? { kcal: Math.round(target.kcal * toMaintenance), protein_g: target.protein_g }
      : null,
  };
}

type AnyClient = SupabaseClient<never, never, never>;

/**
 * Lo que hace falta para `resolveServing` en la fecha `date`. `planDay` se lee
 * de la fila propia si no se pasa (el ajuste de la compensación vive ahí).
 * Nada de esto falla hacia fuera: sin hogar o sin plan, la ración propia.
 */
export async function plannedServingsFor(opts: {
  supabase: AnyClient;
  userId: string;
  profile: unknown;
  date: string;
  planDay?: PlanDay | null;
}): Promise<{
  planned: (moment: string | null | undefined) => ResolvedServing;
  eaten: (moment: string | null | undefined) => PlannedServing;
}> {
  const energy = energyTargets(opts.profile as never);
  const own = portionFactors(energy, opts.profile as { sex?: string | null } | null);

  const [shared, planDay] = await Promise.all([
    sharedMealPortions(opts.supabase, opts.userId, opts.date).catch((error) => {
      console.error("sharedMealPortions", error);
      return {};
    }),
    opts.planDay !== undefined
      ? Promise.resolve(opts.planDay)
      : readPlanDay(opts.supabase, opts.userId, opts.date).catch((error) => {
          console.error("plannedServingsFor: plan", error);
          return null;
        }),
  ]);

  const ctx: ServingContext = { own, energy, shared, kcalAdjust: planDay?.kcalAdjust };
  return {
    planned: (moment) => resolveServing(moment, ctx),
    eaten: (moment) => resolveEatenServing(moment, ctx),
  };
}

async function readPlanDay(
  supabase: AnyClient,
  userId: string,
  date: string,
): Promise<PlanDay | null> {
  // Fila propia siempre (`.eq("user_id")`): la policy de SELECT deja ver también
  // la del planificador y un `.maybeSingle()` sin filtro daría PGRST116.
  const { data, error } = await supabase
    .from("monthly_plans")
    .select("plan")
    .eq("month", date.slice(0, 7))
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return planDayOf(cleanPlan((data as { plan?: unknown } | null)?.plan), date);
}
