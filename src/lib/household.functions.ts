import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cleanSharedSlots, type SharedSlots } from "@/lib/household-shared";
import { zonedTodayISO } from "@/lib/zoned-date";
import { ValidationError } from "@/lib/validation-error";

/**
 * Guarda la configuración única de comidas compartidas del hogar
 * (`households.shared_slots`). Solo la puede cambiar el planificador: la RLS deja
 * escribir la fila del hogar a cualquier miembro (es el objetivo común), así que
 * el candado `is_planner` va aquí, en el servidor.
 */
export const saveSharedSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { slots: unknown }) => ({ slots: cleanSharedSlots(input?.slots) }))
  .handler(async ({ data, context }): Promise<{ shared_slots: SharedSlots }> => {
    const { data: members } = await context.supabase
      .from("household_members")
      .select("household_id, user_id, is_planner");
    const rows = (members ?? []) as {
      household_id: string;
      user_id: string | null;
      is_planner: boolean;
    }[];
    const mine = rows.find((r) => r.user_id === context.userId);
    if (!mine) throw new ValidationError("No estás en ningún hogar");
    if (!mine.is_planner) {
      throw new ValidationError(
        "Solo quien lleva la cocina en casa puede cambiar las comidas compartidas",
      );
    }

    const { error } = await context.supabase
      .from("households")
      .update({ shared_slots: data.slots as never } as never)
      .eq("id", mine.household_id);
    if (error) {
      console.error("saveSharedSlots", error);
      throw new Error("No hemos podido guardar las comidas compartidas");
    }
    return { shared_slots: data.slots };
  });

/**
 * Propaga a los demás miembros del hogar los platos de las comidas compartidas
 * del mes indicado, tomando como fuente la fila del planificador. Solo cambia los
 * días posteriores a hoy.
 */
export const syncHouseholdPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; today?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    return {
      month: input.month,
      // `today` lo pasa el cliente ya en su zona horaria (ver `todayISO` en
      // daily.ts); el fallback a Madrid solo cubre llamadas sin ese dato.
      today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO(),
    };
  })
  .handler(async ({ data, context }): Promise<{ synced: number }> => {
    const { syncSharedMeals } = await import("@/lib/household.server");
    return syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today: data.today,
    });
  });
