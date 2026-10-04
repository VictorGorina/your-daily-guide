import { asPromptData } from "@/lib/prompt-data";
import type { DbClient } from "@/integrations/supabase/db-client";

import { weekdayIndex } from "@/lib/dates";
import { effectiveSharedSlots } from "@/lib/effective-shared-slots";
import { updatePlanRowCas } from "@/lib/plan-rows.server";

import {
  cleanFeedingStage,
  cleanHomeSchedule,
  cleanSharedSlots,
  DAY_LABEL,
  describeRoster,
  describeServings,
  describeSharedSlots,
  eatsTableFood,
  EMPTY_SCHEDULE,
  type FeedingStage,
  MEAL_KEYS,
  MEAL_LABEL,
  servingsForMealDay,
  servingsPerSlot,
  type HomeSchedule,
  type ServingsTable,
  type SharedSlots,
} from "@/lib/household-shared";
import {
  cleanPlan,
  cleanSharedPlan,
  isPlanCellAhead,
  isPlanWeekAhead,
  mirrorPinned,
  type MonthlyPlan,
} from "@/lib/plan-shared";

type AnyClient = DbClient;

/** Un miembro de la mesa, lo mínimo que necesitan los prompts y el espejo del plan. */
export type HouseholdMemberLite = {
  userId: string | null;
  displayName: string;
  isPlanner: boolean;
  usesApp: boolean;
  portion: number;
  homeSchedule: HomeSchedule | null;
};

/** Un niño de la casa, lo mínimo para generar su plato aparte (issue 07). */
export type HouseholdChildLite = {
  id: string;
  name: string;
  age: number | null;
  allergies: string | null;
  /** `mesa` = come del plato de la familia; `triturados`/`pecho` = bebé aparte. */
  stage: FeedingStage;
  portion: number;
  homeSchedule: HomeSchedule | null;
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

export const emptyContext = (): HouseholdContext => ({
  householdId: null,
  plannerId: null,
  sharedSlots: cleanSharedSlots(null),
  members: [],
  children: [],
  servings: { shared: { desayuno: 0, comida: 0, cena: 0 }, plannerSolo: 1 },
  text: "Vive sin hogar compartido configurado.",
});

/**
 * El hogar de `userId`, o `null` si no está en ninguno. Lee solo su fila
 * (`user_id` es único en `household_members`): leer la tabla entera y buscar en
 * memoria hacía que la RLS evaluase `is_household_member` fila a fila sobre
 * todos los hogares, y con la clave de servicio traía los de toda la app
 * (ticket 17, PERF-05).
 */
async function ownHouseholdId(supabase: AnyClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { household_id: string } | null)?.household_id ?? null;
}

/**
 * Solo el `user_id` del planificador del hogar de `userId` — o `null` si no
 * está en un hogar, o su hogar no tiene un planificador con cuenta. Sin el resto
 * del contexto: para caminos que solo necesitan resolver "¿de quién es la fila
 * del plan?", como el estado de compra compartido (issue 06). La pertenencia
 * queda verificada igual que en `householdContext`: solo devuelve un id no nulo
 * cuando `userId` aparece como miembro de ese hogar.
 */
export async function householdPlannerId(
  supabase: AnyClient,
  userId: string,
): Promise<string | null> {
  const householdId = await ownHouseholdId(supabase, userId);
  if (!householdId) return null;
  const { data: rawMembers } = await supabase
    .from("household_members")
    .select("user_id, is_planner")
    .eq("household_id", householdId);
  const rows = (rawMembers ?? []) as { user_id: string | null; is_planner: boolean }[];
  return rows.find((r) => r.is_planner)?.user_id ?? null;
}

/**
 * Lee una tabla del hogar añadiendo columnas que puede que aún no existan en la
 * BD si su migración no se ha aplicado (`home_schedule` → `20260905120000`,
 * `feeding_stage` → `20260906150000`). PostgREST devuelve un 400 si falta
 * cualquiera; en ese caso se reintenta quitándolas una a una hasta que la
 * consulta pasa, y las filas siguen sin ese campo. Sin este reintento el error
 * se tragaba en silencio y `householdContext` devolvía un contexto vacío para
 * TODO usuario del hogar (coach sin familia, plan en solitario, espejo parado).
 */
async function selectWithOptionalColumns(
  supabase: AnyClient,
  table: "household_members" | "household_children",
  baseColumns: string,
  optionalColumns: string[],
  householdId: string,
): Promise<Record<string, unknown>[] | null> {
  const run = (columns: string[]) =>
    supabase.from(table).select(columns.join(", ")).eq("household_id", householdId);
  // De más a menos columnas opcionales, quitando desde el final: la más nueva
  // (`feeding_stage`) es la más probable que falte, así que se conserva
  // `home_schedule` mientras se pueda. [a,b] → [a] → [].
  let last: Awaited<ReturnType<typeof run>> | null = null;
  for (let k = optionalColumns.length; k >= 0; k -= 1) {
    last = await run([baseColumns, ...optionalColumns.slice(0, k)]);
    if (!last.error) return (last.data ?? null) as unknown as Record<string, unknown>[] | null;
  }
  return (last?.data ?? null) as unknown as Record<string, unknown>[] | null;
}

/** Contexto del hogar (mesa, comidas compartidas e hijos) para los prompts del coach. */
export async function householdContext(
  supabase: AnyClient,
  userId: string,
): Promise<HouseholdContext> {
  const householdId = await ownHouseholdId(supabase, userId);
  if (!householdId) return emptyContext();

  const rawMembers = await selectWithOptionalColumns(
    supabase,
    "household_members",
    "user_id, display_name, uses_app, is_planner, portion",
    ["home_schedule"],
    householdId,
  );
  const rows = (rawMembers ?? []) as {
    user_id: string | null;
    display_name: string;
    uses_app: boolean;
    is_planner: boolean;
    portion: number | string;
    home_schedule: unknown;
  }[];
  // Si la lectura del hogar falla entera, lo de siempre: sin contexto.
  if (!rows.some((r) => r.user_id === userId)) return emptyContext();

  const members: HouseholdMemberLite[] = rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    isPlanner: r.is_planner,
    usesApp: r.uses_app,
    portion: Number(r.portion) || 1,
    homeSchedule: r.home_schedule ? cleanHomeSchedule(r.home_schedule) : null,
  }));
  const planner = members.find((m) => m.isPlanner) ?? null;

  // Leemos el `shared_slots` heredado del hogar como fallback para hogares que
  // aún no tienen `home_schedule` por miembro. Si hay horarios individuales,
  // `deriveSharedSlots` los sustituye.
  // Las dos lecturas solo dependen del hogar: en paralelo (ticket 17, PERF-10).
  const [{ data: household }, children] = await Promise.all([
    supabase.from("households").select("shared_slots").eq("id", householdId).maybeSingle(),
    selectWithOptionalColumns(
      supabase,
      "household_children",
      "id, name, age, allergies, appetite, notes, portion",
      ["home_schedule", "feeding_stage"],
      householdId,
    ),
  ]);
  const legacySharedSlots = cleanSharedSlots(
    (household as { shared_slots?: unknown } | null)?.shared_slots,
  );
  const kids = (children ?? []) as {
    id: string;
    name: string;
    age: number | null;
    allergies: string | null;
    appetite: string | null;
    notes: string | null;
    feeding_stage: unknown;
    portion: number | string;
    home_schedule: unknown;
  }[];

  // Notas libres de un niño ("no le gusta el pescado", "come poco a mediodía"):
  // no caben en el roster pero sí le sirven al coach. Edad y alergias ya van
  // en `describeRoster`.
  const kidNotes = kids
    .filter((k) => k.notes?.trim())
    .map((k) => `- ${asPromptData(k.name)}: ${asPromptData(k.notes)}`);

  const kidsLite: HouseholdChildLite[] = kids.map((k) => ({
    id: k.id,
    name: k.name,
    age: k.age,
    allergies: k.allergies,
    stage: cleanFeedingStage(k.feeding_stage),
    portion: Number(k.portion) || 0.5,
    homeSchedule: k.home_schedule ? cleanHomeSchedule(k.home_schedule) : null,
  }));

  // Qué se comparte: la regla única de `effectiveSharedSlots` (la misma que usan
  // las pantallas). Va ANTES de rellenar los horarios de abajo: necesita saber
  // quién no tenía horario propio.
  const sharedSlots = effectiveSharedSlots(legacySharedSlots, members, kidsLite);
  const hasAnySchedule =
    members.some((m) => m.homeSchedule != null) || kidsLite.some((c) => c.homeSchedule != null);

  // Quien no ha configurado su horario NO está "nunca en casa": hereda los días
  // compartidos del hogar (`households.shared_slots`). Las raciones y el resto
  // de este contexto lo necesitan ya resuelto.
  const resolveSchedule = (s: HomeSchedule | null): HomeSchedule => s ?? legacySharedSlots;
  for (const m of members) m.homeSchedule = resolveSchedule(m.homeSchedule);
  for (const c of kidsLite) c.homeSchedule = resolveSchedule(c.homeSchedule);

  const servings = servingsPerSlot(
    members,
    kidsLite.map((k) => ({ portion: k.portion, stage: k.stage })),
    sharedSlots,
  );

  const plannerName = asPromptData(planner?.displayName) || "quien lleva la cocina";
  const anyShared = MEAL_KEYS.some((m) => sharedSlots[m].length);
  const tableKids = kidsLite.filter((k) => eatsTableFood(k.stage));
  const infantKids = kidsLite.filter((k) => !eatsTableFood(k.stage));

  // Raciones por comida y día de la semana, para el prompt del coach —
  // más detallado que el antiguo "Comida: 3 raciones" fijo.
  const perDayServingsText = hasAnySchedule ? describePerDayServings(members, kidsLite) : "";

  return {
    householdId,
    plannerId: planner?.userId ?? null,
    sharedSlots,
    members,
    children: kidsLite,
    servings,
    text: [
      describeRoster(
        members.map((m) => ({
          displayName: m.displayName,
          hasAccount: !!m.userId,
          isPlanner: m.isPlanner,
        })),
        kids.map((k) => ({
          name: k.name,
          age: k.age,
          allergies: k.allergies,
          stage: cleanFeedingStage(k.feeding_stage),
        })),
      ),
      `Comidas compartidas del hogar → ${describeSharedSlots(sharedSlots)}.`,
      anyShared
        ? `En una comida compartida el plato es EXACTAMENTE EL MISMO para toda la mesa y solo lo cambia ${plannerName}. Que alguien coma una ración distinta o se salte una comida es privado y no cambia el plato de los demás. Si un niño necesita otro plato un día, va aparte en "days[].kids"; el plato compartido no se toca.`
        : "",
      ...kidNotes,
      tableKids.length
        ? "Las comidas de casa deben servir también a los niños que comen del plato: platos sencillos, sin sus alérgenos y con raciones adaptadas a su edad."
        : "",
      infantKids.length
        ? `Bebés que AÚN NO comen del plato de la mesa: ${infantKids
            .map((k) =>
              k.stage === "pecho"
                ? `${asPromptData(k.name)} (toma pecho o biberón, no necesita plato ni entra en la compra)`
                : `${asPromptData(k.name)} (triturados: lleva SIEMPRE su propio plato en "days[].kids" cada día que come en casa — puré/triturado sencillo sin sal, con sus ingredientes sumados al "weekQty" a ración de bebé)`,
            )
            .join("; ")}. La mesa NO se dimensiona para ellos.`
        : "",
      perDayServingsText ||
        (anyShared
          ? `Raciones exactas por comida compartida → ${describeServings(servings, sharedSlots)}. Las comidas en solitario (snack y días sin compartir) piden ${servings.plannerSolo} ración(es).`
          : ""),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Genera una descripción detallada de las raciones por comida y día de la
 * semana a partir de los horarios individuales: "Lunes comida: 2.5 raciones
 * (Víctor 1.0 + Ana 1.0 + Lucía 0.5)".
 */
function describePerDayServings(
  members: HouseholdMemberLite[],
  children: HouseholdChildLite[],
): string {
  const lines: string[] = [];
  for (let day = 0; day <= 6; day++) {
    for (const meal of MEAL_KEYS) {
      const portions = servingsForMealDay(
        members.map((m) => ({ portion: m.portion, homeSchedule: m.homeSchedule })),
        children.map((c) => ({ portion: c.portion, homeSchedule: c.homeSchedule, stage: c.stage })),
        meal,
        day,
      );
      if (portions <= 0) continue;
      // Detalle de quién está en casa (los bebés no comen del plato: fuera).
      const presentMembers = members.filter((m) =>
        (m.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(day),
      );
      const presentKids = children.filter(
        (c) => eatsTableFood(c.stage) && (c.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(day),
      );
      const names = [
        ...presentMembers.map((m) => `${asPromptData(m.displayName)} ${m.portion}`),
        ...presentKids.map((c) => `${asPromptData(c.name)} ${c.portion}`),
      ].join(" + ");
      lines.push(`${DAY_LABEL[day]} ${MEAL_LABEL[meal]}: ${portions} raciones (${names})`);
    }
  }
  if (!lines.length) return "";
  const plannerPortion = members.find((m) => m.isPlanner)?.portion ?? 1;
  return [
    "Raciones por día y comida:",
    ...lines,
    `Comidas en solitario (snack y días sin compartir): ${plannerPortion} ración(es).`,
  ].join("\n");
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
  const plannerPlan = cleanPlan((plannerRow as { plan?: unknown } | null)?.plan);
  if (!plannerPlan) return { synced: 0 };
  const source = cleanSharedPlan(plannerPlan);

  // Qué celdas se reescriben lo decide la fecha real de cada una
  // (`isPlanCellAhead` / `isPlanWeekAhead`), no su posición en la fila: la
  // rejilla no va en orden de calendario y, con un cursor por posición, un lunes
  // 7 pisaba los días 1-6 (ya pasados) y un miércoles 2 se saltaba el lunes 7.
  // Un mes íntegramente futuro se copia completo.
  let synced = 0;
  for (const target of targets) {
    const mirror = (targetPlan: MonthlyPlan): MonthlyPlan => ({
      ...targetPlan,
      weeks: targetPlan.weeks.map((week, wi) => {
        const sourceWeek = source.weeks[wi];
        if (!sourceWeek) return week;
        const weekAhead = isPlanWeekAhead(opts.month, wi, opts.today);
        return {
          ...week,
          breakfasts:
            weekAhead && ctx.sharedSlots.desayuno.length && sourceWeek.breakfasts.length
              ? sourceWeek.breakfasts
              : week.breakfasts,
          days: week.days.map((day, di) => {
            if (!isPlanCellAhead(opts.month, wi, di, opts.today)) return day;
            const sourceDay = sourceWeek.days[di];
            if (!sourceDay) return day;
            // Solo se pisan las comidas que ese día son compartidas del hogar Y
            // el miembro destino tiene ese día en su horario personal; si el
            // destino come fuera aunque el planificador esté en casa, no se copia.
            const targetSched = target.homeSchedule;
            const copied = sharedMeals.filter(
              (m) =>
                ctx.sharedSlots[m].includes(di) && (!targetSched || targetSched[m].includes(di)),
            );
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
            // La marca de "elegido a mano" viaja igual que el plato de un niño.
            const pinned = mirrorPinned(day, sourceDay, copiedSet);
            if (pinned) next.pinned = pinned;
            else delete next.pinned;
            return next;
          }),
        };
      }),
    });

    // Sobre la versión más reciente de la fila de ese miembro (ticket 21): sus
    // comidas propias pueden cambiar a la vez y no se deben pisar.
    try {
      const { patch } = await updatePlanRowCas(
        supabaseAdmin,
        target.userId!,
        opts.month,
        "plan, confirmed_at",
        (row) => {
          const targetPlan = cleanPlan(row.plan);
          // Un plan ya confirmado tiene su compra cerrada: no lo tocamos.
          if (!targetPlan || row.confirmed_at) return null;
          return { plan: mirror(targetPlan) };
        },
      );
      if (patch) synced += 1;
    } catch (error) {
      console.error("syncSharedMeals", error);
    }
  }

  return { synced };
}

/**
 * Factor de ración de las comidas COMPARTIDAS de un día (ticket 21 de
 * `precision-nutricional`, D4): la media del factor `plan` de los adultos con
 * cuenta que esa comida comen en casa. El mismo número para todos.
 *
 * Privacidad: lee el perfil de otros miembros con la clave de servicio, en el
 * servidor, y solo sale de aquí la media por comida — nunca el objetivo, el
 * peso ni el factor de nadie. Quien lo llama no debe guardarla junto a la
 * comida en ningún sitio que llegue al cliente (ver `guide.functions.ts`).
 *
 * Con el factor va el objetivo medio de esa comida (kcal y proteína de
 * `perSlot`, de los que tienen objetivo): los platos del plan se escalan a él
 * (`plannedMacros`), la misma ración para todos. `null` si ninguno tiene objetivo.
 *
 * Vacío si no hay hogar o ese día no se comparte nada.
 */
export async function sharedMealPortions(
  supabase: AnyClient,
  userId: string,
  date: string,
): Promise<Partial<Record<(typeof MEAL_KEYS)[number], SharedServing>>> {
  return (await sharedMealPortionsByDate(supabase, userId))(date);
}

/**
 * `sharedMealPortions` para cualquier fecha, con UNA lectura del hogar y de los
 * perfiles: las comidas compartidas dependen solo del día de la semana. Para
 * recorrer un mes entero (`fitMonthlyPlan`). Con `home` (el `householdContext`
 * que el handler ya leyó) no se vuelve a leer el hogar.
 */
export async function sharedMealPortionsByDate(
  supabase: AnyClient,
  userId: string,
  known?: HouseholdContext,
): Promise<(date: string) => Partial<Record<(typeof MEAL_KEYS)[number], SharedServing>>> {
  const none = () => ({});
  const home = known ?? (await householdContext(supabase, userId));
  if (!home.householdId) return none;
  const eatersOn = (weekday: number) => {
    const eaters = new Map<(typeof MEAL_KEYS)[number], string[]>();
    for (const meal of MEAL_KEYS) {
      if (!home.sharedSlots[meal].includes(weekday)) continue;
      const ids = home.members
        .filter((mb) => mb.userId && mb.usesApp)
        .filter((mb) => (mb.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday))
        .map((mb) => mb.userId!);
      if (ids.length) eaters.set(meal, ids);
    }
    return eaters;
  };
  const week = Array.from({ length: 7 }, (_, weekday) => eatersOn(weekday));
  const ids = [...new Set(week.flatMap((eaters) => [...eaters.values()].flat()))];
  if (!ids.length) return none;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { ENERGY_PROFILE_COLUMNS, energyTargets } = await import("@/lib/nutrition/energy");
  // Perfiles de otras personas: solo lo que pide su objetivo, no su salud.
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(["id", ...ENERGY_PROFILE_COLUMNS].join(","))
    .in("id", ids);
  if (error) {
    console.error("sharedMealPortions", error);
    return none;
  }
  const { portionFactors, sharedPortion } = await import("@/lib/nutrition/portion");
  const planById = new Map<string, number>();
  const targetsById = new Map<string, ReturnType<typeof energyTargets>>();
  for (const p of (data ?? []) as unknown as { id: string; sex?: string | null }[]) {
    const targets = energyTargets(p as never);
    targetsById.set(p.id, targets);
    planById.set(p.id, portionFactors(targets, p).plan);
  }
  const byWeekday = week.map((eaters) => {
    const out: Partial<Record<(typeof MEAL_KEYS)[number], SharedServing>> = {};
    for (const [meal, mealIds] of eaters) {
      const factor = sharedPortion(mealIds.map((id) => planById.get(id) ?? NaN));
      if (factor == null) continue;
      const slots = mealIds.map((id) => targetsById.get(id)?.perSlot[meal]).filter((s) => !!s);
      out[meal] = {
        factor,
        target: slots.length
          ? {
              kcal: Math.round(slots.reduce((sum, s) => sum + s!.kcal, 0) / slots.length),
              protein_g: Math.round(slots.reduce((sum, s) => sum + s!.protein_g, 0) / slots.length),
            }
          : null,
      };
    }
    return out;
  });
  return (date) => {
    return byWeekday[weekdayIndex(date)] ?? {}; // 0 = lunes
  };
}

/** La ración de una comida compartida (ver `sharedMealPortions`). */
export type SharedServing = {
  factor: number;
  target: { kcal: number; protein_g: number } | null;
};

/**
 * Objetivo por comida de las comidas compartidas del hogar, para el prompt del
 * plan (ticket 23 de `precision-nutricional`): la media de los adultos con cuenta,
 * sin nombres ni cifras individuales (D4 e invariante 8). Solo las comidas que
 * se comparten algún día. Vacío sin hogar o sin datos. Con `home` (el
 * `householdContext` que el handler ya leyó) no se vuelve a leer el hogar.
 */
export async function householdMealTargets(
  supabase: AnyClient,
  userId: string,
  known?: HouseholdContext,
): Promise<Partial<Record<(typeof MEAL_KEYS)[number], { kcal: number; protein_g: number }>>> {
  const home = known ?? (await householdContext(supabase, userId));
  if (!home.householdId) return {};
  const ids = home.members.filter((m) => m.userId && m.usesApp).map((m) => m.userId!);
  if (ids.length < 2) return {};
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { ENERGY_PROFILE_COLUMNS, energyTargets } = await import("@/lib/nutrition/energy");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(ENERGY_PROFILE_COLUMNS.join(","))
    .in("id", ids);
  if (error) {
    console.error("householdMealTargets", error);
    return {};
  }
  const all = (data ?? []).map((p) => energyTargets(p as never)).filter((t) => !!t);
  const out: Partial<Record<(typeof MEAL_KEYS)[number], { kcal: number; protein_g: number }>> = {};
  for (const meal of MEAL_KEYS) {
    if (!home.sharedSlots[meal].length) continue;
    const slots = all.map((t) => t!.perSlot[meal]).filter((s) => !!s);
    if (!slots.length) continue;
    out[meal] = {
      kcal: Math.round(slots.reduce((sum, s) => sum + s!.kcal, 0) / slots.length),
      protein_g: Math.round(slots.reduce((sum, s) => sum + s!.protein_g, 0) / slots.length),
    };
  }
  return out;
}
