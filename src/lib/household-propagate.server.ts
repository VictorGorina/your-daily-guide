import type { MealStatus } from "@/lib/daily";
import { isSharedSlot } from "@/lib/household-shared";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";

type PropagatedHabit = { label: string; done: boolean; status?: string; actual?: string };

/** Cuerpo de `propagateLogToFamily`, aparte para poder probarlo (ticket 21). */
export async function propagateLogToFamilyHandler({
  data,
  context,
}: {
  data: { date: string; habitLabel: string; status: MealStatus; actual?: string; today?: string };
  context: { supabase: unknown; userId: string };
}): Promise<{ propagated: number }> {
  // Preferimos el "hoy" del cliente (su zona horaria); si no llega, la del
  // servidor (Europe/Madrid), que puede ir un día por delante para México/EE.UU.
  const today = data.today ?? zonedTodayISO();
  if (data.date >= today) throw new ValidationError("Solo se pueden corregir días pasados");

  const { householdContext } = await import("@/lib/household.server");
  const ctx = await householdContext(context.supabase as never, context.userId);
  if (!ctx.householdId) throw new ValidationError("No estás en ningún hogar");

  // Verificar que la comida es compartida ese día de la semana.
  // Mapear label a MealKey: "Comida"→"comida", "Cena"→"cena", etc.
  const labelToKey: Record<string, string> = {
    desayuno: "desayuno",
    comida: "comida",
    cena: "cena",
  };
  const mealKey = labelToKey[data.habitLabel.toLowerCase()];
  if (!mealKey) {
    // Los snacks nunca se propagan (decisión D5).
    return { propagated: 0 };
  }

  const weekday = (new Date(`${data.date}T00:00:00`).getDay() + 6) % 7;
  if (!isSharedSlot(ctx.sharedSlots, mealKey as "desayuno" | "comida" | "cena", weekday)) {
    return { propagated: 0 };
  }

  // Obtener los user_ids de los otros miembros con cuenta.
  const others = ctx.members
    .filter((m) => m.userId && m.userId !== context.userId)
    .map((m) => m.userId!);
  if (!others.length) return { propagated: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { patchDailyHabits } = await import("@/lib/daily-rows.server");
  const label = data.habitLabel.toLowerCase();
  let propagated = 0;

  for (const uid of others) {
    // Sobre la versión más reciente del día de ese miembro (ticket 21): lo
    // que él mismo esté cambiando a la vez no se pisa.
    try {
      const next = await patchDailyHabits<PropagatedHabit>(
        supabaseAdmin as never,
        uid,
        data.date,
        (habits) => {
          const idx = habits.findIndex((h) => h.label.toLowerCase() === label);
          if (idx < 0) return null;
          const updated = [...habits];
          updated[idx] = {
            ...updated[idx],
            status: data.status,
            done: data.status === "plan" || data.status === "distinto",
            ...(data.status === "distinto" && data.actual ? { actual: data.actual } : {}),
            ...(data.status !== "distinto" ? { actual: undefined } : {}),
          };
          return updated;
        },
      );
      if (next) propagated++;
    } catch (error) {
      console.error("propagateLogToFamily", error);
    }
  }

  return { propagated };
}
