import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cleanPlan, cleanShopping } from "@/lib/plan-shared";

/**
 * Propaga a los demás miembros del hogar los platos de las comidas compartidas
 * del mes indicado. Solo cambia los días posteriores a hoy.
 */
export const syncHouseholdPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; today?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
    return {
      month: input.month,
      today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "")
        ? input.today!
        : new Date().toISOString().slice(0, 10),
    };
  })
  .handler(async ({ data, context }): Promise<{ synced: number }> => {
    const { data: row } = await context.supabase
      .from("monthly_plans")
      .select("plan, shopping")
      .eq("user_id", context.userId)
      .eq("month", data.month)
      .maybeSingle();
    const plan = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!plan) return { synced: 0 };

    const { syncSharedMeals } = await import("@/lib/household.server");
    return syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today: data.today,
      plan,
      shopping: cleanShopping((row as { shopping?: unknown } | null)?.shopping),
    });
  });
