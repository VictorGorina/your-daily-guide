import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCleanFood } from "@/lib/assert-clean-food";
import type { MealStatus } from "@/lib/daily";
import { cleanHomeSchedule, scheduleTarget } from "@/lib/household-shared";
import { UserFacingError, ValidationError } from "@/lib/validation-error";
import { clampClientToday } from "@/lib/zoned-date";
import { createServerFn } from "@tanstack/react-start";
import { propagateLogToFamilyHandler } from "./household-propagate.server";

/** El "comí otra cosa" que se propaga a la mesa: opcional, pero si viene tiene que ser comida. */
function cleanSharedActual(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  assertCleanFood(value);
  return value;
}

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
      today: clampClientToday(input?.today),
    };
  })
  .handler(async ({ data, context }): Promise<{ synced: number }> => {
    const { syncSharedMeals } = await import("@/lib/household.server");
    return syncSharedMeals({
      supabase: context.supabase,
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
  .validator(
    (input: {
      date: string;
      habitLabel: string;
      status: MealStatus;
      actual?: string;
      /** "hoy" según el reloj del dispositivo — el servidor corre en UTC/Madrid. */
      today?: string;
    }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
        throw new ValidationError("Fecha no válida");
      if (!input.habitLabel?.trim()) throw new ValidationError("Falta el momento de la comida");
      if (!["plan", "distinto", "salteo"].includes(input.status))
        throw new ValidationError("Estado no válido");
      return {
        date: input.date,
        habitLabel: input.habitLabel.trim(),
        status: input.status as MealStatus,
        // Lo que de verdad comió se propaga al resto del hogar: lo ven otros.
        actual: cleanSharedActual(input.actual),
        today: clampClientToday(input?.today),
      };
    },
  )
  .handler(propagateLogToFamilyHandler);

/**
 * Guarda el horario individual "¿cuándo como en casa?" de un miembro o de un
 * niño. Cada persona puede cambiar el suyo; el planificador puede cambiar el de
 * los niños o el de miembros sin cuenta.
 */
export const saveHomeSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      /** Id del hueco de la mesa cuyo horario se cambia (null o el propio = el del llamante). */
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
    const ctx = await householdContext(context.supabase, context.userId);
    if (!ctx.householdId) throw new ValidationError("No estás en ningún hogar");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = context.supabase;

    // `householdContext` no trae el `id` de cada fila; la propia solo hace falta
    // para reconocer "mi memberId" (una persona tiene como mucho una fila).
    let ownMemberId: string | null = null;
    if (data.memberId) {
      const { data: own } = await session
        .from("household_members")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      ownMemberId = (own as { id: string } | null)?.id ?? null;
    }

    const meInCtx = ctx.members.find((m) => m.userId === context.userId);
    const target = scheduleTarget({
      memberId: data.memberId,
      childId: data.childId,
      isPlanner: meInCtx?.isPlanner ?? false,
      ownMemberId,
    });

    // `supabaseAdmin` se salta la RLS: el hogar y el "sin cuenta" van en el filtro,
    // o bastaría conocer un UUID ajeno para cambiarle el horario a otra casa.
    if (target.kind === "child") {
      const { data: rows, error } = await supabaseAdmin
        .from("household_children")
        .update({ home_schedule: data.schedule })
        .eq("id", target.childId)
        .eq("household_id", ctx.householdId)
        .select("id");
      if (error) throw new UserFacingError("No hemos podido guardar el horario");
      if (!rows?.length) throw new ValidationError("Ese peque no es de tu casa");
      return { saved: true };
    }

    if (target.kind === "member") {
      const { data: rows, error } = await supabaseAdmin
        .from("household_members")
        .update({ home_schedule: data.schedule })
        .eq("id", target.memberId)
        .eq("household_id", ctx.householdId)
        .is("user_id", null)
        .select("id");
      if (error) throw new UserFacingError("No hemos podido guardar el horario");
      if (!rows?.length) {
        throw new ValidationError(
          "Solo puedes cambiar el horario de alguien de tu casa que no use la app",
        );
      }
      return { saved: true };
    }

    // Propio horario: siempre permitido.
    const { error } = await session
      .from("household_members")
      .update({ home_schedule: data.schedule })
      .eq("user_id", context.userId);
    if (error) throw new UserFacingError("No hemos podido guardar el horario");
    return { saved: true };
  });
