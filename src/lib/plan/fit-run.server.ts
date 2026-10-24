import type { DbClient } from "@/integrations/supabase/db-client";
import { requireAiKey } from "@/lib/ai-provider.server";
import { requestDeadline } from "@/lib/deadline";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  applyPlanFitChanges,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  type MonthlyPlan,
  type PlanFitMark,
} from "@/lib/plan-shared";
import { UserFacingError } from "@/lib/validation-error";
import { askPlanFit } from "./fit.server";
import { ownPlanRow } from "./rows.server";

/**
 * El trabajo de `fitMonthlyPlan`, fuera del `.handler()` (ticket 40 de la
 * auditoría). `data` llega ya validado; `ctx.userId` es siempre el del JWT.
 */
export async function runFitMonthlyPlan(
  ctx: { supabase: DbClient; userId: string },
  data: { month: string; today: string },
): Promise<{ fit: PlanFitMark | null }> {
  const deadline = requestDeadline();
  const key = requireAiKey();
  const supabase = ctx.supabase;

  const { data: row } = await ownPlanRow(
    supabase,
    ctx.userId,
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
  // Una ronda por plan: como generarlo, solo la mide el tope mensual.
  await enforceUserRateLimit(ctx.userId, "plan-fit", "month");

  const [{ data: profile }, household, { fitPlanMeals }] = await Promise.all([
    ctx.supabase.from("profiles").select("*").eq("id", ctx.userId).maybeSingle(),
    import("@/lib/household.server"),
    import("@/lib/nutrition/plan-fit.server"),
  ]);
  const home = await household.householdContext(supabase, ctx.userId);
  const shared = await household.sharedMealPortionsByDate(supabase, ctx.userId, home);
  const canTouchShared = !home.plannerId || home.plannerId === ctx.userId;

  const { report } = await fitPlanMeals({
    plan: current,
    month: data.month,
    after: data.today,
    profile,
    shared,
    canTouchShared,
    apiKey: key,
    userId: ctx.userId,
    deadline,
    ask: askPlanFit({
      key,
      userId: ctx.userId,
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
    await updatePlanRowCas(ctx.userId, data.month, "plan", (row) => {
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
    throw new UserFacingError("No hemos podido guardar el plan ajustado. Inténtalo otra vez.");
  }
  if (!fit) return { fit: existing };
  if (fit.changed.length && canTouchShared) {
    await household.syncSharedMeals({
      supabase: supabase,
      userId: ctx.userId,
      month: data.month,
      today: data.today,
    });
  }
  return { fit };
}
