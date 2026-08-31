import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cleanSharedMeals,
  describeShared,
  MEAL_KEYS,
  sharedDays,
  type SharedMeals,
} from "@/lib/household-shared";
import {
  cleanPlan,
  cleanShopping,
  planCursor,
  type MonthlyPlan,
  type ShoppingList,
} from "@/lib/plan-shared";

type AnyClient = SupabaseClient<never, never, never>;

export type HouseholdContext = {
  householdId: string | null;
  shared: SharedMeals;
  others: { userId: string; shared: SharedMeals }[];
  text: string;
};

/** Contexto del hogar (compañeros, comidas compartidas e hijos) para los prompts del coach. */
export async function householdContext(
  supabase: AnyClient,
  userId: string,
): Promise<HouseholdContext> {
  const empty: HouseholdContext = {
    householdId: null,
    shared: cleanSharedMeals(null),
    others: [],
    text: "Vive sin hogar compartido configurado.",
  };

  const { data: members } = await supabase
    .from("household_members")
    .select("household_id, user_id, role, shared_meals");
  const rows = (members ?? []) as {
    household_id: string;
    user_id: string;
    role: string;
    shared_meals: unknown;
  }[];
  const mine = rows.find((r) => r.user_id === userId);
  if (!mine) return empty;

  const shared = cleanSharedMeals(mine.shared_meals);
  const others = rows
    .filter((r) => r.user_id !== userId)
    .map((r) => ({ userId: r.user_id, shared: cleanSharedMeals(r.shared_meals) }));

  const { data: children } = await supabase
    .from("household_children")
    .select("name, age, allergies, appetite, notes")
    .eq("household_id", mine.household_id);
  const kids = (children ?? []) as {
    name: string;
    age: number | null;
    allergies: string | null;
    appetite: string | null;
    notes: string | null;
  }[];

  const sharedLines = others.map((o, i) => {
    const commons = MEAL_KEYS.map((m) => ({ m, days: sharedDays(shared, o.shared, m) })).filter(
      (x) => x.days.length,
    );
    return `- Convive con otro adulto (${i + 1}): comidas compartidas → ${
      commons.length
        ? commons.map((c) => `${c.m} los días ${c.days.join(",")}`).join("; ")
        : "ninguna"
    }`;
  });

  const kidLines = kids.map(
    (k) =>
      `- Hijo/a ${k.name}${k.age ? ` (${k.age} años)` : ""}: alergias ${k.allergies ?? "ninguna"}, apetito ${k.appetite ?? "normal"}${k.notes ? `, ${k.notes}` : ""}`,
  );

  return {
    householdId: mine.household_id,
    shared,
    others,
    text: [
      `Hogar: ${rows.length} adulto(s) y ${kids.length} niño(s).`,
      `Sus comidas compartidas configuradas → ${describeShared(shared)}.`,
      ...sharedLines,
      ...kidLines,
      kids.length
        ? "Las comidas en casa deben servir también para los niños: platos sencillos, sin sus alérgenos y con raciones adaptadas a su edad."
        : "",
      others.length
        ? "En las comidas compartidas los platos deben ser los mismos para las dos personas y los ingredientes salen de la misma compra."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Copia a los demás miembros del hogar los platos de las comidas que comparten
 * (solo días futuros: hoy y el pasado están fijados) y unifica la compra común.
 */
export async function syncSharedMeals(opts: {
  supabase: AnyClient;
  userId: string;
  month: string;
  today: string;
  plan: MonthlyPlan;
  shopping: ShoppingList;
}): Promise<{ synced: number }> {
  const ctx = await householdContext(opts.supabase, opts.userId);
  if (!ctx.householdId || !ctx.others.length) return { synced: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Al preparar el mes que viene por adelantado, `opts.today` cae en el mes
  // anterior: `planCursor` lo tomaría como semana 3-4 y dejaría medio mes sin
  // sincronizar. Un mes íntegramente futuro no tiene nada fijado, así que el
  // cursor arranca "antes de todo" para que se copie completo.
  const cursor =
    opts.month > opts.today.slice(0, 7)
      ? { weekIndex: -1, dayIndex: -1, dayName: "" }
      : planCursor(opts.today);
  let synced = 0;

  for (const other of ctx.others) {
    const commons = Object.fromEntries(
      MEAL_KEYS.map((m) => [m, sharedDays(ctx.shared, other.shared, m)]),
    ) as Record<string, number[]>;
    if (!MEAL_KEYS.some((m) => commons[m]?.length)) continue;

    const { data: row } = await supabaseAdmin
      .from("monthly_plans")
      .select("plan, shopping, confirmed_at")
      .eq("user_id", other.userId)
      .eq("month", opts.month)
      .maybeSingle();
    const target = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!target) continue;
    // Un plan ya confirmado tiene su compra cerrada: no lo tocamos.
    if ((row as { confirmed_at?: string | null } | null)?.confirmed_at) continue;

    const nextPlan: MonthlyPlan = {
      ...target,
      weeks: target.weeks.map((week, wi) => {
        if (wi < cursor.weekIndex) return week;
        const futureWeek = wi > cursor.weekIndex;
        const source = opts.plan.weeks[wi];
        if (!source) return week;
        return {
          ...week,
          breakfasts:
            futureWeek && commons.desayuno?.length && source.breakfasts.length
              ? source.breakfasts
              : week.breakfasts,
          days: week.days.map((day, di) => {
            if (!futureWeek && di <= cursor.dayIndex) return day;
            const sourceDay = source.days[di];
            if (!sourceDay) return day;
            // El spread conserva lo propio del otro miembro (desayuno o snack
            // que haya pedido para ese día); sólo se pisan las comidas que de
            // verdad comparten, arrastrando su aviso de "fuera de la compra".
            const copied = MEAL_KEYS.filter((m) => commons[m]?.includes(di));
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
            return next;
          }),
        };
      }),
    };

    // Compra: la parte compartida se unifica añadiendo lo que le falte al otro miembro.
    const targetShopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
    const merged: ShoppingList = targetShopping.map((g) => ({ ...g, items: [...g.items] }));
    for (const group of opts.shopping) {
      const existing = merged.find((g) => norm(g.category) === norm(group.category));
      const bucket = existing ?? { category: group.category, items: [] };
      if (!existing) merged.push(bucket);
      for (const item of group.items) {
        if (!bucket.items.some((i) => norm(i.name) === norm(item.name))) bucket.items.push(item);
      }
    }

    const { error } = await supabaseAdmin
      .from("monthly_plans")
      .update({ plan: nextPlan as never, shopping: merged as never } as never)
      .eq("user_id", other.userId)
      .eq("month", opts.month);
    if (error) console.error("syncSharedMeals", error);
    else synced += 1;
  }

  return { synced };
}
