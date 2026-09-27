import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";
import { requireAiKey } from "@/lib/ai-provider.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { askPlanFit } from "./fit.server";
import { ownPlanRow } from "./rows.server";

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
    const key = requireAiKey();
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
