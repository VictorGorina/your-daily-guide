import { isSharedSlot, type SharedSlots } from "@/lib/household-shared";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  assertShoppingStateColumns,
  type MealSlot,
  type MonthlyPlan,
  type PlanDay,
  sharedSlotWriteBlocked,
} from "@/lib/plan-shared";
import { ValidationError } from "@/lib/validation-error";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lee la fila `monthly_plans` PROPIA del que llama para un mes. Se filtra por
 * `user_id` siempre: desde issue 05 hay una policy de SELECT en `monthly_plans`
 * que también deja a un miembro del hogar leer la fila del planificador, así que
 * un `.maybeSingle()` filtrado solo por `month` devolvería 2 filas (y un error
 * PGRST116) cuando lo llama un no planificador. Toda escritura de estas server
 * functions ya usa el mismo filtro `.eq("user_id", context.userId)`; esto lo
 * hace también en la lectura previa.
 */
export function ownPlanRow(
  supabase: SupabaseClient<never, never, never>,
  userId: string,
  month: string,
  columns: string,
) {
  return supabase
    .from("monthly_plans")
    .select(columns)
    .eq("month", month)
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * Fila `monthly_plans` sobre la que se escribe el ESTADO de compra: marcas
 * "lo tengo en casa"/"comprado", gasto real, tiquets, despensa extra y cierre
 * de tramos. En un hogar esa lista vive en la fila del planificador y cualquier
 * miembro con cuenta puede tocar su estado (issue 06) — nunca los platos ni las
 * cantidades.
 *
 *  - Sin hogar, o si quien llama ES el planificador → su propia fila
 *    (`isMine: true`), lectura y escritura con el cliente de sesión.
 *  - Miembro no planificador → la fila del planificador (`isMine: false`); RLS
 *    solo deja LEER esa fila (policy de issue 05), así que las lecturas y
 *    escrituras van con `supabaseAdmin` y limitadas a columnas de estado.
 *
 * La membresía queda verificada por `householdPlannerId`: solo devuelve un id
 * no nulo cuando quien llama es miembro del mismo hogar. Es una sola consulta,
 * mucho más ligera que `householdContext`, porque este camino se recorre en
 * cada marca de "lo tengo en casa".
 */
export async function resolveShoppingRow(
  supabase: unknown,
  userId: string,
): Promise<{ targetUserId: string; isMine: boolean }> {
  const { householdPlannerId } = await import("@/lib/household.server");
  const plannerId = await householdPlannerId(supabase as never, userId);
  if (!plannerId || plannerId === userId) {
    return { targetUserId: userId, isMine: true };
  }
  return { targetUserId: plannerId, isMine: false };
}

/** Lee la fila objetivo del estado de compra (propia con el cliente de sesión;
 *  la del planificador con `supabaseAdmin`, ver `resolveShoppingRow`). */
export async function readShoppingRow<T>(
  supabase: unknown,
  target: { targetUserId: string; isMine: boolean },
  month: string,
  columns: string,
): Promise<T | null> {
  if (target.isMine) {
    const { data } = await ownPlanRow(supabase as never, target.targetUserId, month, columns);
    return (data as T | null) ?? null;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("monthly_plans")
    .select(columns)
    .eq("user_id", target.targetUserId)
    .eq("month", month)
    .maybeSingle();
  return (data as T | null) ?? null;
}

/**
 * Cambia el estado de compra de la fila objetivo sobre su versión más reciente
 * (ticket 21): dos toques seguidos, o dos miembros del hogar a la vez, se
 * reconstruyen uno sobre otro en vez de pisarse. `rebuild` recibe las
 * `columns` leídas y devuelve el `patch` (o `null` para no escribir).
 *
 * El `patch` nunca incluye `plan` ni `weekQty`: un no planificador jamás toca
 * los platos ni las cantidades de la lista de la casa (issue 06). Devuelve
 * `latest: null` si el mes no tiene fila.
 */
export async function updateShoppingState<Row extends Record<string, unknown>>(
  supabase: unknown,
  target: { targetUserId: string; isMine: boolean },
  month: string,
  columns: string,
  rebuild: (latest: Row) => Record<string, unknown> | null,
): Promise<{ latest: Row | null; patch: Record<string, unknown> | null }> {
  // La fila de otra persona se lee y escribe con `supabaseAdmin` (RLS solo le
  // deja leerla): ver `resolveShoppingRow`.
  const client = target.isMine
    ? (supabase as SupabaseClient<never, never, never>)
    : ((await import("@/integrations/supabase/client.server"))
        .supabaseAdmin as unknown as SupabaseClient<never, never, never>);
  const { latest, patch } = await updatePlanRowCas(
    client,
    target.targetUserId,
    month,
    columns,
    (row) => {
      const next = rebuild(row as unknown as Row);
      // Barandilla, no comentario: cuando la fila es de otra persona esto
      // escribe con `supabaseAdmin`, que se salta RLS. Se comprueba aquí en vez
      // de confiar en que cada sitio que llama respete la lista.
      if (next) assertShoppingStateColumns(next);
      return next;
    },
  );
  return { latest: latest as Row | null, patch };
}

/**
 * Si esa comida de ese día es compartida y quien llama NO es quien planifica
 * en casa, el cambio no es suyo que hacer (D2). `date` decide el día de la
 * semana; si no hay hogar o la comida no se comparte, no hay nada que impedir.
 */
export async function guardSharedSlotWrite(
  supabase: unknown,
  userId: string,
  date: string,
  slot: MealSlot,
): Promise<void> {
  if (slot === "snack") return;
  const { householdContext } = await import("@/lib/household.server");
  const home = await householdContext(supabase as never, userId);
  const blocked = sharedSlotWriteBlocked(home, userId, date, slot);
  if (blocked) throw new ValidationError(blocked);
}

/**
 * Vacía en un plan las comidas que ese día son compartidas del hogar. Lo usa
 * el modo "solo mis comidas" de un no planificador: su fila `monthly_plans`
 * no debe guardar el plato de una comida de la casa (lo pone el espejo /
 * la composición en lectura). El desayuno se comparte "todo o nada" a nivel
 * de rotación semanal, igual que en `syncSharedMeals` / `composeDayForUser`.
 */
export function blankSharedSlots(plan: MonthlyPlan, sharedSlots: SharedSlots): MonthlyPlan {
  const desayunoShared = sharedSlots.desayuno.length > 0;
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      breakfasts: desayunoShared ? [] : week.breakfasts,
      days: week.days.map((day, di) => {
        const next: PlanDay = { ...day };
        if (isSharedSlot(sharedSlots, "comida", di)) next.lunch = "";
        if (isSharedSlot(sharedSlots, "cena", di)) next.dinner = "";
        if (desayunoShared) delete next.breakfast;
        // Los platos aparte de un niño (issue 07) los lleva el planificador:
        // la fila de un no planificador solo conserva los de un slot que ese
        // día no sea compartido (raro), el resto los pone el espejo.
        const kids = (next.kids ?? []).filter(
          (k) => k.slot !== "snack" && !isSharedSlot(sharedSlots, k.slot, di),
        );
        if (kids.length) next.kids = kids;
        else delete next.kids;
        return next;
      }),
    })),
  };
}

/**
 * Vacía en un plan las comidas de un slot que la persona no eligió planificar
 * (`effectiveMealSlots`, slots elegidos para el plan). Es el cinturón, no el único freno: el
 * prompt ya le pide a la IA que no rellene esos slots, pero un modelo no
 * siempre obedece al pie de la letra, así que esto lo garantiza pase lo que
 * pase. `mealsForDate` (plan-shared.ts) es el otro cinturón, en el lado de
 * lectura: aunque quedara contenido aquí por lo que sea, ese filtro de
 * pantalla tampoco lo enseñaría.
 */
export function blankUnselectedSlots(
  plan: MonthlyPlan,
  selected: readonly MealSlot[],
): MonthlyPlan {
  const wants = new Set(selected);
  const keep = (slot: MealSlot) => wants.has(slot);
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      breakfasts: keep("desayuno") ? week.breakfasts : [],
      snacks: keep("snack") ? week.snacks : [],
      days: week.days.map((day) => {
        const next: PlanDay = { ...day };
        if (!keep("desayuno")) delete next.breakfast;
        if (!keep("comida")) next.lunch = "";
        if (!keep("cena")) next.dinner = "";
        if (!keep("snack")) delete next.snack;
        // El plato aparte de un niño (issue 07) tampoco tiene sentido en un
        // slot que la persona ni planifica para sí misma.
        const kids = (next.kids ?? []).filter((k) => keep(k.slot));
        if (kids.length) next.kids = kids;
        else delete next.kids;
        return next;
      }),
    })),
  };
}
