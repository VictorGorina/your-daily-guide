import { asPromptData } from "@/lib/prompt-data";
import { coachSystemPrompt, PLAN_MODEL } from "@/lib/ai-provider.server";
import { deriveGoalType, normalizeGoalType } from "@/lib/goal";
import { absorbedKcal, absorbsTooLittle } from "@/lib/day-balance";
import type { Deadline } from "@/lib/deadline";
import { describeSharedSlots, MEAL_KEYS as HOUSEHOLD_MEAL_KEYS } from "@/lib/household-shared";
import { logEvent } from "@/lib/log.server";
import { PLAN_STRUCTURE_REMINDER } from "@/lib/nutrition/plan-targets";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  addKcalAdjust,
  applyPlanChanges,
  cleanPantryExtras,
  cleanPlan,
  cleanReflowChanges,
  cleanShopping,
  composeMonthlyPlanForMember,
  dateOfPlanCell,
  diffFutureMeals,
  effectiveMealSlots,
  ingredientNames,
  type KcalAdjustCell,
  MEAL_SLOT_LABEL,
  MEAL_SLOTS,
  type MonthlyPlan,
  type PlanChange,
  planCursor,
} from "@/lib/plan-shared";
import { cleanDaySnacks } from "@/lib/snacks";
import { ValidationError } from "@/lib/validation-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askForJson } from "./ai.server";
import { blankUnselectedSlots, ownPlanRow } from "./rows.server";

/**
 * Recoloca los días FUTUROS del plan del mes con la IA, sin tocar hoy, el pasado
 * ni la lista de la compra. Es el núcleo compartido por `adjustMonthlyPlan` (la
 * persona cuenta algo — "comí de más", "hice deporte") y por el modo "meals" de
 * `reflowMonthlyPlan` (cambió la despensa). No consume cuota: el bucket lo
 * decide quien llama (`plan-adjust` vs `plan-reflow`).
 */
/**
 * A partir de este desvío (en kcal, en valor absoluto) recolocar deja de ser
 * opcional para la IA. Por debajo se compensa "de forma suave", que puede
 * significar no tocar nada — cambiar una fruta por otra no debe reescribir la
 * semana.
 */
const FORCE_ADJUST_KCAL = 200;

export async function reflowMeals(opts: {
  supabase: SupabaseClient<never, never, never>;
  userId: string;
  key: string;
  month: string;
  today: string;
  note: string;
  kcalDelta: number | null;
  /**
   * Fechas en las que se puede recolocar (ver `compensationWindow`). Sin ella,
   * cualquier día futuro del mes.
   */
  window?: readonly string[];
  /**
   * Desvío personal (el picoteo): tampoco quien planifica toca las comidas
   * compartidas, que son de toda la casa. Se corrige en las suyas en solitario.
   */
  soloOnly?: boolean;
  /**
   * Medir cuánto mueven los cambios con sus recetas y, si se quedan cortos,
   * insistir UNA vez con los números (ticket 18). Lo usa `settleDay`.
   */
  measure?: boolean;
  /** Presupuesto de la petición (ticket 22, `deadline.ts`). */
  deadline?: Deadline;
}): Promise<{
  plan: MonthlyPlan;
  before: MonthlyPlan;
  summary: string;
  synced: number;
  /** Lo que compensan de verdad (ver `absorbedKcal`); `null` sin medir. */
  absorbedKcal: number | null;
  /** Se insistió y siguió corto. */
  partial: boolean;
}> {
  const { supabase, userId, key, month, today, note, kcalDelta } = opts;

  const { data: row } = await ownPlanRow(supabase, userId, month, "plan, shopping, pantry_extras");
  const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
  const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
  const pantryExtras = cleanPantryExtras(
    (row as { pantry_extras?: unknown } | null)?.pantry_extras,
  );
  if (!current) throw new ValidationError("Todavía no hay plan de este mes");

  const recentLogsQuery = (columns: string) =>
    supabase
      .from("daily_logs")
      .select(columns)
      .eq("user_id", userId)
      .lte("log_date", today)
      .order("log_date", { ascending: false })
      .limit(7);
  const [{ data: profile }, withSnacks] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    recentLogsQuery("log_date, weight_kg, habits, mood, notes, snacks"),
  ]);
  // Sin la migración `daily_logs_snacks` la columna no existe (42703): se
  // relee sin ella en vez de quedarse sin los últimos días en el prompt.
  const { data: logs } =
    (withSnacks.error as { code?: string } | null)?.code === "42703"
      ? await recentLogsQuery("log_date, weight_kg, habits, mood, notes")
      : withSnacks;
  // El picoteo va resumido: el libro de cuentas y el último ajuste no le
  // aportan nada al modelo y alargarían mucho el prompt.
  const recentLogs = ((logs ?? []) as Record<string, unknown>[]).map(({ snacks, ...log }) => {
    const entries = cleanDaySnacks(snacks)?.entries ?? [];
    return entries.length
      ? { ...log, picoteo: entries.map((e) => `${e.text} (~${e.kcal} kcal)`) }
      : log;
  });

  const p = (profile ?? {}) as Record<string, unknown>;
  const cursor = planCursor(today);
  const goalLine = (() => {
    if (p.target_weight_kg != null) {
      const target = Number(p.target_weight_kg);
      const current = Number(p.current_weight_kg ?? p.start_weight_kg ?? target);
      const diff = Math.abs(current - target);
      const dir = deriveGoalType(current, target);
      const datePart = p.goal_target_date ? `, fecha orientativa ${p.goal_target_date}` : "";
      if (dir === "mantener" || diff < 1)
        return `Peso objetivo: ${target} kg (actual: ${current} kg — en mantenimiento${datePart}). Equilibra, no restrinjas.`;
      const verb = dir === "perder" ? "perder" : "ganar";
      return `Peso objetivo: ${target} kg (actual: ${current} kg, falta: ${diff.toFixed(1)} kg por ${verb}${datePart}). Ritmo saludable: máx ~1 kg/semana de pérdida, ~0.5 kg/semana de ganancia; nunca déficit mayor de 500 kcal/día.`;
    }
    // Fallback legacy
    const gt = p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
    return gt
      ? `Objetivo: ${gt} ${p.goal_amount ?? ""} kg, fecha objetivo ${String(p.goal_target_date ?? "sin fecha")}, peso actual ${String(p.current_weight_kg ?? "?")} kg, peso inicial ${String(p.start_weight_kg ?? "?")} kg.`
      : "La persona no tiene un objetivo de peso definido: no asumas uno ni recoloques el plan para adelgazar; céntrate en comidas equilibradas y hábitos.";
  })();
  // Por debajo de este desvío, compensar es opcional (cambiar un plátano por
  // una manzana no debe recolocar la semana). Por encima, el prompt lo exige:
  // sin esto el modelo respondía "el plan ya está equilibrado" incluso ante una
  // pizza con cerveza, que es justo lo que la persona nota como incoherente.
  const strongDelta = kcalDelta != null && Math.abs(kcalDelta) >= FORCE_ADJUST_KCAL;
  const kcalLine = kcalDelta
    ? kcalDelta > 0
      ? `Hoy hay un EXCESO estimado de ${kcalDelta} kcal sobre lo que preveía el plan.` +
        (strongDelta
          ? " Es un desvío grande: NO devuelvas el plan igual. Tienes que recolocar al menos DOS días posteriores a hoy para absorberlo (cenas más ligeras, más verdura y proteína, raciones algo menores), repartido y nunca todo en un día ni con platos de castigo."
          : " Compénsalo de forma suave repartida entre los días siguientes (nunca todo en un día, nunca con platos de castigo).")
      : `Hoy hay un DÉFICIT extra estimado de ${Math.abs(kcalDelta)} kcal (por ejemplo ejercicio) sobre lo que preveía el plan.` +
        (strongDelta
          ? " Es un desvío grande: NO devuelvas el plan igual. Tienes que reponerlo en al menos DOS días posteriores a hoy con comidas algo más completas, sin pasar hambre."
          : " Reponlo en los días siguientes con algo más de energía en las comidas, sin pasar hambre.")
    : "Si de lo que cuenta se deduce un exceso o un déficit de energía, compénsalo de forma suave en los días siguientes.";

  const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
  const home = await householdContext(supabase as never, userId);
  // Un no planificador recoloca sus comidas en solitario; las compartidas
  // las lleva quien planifica en casa (D2). Se lo decimos a la IA en el
  // prompt Y, por si no lo respeta, se congelan mecánicamente después
  // (mismo patrón "cinturón y tirantes" que el resto de REGLAs).
  const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== userId;
  const hasSharedSlots = HOUSEHOLD_MEAL_KEYS.some((m) => home.sharedSlots[m].length);
  // Sin otro adulto en la mesa, "compartido" no protege a nadie más (p. ej.
  // una persona adulta sola con peques a cargo): sus comidas se tratan como
  // propias igualmente, igual que en `compensationWindow`.
  const soloAdultHousehold = home.members.length <= 1;
  // Quien planifica también deja quietas las compartidas si el desvío es solo
  // suyo (`soloOnly`): su picoteo no cambia la cena de toda la casa.
  const freezeShared =
    isNonPlannerInHousehold ||
    (!!opts.soloOnly && !!home.plannerId && hasSharedSlots && !soloAdultHousehold);
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  const sharedSlotsLine = isNonPlannerInHousehold
    ? `REGLA 5: Hay comidas compartidas en tu casa que lleva ${plannerName}: ${describeSharedSlots(home.sharedSlots)}. NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo tus comidas en solitario.\n`
    : freezeShared
      ? `REGLA 5: Estas comidas se comparten con el resto de la casa: ${describeSharedSlots(home.sharedSlots)}. Este ajuste es solo de esta persona: NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo sus comidas en solitario.\n`
      : "";

  // Comidas que esta persona quiere planificar (ver generateMonthlyPlan):
  // una recolocación tampoco debe reintroducir un slot que ya excluyó.
  const selectedSlots = effectiveMealSlots(
    p as { meal_slots?: unknown; meals_to_plan?: string | null },
  );
  const mealSlotsLine =
    selectedSlots.length < MEAL_SLOTS.length
      ? `REGLA 6: solo planifica ${selectedSlots.map((s) => MEAL_SLOT_LABEL[s].toLowerCase()).join(", ")}. No propongas nada para ${MEAL_SLOTS.filter(
          (s) => !selectedSlots.includes(s),
        )
          .map((s) => MEAL_SLOT_LABEL[s].toLowerCase())
          .join(", ")}: esos campos se quedan vacíos.\n`
      : "";

  // El plan guardado no tiene fechas: es una rejilla de filas × Lunes…
  // Domingo, y qué fecha es cada celda lo decide `dateOfPlanCell` (la semana la
  // marca el día del mes, no el orden natural). Sin esa anotación el modelo
  // entendía "posterior a hoy" como "más abajo en la fila", y en un lunes eso
  // son los días 1 al 6 — ya pasados. Recolocaba de verdad, pero siempre en
  // días que no se podían tocar, y el ajuste no aparecía por ningún lado.
  // Las comidas elegidas a mano van como "fijo": el modelo no debe proponer
  // cambiarlas (y si lo hace, `applyPlanChanges` las ignora igualmente).
  // Una celda sin fecha (la fila de los días 29-31 tiene siete posiciones y
  // el mes, como mucho, tres de esas fechas) no se le enseña: no se puede
  // recolocar y solo añadiría platos repetidos al prompt.
  const dated = {
    ...current,
    weeks: current.weeks.map((week, wi) => ({
      ...week,
      days: week.days
        .map(({ pinned, ...d }, di) => ({
          fecha: dateOfPlanCell(month, wi, di),
          ...d,
          ...(pinned?.length ? { fijo: pinned } : {}),
        }))
        .filter((d) => d.fecha),
    })),
  };
  // Fechas que sí se pueden recolocar, dichas de forma explícita: es más difícil
  // de ignorar que una regla en prosa.
  const editableDates = current.weeks
    .flatMap((week, wi) => week.days.map((_, di) => dateOfPlanCell(month, wi, di)))
    .filter((d): d is string => !!d && d > today && (!opts.window || opts.window.includes(d)));

  /**
   * Una pasada de recolocación. `insist` solo lleva texto en el reintento: ver
   * abajo por qué hace falta pedirlo dos veces.
   *
   * Se le pide SOLO la lista de días a cambiar, no el plan entero de vuelta.
   * Pidiendo las cuatro semanas completas para mover dos cenas, el modelo
   * devolvía casi siempre el plan copiado tal cual (y cuando cambiaba algo lo
   * ponía en la fila equivocada): mucho texto de salida por un cambio mínimo.
   * Una lista corta con fechas explícitas es barata de generar, fácil de
   * validar y se aplica de forma determinista aquí, no a base de confiar.
   */
  const askReflow = (insist: string) =>
    askForJson(
      {
        key,
        userId,
        model: PLAN_MODEL,
        deadline: opts.deadline,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          insist +
          `Plan actual del mes ${month} (cada día lleva su "fecha" real):\n${JSON.stringify(dated)}\n\n` +
          `Ingredientes ya comprados (no pueden cambiar): ${ingredientNames(shopping)}\n\n` +
          (pantryExtras.length
            ? `Además la persona dice tener ya en casa (fuera de la lista de la compra, puedes usarlos en los platos): ${pantryExtras.map((e) => asPromptData(e.name)).join(", ")}\n\n`
            : "") +
          `${goalLine}\n` +
          `Últimos días reales registrados: ${JSON.stringify(recentLogs)}\n\n` +
          `Hoy es ${today} (${cursor.dayName}, semana ${cursor.weekIndex + 1} del plan).\n` +
          `Lo que ha pasado / lo que cuenta la persona: ${note}\n\n` +
          `REGLA 1: las ÚNICAS fechas que puedes cambiar son ${editableDates.join(", ") || "ninguna"}. Hoy y los días anteriores están cerrados. Guíate por la "fecha" de cada día, no por su posición en la semana. Si un día lleva "fijo", esas comidas las eligió la persona a mano: no las cambies (puedes cambiar la otra comida de ese día).\n` +
          `REGLA 2: usa SOLO los ingredientes ya comprados y los que la persona dice tener en casa (más sal, aceite, agua y especias). No cambies la lista de la compra ni añadas alimentos nuevos que no estén en ninguna de esas dos listas.\n` +
          `REGLA 3: ${kcalLine}\n` +
          "REGLA 4: mantén el rumbo del objetivo con ajustes realistas (más verdura y proteína, raciones algo menores o mayores, cenas más ligeras o más completas). Tono comprensivo, sin culpar ni compensar en exceso. " +
          `${PLAN_STRUCTURE_REMINDER} ` +
          `${sharedSlotsLine}` +
          `${mealSlotsLine}` +
          "En 'intro', 1-2 frases en lenguaje sencillo explicando qué has recolocado y por qué. " +
          'Devuelve SOLO los días que cambias, no el plan entero, como JSON válido: {"intro": string, "cambios": [{"fecha": "AAAA-MM-DD", "comida": string, "cena": string}]}. Incluye "comida" o "cena" solo si cambian ese plato. Sin markdown.',
      },
      (parsed) => {
        const clean = cleanReflowChanges(parsed, editableDates);
        const raw = (parsed as { cambios?: unknown } | null)?.cambios;
        if (clean && Array.isArray(raw) && raw.length > clean.changes.length) {
          // Cambios que la IA propuso fuera de las fechas permitidas: se
          // descartan, pero conviene verlo (un "ajuste" que no cambia nada).
          logEvent("warn", "reflow_changes_discarded", {
            proposed: raw.length,
            kept: clean.changes.length,
          });
        }
        return clean;
      },
    );

  let reflow = await askReflow("");
  let absorbed: number | null = null;
  let partial = false;
  /** Lo que mueve cada plato recolocado del reflow elegido (ver `addKcalAdjust`). */
  let movedCells: KcalAdjustCell[] = [];

  /**
   * Ticket 18: cuánto compensan de verdad unos cambios, con las recetas de la
   * caché a la ración del plan (solo se recolocan comidas propias). Hasta que
   * el reajuste sea código (ticket 12), es lo que evita dar por "compensado" un
   * cambio de lentejas por garbanzos que mueve 30 kcal de 400.
   *
   * Devuelve también lo que mueve cada plato: es lo que se guarda en el día como
   * `kcalAdjust`, porque los platos del plan se escalan al objetivo de su comida
   * (`plannedMacros`) y un plato más ligero, escalado, ya no aligera nada.
   */
  const measure = async (
    changes: PlanChange[],
  ): Promise<{ absorbed: number; cells: KcalAdjustCell[] } | null> => {
    const cells = diffFutureMeals(current, applyPlanChanges(current, changes, today), today);
    if (!cells.length) return { absorbed: 0, cells: [] };
    const [{ getRecipes }, { macrosOfRecipe }, { energyTargets }, { portionFactors }] =
      await Promise.all([
        import("@/lib/nutrition/recipes.server"),
        import("@/lib/nutrition/recipe"),
        import("@/lib/nutrition/energy"),
        import("@/lib/nutrition/portion"),
      ]);
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const factor = portionFactors(energyTargets(profile as never), profile as never).plan;
    const recipes = await getRecipes(
      cells.flatMap((c) => [c.before, c.after]),
      { apiKey: key, userId, deadline: opts.deadline },
    );
    const kcalOf = (dish: string) => {
      const recipe = recipes.get(dish.trim())?.recipe;
      return recipe ? macrosOfRecipe(recipe, factor).kcal : null;
    };
    const total = absorbedKcal(cells, kcalOf);
    if (total == null) return null;
    return {
      absorbed: total,
      cells: cells.map((c) => ({
        date: c.date,
        slot: c.slot,
        kcal: (kcalOf(c.after) ?? 0) - (kcalOf(c.before) ?? 0),
      })),
    };
  };

  if (opts.measure && kcalDelta) {
    const first = await measure(reflow.changes).catch((error) => {
      console.error("reflowMeals: medir", error);
      return null;
    });
    absorbed = first?.absorbed ?? null;
    movedCells = first?.cells ?? [];
    // Corto (o nada): UNA insistencia, con los números. Sustituye a la genérica
    // de "no has cambiado nada".
    if (absorbed != null && strongDelta && absorbsTooLittle(absorbed, kcalDelta)) {
      const sign = Math.sign(kcalDelta);
      const missing = Math.round(Math.abs(kcalDelta) - Math.max(0, absorbed * sign));
      const second = await askReflow(
        `AVISO: tus cambios mueven unas ${Math.max(0, Math.round(absorbed * sign))} de las ` +
          `${Math.abs(kcalDelta)} kcal que hay que ${sign > 0 ? "quitar" : "reponer"}; faltan unas ` +
          `${missing}. ${sign > 0 ? "Cambia platos por otros más ligeros" : "Cambia platos por otros más completos"} ` +
          "en los días permitidos hasta cubrir esa diferencia, repartida en al menos dos días.\n\n",
      );
      const again = second.changes.length ? await measure(second.changes).catch(() => null) : null;
      if (again != null && again.absorbed * sign > absorbed * sign) {
        reflow = second;
        absorbed = again.absorbed;
        movedCells = again.cells;
      }
      partial = absorbsTooLittle(absorbed, kcalDelta);
    }
    // Para comparar después con el reajuste en código (ticket 12).
    console.info("reflowMeals: absorbido", {
      pending: kcalDelta,
      absorbed,
      ratio: absorbed != null ? Math.round((absorbed / kcalDelta) * 100) / 100 : null,
    });
  }

  // Un desvío grande sin ni un cambio es, casi siempre, el modelo escurriendo
  // el bulto. Se le insiste UNA vez: cuesta una llamada extra y solo pasa en el
  // caso que la persona nota como incoherente ("me he comido una pizza y dice
  // que no cambia nada"). Con `measure`, la insistencia de arriba ya lo cubre.
  if (!opts.measure && strongDelta && !reflow.changes.length) {
    console.warn(`reflowMeals: ${kcalDelta} kcal de desvío y ningún cambio; insistiendo`);
    const second = await askReflow(
      "AVISO: en tu respuesta anterior no cambiaste ningún día, y para este desvío eso no vale. Devuelve al menos DOS días con platos distintos.\n\n",
    );
    if (second.changes.length) reflow = second;
    else console.warn("reflowMeals: sigue sin cambiar nada tras insistir");
  }
  // Sin `measure` (el coach, un plato futuro cambiado a mano), si hay desvío que
  // compensar también se guarda lo que mueve cada plato: si no, el escalado al
  // objetivo de la comida lo borraría y el cambio no compensaría nada.
  if (!opts.measure && kcalDelta && reflow.changes.length) {
    const moved = await measure(reflow.changes).catch((error) => {
      console.error("reflowMeals: medir", error);
      return null;
    });
    movedCells = moved?.cells ?? [];
  }
  // Se aplica sobre la versión más reciente de la fila (ticket 21): la IA
  // tarda y entretanto la persona puede fijar un plato a mano, que
  // `applyPlanChanges` respeta. `before` es esa misma versión, para que lo que
  // la tarjeta "Balance de hoy" enseña como movido sea solo lo que movió esto.
  let final = current;
  let before = current;
  await updatePlanRowCas(supabase, userId, month, "plan", (row) => {
    const latest = cleanPlan(row.plan);
    if (!latest) throw new ValidationError("Todavía no hay plan de este mes");
    const merged: MonthlyPlan = {
      ...addKcalAdjust(applyPlanChanges(latest, reflow.changes, today), movedCells, today),
      intro: reflow.intro || latest.intro,
    };
    // Cinturón: si la IA tocó igualmente un día compartido, se restaura desde
    // lo leído — un no planificador nunca puede acabar escribiendo, ni por
    // accidente, el plato de una comida de la casa.
    const sharedComposed = freezeShared
      ? (composeMonthlyPlanForMember(merged, latest, home.sharedSlots) ?? merged)
      : merged;
    // Mismo cinturón que en generateMonthlyPlan: si la IA reintrodujo un slot
    // que la persona no quiere planificar, se vacía aquí también.
    final = blankUnselectedSlots(sharedComposed, selectedSlots);
    before = latest;
    return { plan: final };
  });

  // Quien planifica con las compartidas congeladas (`soloOnly`) no ha cambiado
  // nada de la casa: no hay nada que espejar al resto.
  const { synced } =
    freezeShared && !isNonPlannerInHousehold
      ? { synced: 0 }
      : await syncSharedMeals({ supabase: supabase as never, userId, month, today });

  const summary = isNonPlannerInHousehold
    ? `${final.intro} Las comidas compartidas de tu hogar no las toco — esas las lleva ${plannerName}.`
    : freezeShared
      ? `${final.intro} Las comidas que compartes con tu casa no las toco.`
      : synced
        ? `${final.intro} También he ajustado las comidas compartidas de tu hogar.`
        : final.intro;

  return { plan: final, before, summary, synced, absorbedKcal: absorbed, partial };
}
