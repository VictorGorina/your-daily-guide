import type { DbClient } from "@/integrations/supabase/db-client";
import { requireAiKey } from "@/lib/ai-provider.server";
import { requestDeadline } from "@/lib/deadline";
import {
  monthCoverage,
  type MonthlyPlan,
  monthTitle,
  type ShoppingCadence,
  type ShoppingList,
} from "@/lib/plan-shared";
import { UserFacingError, ValidationError } from "@/lib/validation-error";
import { fetchMonthConstraints, generatePlanBody } from "./generate.server";
import { ownPlanRow } from "./rows.server";

/** Un mes se genera una sola vez (`generateMonthlyPlan`). */
function alreadyPlanned(month: string): ValidationError {
  const title = monthTitle(month);
  return new ValidationError(
    `${title.charAt(0).toUpperCase()}${title.slice(1)} ya tiene su plan. Si cambia tu hogar se recalcula solo.`,
  );
}

/**
 * El trabajo de `generateMonthlyPlan`, fuera del `.handler()` (ticket 40 de la
 * auditoría): así lo puede ejecutar también quien no es una petición de la
 * persona. `data` llega ya validado; `ctx.userId` es siempre el del JWT.
 */
export async function runGenerateMonthlyPlan(
  ctx: { supabase: DbClient; userId: string },
  data: { month: string; cadence: ShoppingCadence; today: string },
): Promise<{ plan: MonthlyPlan; shopping: ShoppingList; firstPlan: boolean }> {
  const deadline = requestDeadline();
  const key = requireAiKey();

  // Un mes se genera UNA vez: rehacerlo a mano no es un camino (gasta IA y
  // pierde los cambios de la persona). Lo que sí cambia el plan después —el
  // hogar, la despensa— lo recoloca `reflowMonthlyPlan` sin pasar por aquí, y
  // lo que la persona tenga que contar del mes se pregunta ANTES de generar
  // (`MonthIntakeChat`). Va antes de la cuota: un rechazo no la gasta.
  const { data: existing } = await ownPlanRow(ctx.supabase, ctx.userId, data.month, "id");
  if (existing) {
    throw alreadyPlanned(data.month);
  }

  // ¿Es el primer plan de la persona? Entonces el cliente pide además la
  // bienvenida del coach (`welcomeBriefing`). Se mira aquí y no por
  // `app_started_on`: quien se da de alta el día 28 puede preparar primero
  // el mes que viene, y un perfil demo trae ese campo en el pasado.
  const { count: earlierPlans } = await ctx.supabase
    .from("monthly_plans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId);

  const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
  await enforceUserRateLimit(ctx.userId, "plan-generate");

  const [{ data: profile }, constraints] = await Promise.all([
    ctx.supabase.from("profiles").select("*").eq("id", ctx.userId).maybeSingle(),
    fetchMonthConstraints(ctx.supabase, ctx.userId, data.month),
  ]);

  const { householdContext, householdMealTargets, syncSharedMeals } =
    await import("@/lib/household.server");
  const home = await householdContext(ctx.supabase, ctx.userId);
  const sharedTargets = await householdMealTargets(ctx.supabase, ctx.userId, home);

  const { plan, shopping } = await generatePlanBody({
    sharedTargets,
    deadline,
    key,
    userId: ctx.userId,
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
  // Con `supabaseAdmin` (ticket 39): `plan` y `shopping` no se escriben con
  // la sesión de la persona. `user_id` es el del JWT.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("monthly_plans").insert({
    user_id: ctx.userId,
    month: data.month,
    plan,
    shopping,
    confirmed_at: null,
  });
  if ((error as { code?: string } | null)?.code === "23505") {
    throw alreadyPlanned(data.month);
  }
  if (error) {
    console.error("saveMonthlyPlan", error);
    throw new UserFacingError("No hemos podido guardar el plan del mes. Inténtalo otra vez.");
  }

  await syncSharedMeals({
    supabase: ctx.supabase,
    userId: ctx.userId,
    month: data.month,
    today: data.today,
  });

  return { plan, shopping, firstPlan: !earlierPlans };
}
