import type { DbClient } from "@/integrations/supabase/db-client";
import { requireAiKey } from "@/lib/ai-provider.server";
import { requestDeadline } from "@/lib/deadline";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  cadenceOf,
  cleanPlan,
  cleanShopping,
  mergeRegeneratedPlan,
  monthCoverage,
  type MonthlyPlan,
  type ShoppingCadence,
  type ShoppingList,
} from "@/lib/plan-shared";
import { UserFacingError } from "@/lib/validation-error";
import { fetchMonthConstraints, generatePlanBody } from "./generate.server";
import { reflowMeals } from "./reflow.server";
import { ownPlanRow } from "./rows.server";

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
 * El trabajo de `reflowMonthlyPlan`, fuera del `.handler()` (ticket 40 de la
 * auditoría). `data` llega ya validado; `ctx.userId` es siempre el del JWT.
 */
export async function runReflowMonthlyPlan(
  ctx: { supabase: DbClient; userId: string },
  data: { month: string; today: string; scope: "meals" | "full" },
): Promise<ReflowResult> {
  const deadline = requestDeadline();
  const key = requireAiKey();

  // Un mes pasado no se recalcula: no se puede cumplir y gastaría tokens.
  if (data.month < data.today.slice(0, 7)) return { skipped: "past" };

  const { householdPlannerId, householdContext } = await import("@/lib/household.server");
  const plannerId = await householdPlannerId(ctx.supabase, ctx.userId);
  if (plannerId && plannerId !== ctx.userId) return { skipped: "not-planner" };

  const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
  await enforceUserRateLimit(ctx.userId, "plan-reflow");

  const { data: row } = await ownPlanRow(ctx.supabase, ctx.userId, data.month, "plan, shopping");
  const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
  if (!current) return { skipped: "no-plan" };

  if (data.scope === "meals") {
    const { plan, summary } = await reflowMeals({
      supabase: ctx.supabase,
      userId: ctx.userId,
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
    ctx.supabase.from("profiles").select("*").eq("id", ctx.userId).maybeSingle(),
    householdContext(ctx.supabase, ctx.userId),
    fetchMonthConstraints(ctx.supabase, ctx.userId, data.month),
  ]);
  const currentShopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
  const cadence: ShoppingCadence = current.cadence ?? cadenceOf(currentShopping);
  const coverage = current.coverage ?? monthCoverage(data.month, data.today);

  const { householdMealTargets } = await import("@/lib/household.server");
  const sharedTargets = await householdMealTargets(ctx.supabase, ctx.userId, home);
  const fresh = await generatePlanBody({
    sharedTargets,
    deadline,
    key,
    userId: ctx.userId,
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
    await updatePlanRowCas(ctx.userId, data.month, "plan, shopping", (row) => {
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
    });
  } catch (error) {
    console.error("reflowMonthlyPlan", error);
    throw new UserFacingError("No hemos podido actualizar el plan con los cambios");
  }
  if (!final) return { skipped: "no-plan" };
  const { plan: finalPlan, shopping: finalShopping } = final;

  const { synced } = await syncSharedMeals({
    supabase: ctx.supabase,
    userId: ctx.userId,
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
}
