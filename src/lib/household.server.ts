import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cleanSharedSlots,
  describeRoster,
  describeServings,
  describeSharedSlots,
  MEAL_KEYS,
  servingsPerSlot,
  type ServingsTable,
  type SharedSlots,
} from "@/lib/household-shared";
import { cleanPlan, planCursor, type MonthlyPlan } from "@/lib/plan-shared";

type AnyClient = SupabaseClient<never, never, never>;

/** Un miembro de la mesa, lo mínimo que necesitan los prompts y el espejo del plan. */
export type HouseholdMemberLite = {
  userId: string | null;
  displayName: string;
  isPlanner: boolean;
  usesApp: boolean;
  portion: number;
};

/** Un niño de la casa, lo mínimo para generar su plato aparte (issue 07). */
export type HouseholdChildLite = {
  id: string;
  name: string;
  age: number | null;
  allergies: string | null;
  portion: number;
};

export type HouseholdContext = {
  householdId: string | null;
  /** `user_id` del planificador: su plan y su compra son los del hogar. */
  plannerId: string | null;
  /** Configuración única de comidas compartidas del hogar. */
  sharedSlots: SharedSlots;
  members: HouseholdMemberLite[];
  /** Niños de la casa, para el plato aparte cuando el compartido no les vale. */
  children: HouseholdChildLite[];
  /** Raciones que piden las comidas compartidas y las del planificador en solitario. */
  servings: ServingsTable;
  text: string;
};

const emptyContext = (): HouseholdContext => ({
  householdId: null,
  plannerId: null,
  sharedSlots: cleanSharedSlots(null),
  members: [],
  children: [],
  servings: { shared: { desayuno: 0, comida: 0, cena: 0 }, plannerSolo: 1 },
  text: "Vive sin hogar compartido configurado.",
});

/**
 * Solo el `user_id` del planificador del hogar de `userId` — o `null` si no
 * está en un hogar, o su hogar no tiene un planificador con cuenta. Una única
 * consulta a `household_members` (RLS acota a su propio hogar), sin el resto del
 * contexto: para caminos que solo necesitan resolver "¿de quién es la fila del
 * plan?", como el estado de compra compartido (issue 06). La pertenencia queda
 * verificada igual que en `householdContext`: solo devuelve un id no nulo
 * cuando `userId` aparece como miembro de ese hogar.
 */
export async function householdPlannerId(
  supabase: AnyClient,
  userId: string,
): Promise<string | null> {
  const { data: rawMembers } = await supabase
    .from("household_members")
    .select("household_id, user_id, is_planner");
  const rows = (rawMembers ?? []) as {
    household_id: string;
    user_id: string | null;
    is_planner: boolean;
  }[];
  const mine = rows.find((r) => r.user_id === userId);
  if (!mine) return null;
  const planner = rows.find((r) => r.household_id === mine.household_id && r.is_planner);
  return planner?.user_id ?? null;
}

/** Contexto del hogar (mesa, comidas compartidas e hijos) para los prompts del coach. */
export async function householdContext(
  supabase: AnyClient,
  userId: string,
): Promise<HouseholdContext> {
  const { data: rawMembers } = await supabase
    .from("household_members")
    .select("household_id, user_id, display_name, uses_app, is_planner, portion");
  const rows = (rawMembers ?? []) as {
    household_id: string;
    user_id: string | null;
    display_name: string;
    uses_app: boolean;
    is_planner: boolean;
    portion: number | string;
  }[];
  const mine = rows.find((r) => r.user_id === userId);
  if (!mine) return emptyContext();

  const householdMembers = rows.filter((r) => r.household_id === mine.household_id);
  const members: HouseholdMemberLite[] = householdMembers.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    isPlanner: r.is_planner,
    usesApp: r.uses_app,
    portion: Number(r.portion) || 1,
  }));
  const planner = members.find((m) => m.isPlanner) ?? null;

  const { data: household } = await supabase
    .from("households")
    .select("shared_slots")
    .eq("id", mine.household_id)
    .maybeSingle();
  const sharedSlots = cleanSharedSlots(
    (household as { shared_slots?: unknown } | null)?.shared_slots,
  );

  const { data: children } = await supabase
    .from("household_children")
    .select("id, name, age, allergies, appetite, notes, portion")
    .eq("household_id", mine.household_id);
  const kids = (children ?? []) as {
    id: string;
    name: string;
    age: number | null;
    allergies: string | null;
    appetite: string | null;
    notes: string | null;
    portion: number | string;
  }[];

  // Notas libres de un niño ("no le gusta el pescado", "come poco a mediodía"):
  // no caben en el roster pero sí le sirven al coach. Edad y alergias ya van
  // en `describeRoster`.
  const kidNotes = kids
    .filter((k) => k.notes?.trim())
    .map((k) => `- ${k.name}: ${k.notes!.trim()}`);

  const servings = servingsPerSlot(
    members,
    kids.map((k) => ({ portion: Number(k.portion) || 0.5 })),
    sharedSlots,
  );

  const plannerName = planner?.displayName ?? "quien lleva la cocina";
  const anyShared = MEAL_KEYS.some((m) => sharedSlots[m].length);

  return {
    householdId: mine.household_id,
    plannerId: planner?.userId ?? null,
    sharedSlots,
    members,
    children: kids.map((k) => ({
      id: k.id,
      name: k.name,
      age: k.age,
      allergies: k.allergies,
      portion: Number(k.portion) || 0.5,
    })),
    servings,
    text: [
      describeRoster(
        members.map((m) => ({
          displayName: m.displayName,
          hasAccount: !!m.userId,
          isPlanner: m.isPlanner,
        })),
        kids.map((k) => ({ name: k.name, age: k.age, allergies: k.allergies })),
      ),
      `Comidas compartidas del hogar → ${describeSharedSlots(sharedSlots)}.`,
      anyShared
        ? `En una comida compartida el plato es EXACTAMENTE EL MISMO para toda la mesa y solo lo cambia ${plannerName}. Que alguien coma una ración distinta o se salte una comida es privado y no cambia el plato de los demás. Si un niño necesita otro plato un día, va aparte en "days[].kids"; el plato compartido no se toca.`
        : "",
      ...kidNotes,
      kids.length
        ? "Las comidas de casa deben servir también a los niños: platos sencillos, sin sus alérgenos y con raciones adaptadas a su edad."
        : "",
      anyShared
        ? `Raciones exactas por comida compartida → ${describeServings(servings, sharedSlots)}. Las comidas en solitario (snack y días sin compartir) piden ${servings.plannerSolo} ración(es).`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Propaga a los demás miembros del hogar los platos de las comidas compartidas
 * (`households.shared_slots`), tomando SIEMPRE como fuente la fila del
 * planificador. Solo toca los días futuros (hoy y el pasado están fijados) y solo
 * el plato — la lista de la compra compartida es la del planificador y se lee
 * aparte, no se copia.
 */
export async function syncSharedMeals(opts: {
  supabase: AnyClient;
  /** Quien dispara la sincronización (puede ser o no el planificador). */
  userId: string;
  month: string;
  today: string;
}): Promise<{ synced: number }> {
  const ctx = await householdContext(opts.supabase, opts.userId);
  if (!ctx.householdId || !ctx.plannerId) return { synced: 0 };

  const sharedMeals = MEAL_KEYS.filter((m) => ctx.sharedSlots[m].length);
  if (!sharedMeals.length) return { synced: 0 };

  const targets = ctx.members.filter((m) => m.userId && m.userId !== ctx.plannerId);
  if (!targets.length) return { synced: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: plannerRow } = await supabaseAdmin
    .from("monthly_plans")
    .select("plan")
    .eq("user_id", ctx.plannerId)
    .eq("month", opts.month)
    .maybeSingle();
  const source = cleanPlan((plannerRow as { plan?: unknown } | null)?.plan);
  if (!source) return { synced: 0 };

  // Al preparar el mes que viene por adelantado, `opts.today` cae en el mes
  // anterior: `planCursor` lo tomaría como semana 3-4 y dejaría medio mes sin
  // sincronizar. Un mes íntegramente futuro no tiene nada fijado, así que el
  // cursor arranca "antes de todo" para que se copie completo.
  const cursor =
    opts.month > opts.today.slice(0, 7)
      ? { weekIndex: -1, dayIndex: -1, dayName: "" }
      : planCursor(opts.today);

  let synced = 0;
  for (const target of targets) {
    const { data: row } = await supabaseAdmin
      .from("monthly_plans")
      .select("plan, confirmed_at")
      .eq("user_id", target.userId!)
      .eq("month", opts.month)
      .maybeSingle();
    const targetPlan = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!targetPlan) continue;
    // Un plan ya confirmado tiene su compra cerrada: no lo tocamos.
    if ((row as { confirmed_at?: string | null } | null)?.confirmed_at) continue;

    const nextPlan: MonthlyPlan = {
      ...targetPlan,
      weeks: targetPlan.weeks.map((week, wi) => {
        if (wi < cursor.weekIndex) return week;
        const futureWeek = wi > cursor.weekIndex;
        const sourceWeek = source.weeks[wi];
        if (!sourceWeek) return week;
        return {
          ...week,
          breakfasts:
            futureWeek && ctx.sharedSlots.desayuno.length && sourceWeek.breakfasts.length
              ? sourceWeek.breakfasts
              : week.breakfasts,
          days: week.days.map((day, di) => {
            if (!futureWeek && di <= cursor.dayIndex) return day;
            const sourceDay = sourceWeek.days[di];
            if (!sourceDay) return day;
            // Solo se pisan las comidas que ese día son compartidas del hogar;
            // el spread conserva lo propio del otro miembro (su snack, o su
            // desayuno los días que el desayuno no es compartido).
            const copied = sharedMeals.filter((m) => ctx.sharedSlots[m].includes(di));
            const copiedSet = new Set<string>(copied);
            const extras = { ...(day.extras ?? {}) };
            for (const meal of copied) {
              const mark = sourceDay.extras?.[meal];
              if (mark?.length) extras[meal] = mark;
              else delete extras[meal];
            }
            const next = {
              ...day,
              lunch: copied.includes("comida") ? sourceDay.lunch || day.lunch : day.lunch,
              dinner: copied.includes("cena") ? sourceDay.dinner || day.dinner : day.dinner,
              ...(copied.includes("desayuno") && sourceDay.breakfast
                ? { breakfast: sourceDay.breakfast }
                : {}),
            };
            if (Object.keys(extras).length) next.extras = extras;
            else delete next.extras;
            // El plato aparte de un niño (issue 07) viaja con su comida
            // compartida: se copia el del planificador para un slot compartido
            // y se conserva lo propio del otro miembro para el resto.
            const kids = [
              ...(day.kids ?? []).filter((k) => !copiedSet.has(k.slot)),
              ...(sourceDay.kids ?? []).filter((k) => copiedSet.has(k.slot)),
            ];
            if (kids.length) next.kids = kids;
            else delete next.kids;
            return next;
          }),
        };
      }),
    };

    const { error } = await supabaseAdmin
      .from("monthly_plans")
      .update({ plan: nextPlan as never } as never)
      .eq("user_id", target.userId!)
      .eq("month", opts.month);
    if (error) console.error("syncSharedMeals", error);
    else synced += 1;
  }

  return { synced };
}
