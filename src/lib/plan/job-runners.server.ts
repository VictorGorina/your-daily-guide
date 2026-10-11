import type { DbClient } from "@/integrations/supabase/db-client";
import type { JobResults } from "@/lib/jobs";
import type { JobRunners } from "@/lib/jobs-run.server";
import { runFitMonthlyPlan } from "./fit-run.server";
import { runGenerateMonthlyPlan } from "./generate-run.server";
import { runReflowMonthlyPlan } from "./reflow-run.server";

/**
 * Los trabajos de la cola (ticket 40 de la auditoría): los mismos cuerpos que
 * ejecuta cada server function, pero sin petición de la persona detrás.
 *
 * No hay sesión, así que leen con `supabaseAdmin` y RLS no hace de red: la
 * frontera es el `userId`, que sale de la fila de `jobs` (lo puso el servidor
 * al encolar, con el del JWT). Todas las lecturas de los tres cuerpos filtran
 * por él (`ownPlanRow`, `profiles`, `household.server.ts`…).
 */

const adminCtx = async (userId: string): Promise<{ supabase: DbClient; userId: string }> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { supabase: supabaseAdmin, userId };
};

/**
 * Generar, o dar por bueno el plan que ya hay. Un intento que murió DESPUÉS de
 * guardar deja el mes con su plan: el relevo choca con «ya tiene su plan», que
 * para la persona no es un fallo sino justo lo que pidió. Lo mismo si otra
 * generación (una build sin cola) llegó antes.
 */
export async function generateOrExisting(
  run: () => Promise<{ firstPlan: boolean }>,
  plannedMonths: () => Promise<string[]>,
  month: string,
): Promise<JobResults["plan_generate"]> {
  try {
    return { firstPlan: (await run()).firstPlan };
  } catch (error) {
    const months = await plannedMonths().catch((): string[] => []);
    if (!months.includes(month)) throw error;
    return { firstPlan: months.length === 1 };
  }
}

/** Los meses que tienen plan en la fila PROPIA de la persona. */
export async function plannedMonthsOf(supabase: DbClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("monthly_plans")
    .select("month")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.month);
}

export const planJobRunners: JobRunners = {
  async plan_generate(userId, input) {
    const ctx = await adminCtx(userId);
    return generateOrExisting(
      () => runGenerateMonthlyPlan(ctx, input),
      () => plannedMonthsOf(ctx.supabase, userId),
      input.month,
    );
  },

  // Sin `plan` ni `shopping`: la pantalla relee el plan al terminar.
  async plan_reflow(userId, input) {
    const out = await runReflowMonthlyPlan(await adminCtx(userId), input);
    return {
      ...(out.skipped ? { skipped: out.skipped } : {}),
      ...(out.scope ? { scope: out.scope } : {}),
      ...(out.summary ? { summary: out.summary } : {}),
      ...(out.synced != null ? { synced: out.synced } : {}),
    };
  },

  async plan_fit(userId, input) {
    const { fit } = await runFitMonthlyPlan(await adminCtx(userId), input);
    return { fit };
  },
};
