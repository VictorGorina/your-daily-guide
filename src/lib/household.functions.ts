import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cleanHomeSchedule,
  cleanSharedSlots,
  isSharedSlot,
  type HomeSchedule,
  type SharedSlots,
} from "@/lib/household-shared";
import { zonedTodayISO } from "@/lib/zoned-date";
import { ValidationError } from "@/lib/validation-error";
import type { MealStatus } from "@/lib/daily";

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

/**
 * Propaga la corrección de un hábito (status + actual) del día `date` a todos
 * los miembros del hogar que comparten esa comida ese día de la semana.
 * Solo opera sobre días pasados y comidas compartidas.
 */
export const propagateLogToFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { date: string; habitLabel: string; status: MealStatus; actual?: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
      throw new ValidationError("Fecha no válida");
    if (!input.habitLabel?.trim()) throw new ValidationError("Falta el momento de la comida");
    if (!["plan", "distinto", "salteo"].includes(input.status))
      throw new ValidationError("Estado no válido");
    return {
      date: input.date,
      habitLabel: input.habitLabel.trim(),
      status: input.status as MealStatus,
      actual: input.actual?.trim() || undefined,
    };
  })
  .handler(async ({ data, context }): Promise<{ propagated: number }> => {
    const today = zonedTodayISO();
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
    let propagated = 0;

    for (const uid of others) {
      const { data: row } = await supabaseAdmin
        .from("daily_logs")
        .select("habits")
        .eq("user_id", uid)
        .eq("log_date", data.date)
        .maybeSingle();
      if (!row) continue;

      const habits =
        (row as { habits: { label: string; done: boolean; status?: string; actual?: string }[] })
          .habits ?? [];
      const idx = habits.findIndex((h) => h.label.toLowerCase() === data.habitLabel.toLowerCase());
      if (idx < 0) continue;

      const updated = [...habits];
      updated[idx] = {
        ...updated[idx],
        status: data.status,
        done: data.status === "plan" || data.status === "distinto",
        ...(data.status === "distinto" && data.actual ? { actual: data.actual } : {}),
        ...(data.status !== "distinto" ? { actual: undefined } : {}),
      };

      const { error } = await supabaseAdmin
        .from("daily_logs")
        .update({ habits: updated as never } as never)
        .eq("user_id", uid)
        .eq("log_date", data.date);
      if (!error) propagated++;
    }

    return { propagated };
  });

/**
 * Guarda el horario individual "¿cuándo como en casa?" de un miembro o de un
 * niño. Cada persona puede cambiar el suyo; el planificador puede cambiar el de
 * los niños o el de miembros sin cuenta.
 */
export const saveHomeSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      /** Id del hueco de la mesa cuyo horario se cambia (null = el del llamante). */
      memberId?: string | null;
      /** Id del niño cuyo horario se cambia (mutually exclusive con memberId). */
      childId?: string | null;
      schedule: unknown;
    }) => ({
      memberId: input?.memberId ?? null,
      childId: input?.childId ?? null,
      schedule: cleanHomeSchedule(input?.schedule),
    }),
  )
  .handler(async ({ data, context }): Promise<{ saved: boolean }> => {
    const { householdContext } = await import("@/lib/household.server");
    const ctx = await householdContext(context.supabase as never, context.userId);
    if (!ctx.householdId) throw new ValidationError("No estás en ningún hogar");

    const meInCtx = ctx.members.find((m) => m.userId === context.userId);
    const isPlanner = meInCtx?.isPlanner ?? false;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.childId) {
      // Solo el planificador puede cambiar el horario de los niños.
      if (!isPlanner)
        throw new ValidationError("Solo quien lleva la cocina puede cambiar el horario de un niño");
      const { error } = await supabaseAdmin
        .from("household_children")
        .update({ home_schedule: data.schedule as never } as never)
        .eq("id", data.childId);
      if (error) throw new Error("No hemos podido guardar el horario");
      return { saved: true };
    }

    if (data.memberId) {
      // Cambiar el horario de otro miembro: solo el planificador puede.
      const target = ctx.members.find(
        (m) => m.userId === null && ctx.members.some((mm) => mm.userId === context.userId),
      );
      // Más seguro: buscar por memberId directamente en la BD
      if (!isPlanner)
        throw new ValidationError(
          "Solo quien lleva la cocina puede cambiar el horario de otra persona",
        );
      const { error } = await supabaseAdmin
        .from("household_members")
        .update({ home_schedule: data.schedule as never } as never)
        .eq("id", data.memberId);
      if (error) throw new Error("No hemos podido guardar el horario");
      return { saved: true };
    }

    // Propio horario: siempre permitido.
    const { error } = await (context.supabase as never as typeof supabaseAdmin)
      .from("household_members")
      .update({ home_schedule: data.schedule as never } as never)
      .eq("user_id", context.userId);
    if (error) throw new Error("No hemos podido guardar el horario");
    return { saved: true };
  });
