import {
  type FeedingStage,
  type HomeSchedule,
  isSharedSlot,
  MEAL_KEYS,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";
import { concreteDish } from "@/lib/plan-concrete-dish";
import {
  dateOfPlanCell,
  normDay,
  planCursor,
  planDayOf,
  planForDate,
  planSlotIndex,
  weekdayName,
} from "./plan/grid";
import { cleanKcalAdjust } from "./plan/parse";
import { MEAL_SLOT_FIELD, MEAL_SLOT_LABEL, MEAL_SLOTS, type MealSlot } from "./plan/slots";
import {
  type ChildMeal,
  isPinned,
  type MonthlyPlan,
  type PlanCoverage,
  type PlanDay,
} from "./plan/types";
import { eur, pendingTotal, shoppingTotal } from "./shopping/clean";
import {
  daysInMonth,
  type PantryExtra,
  type ShoppingCadence,
  type ShoppingItem,
  type ShoppingList,
  tripsForCoverage,
} from "./shopping/model";
import { carryOwnedCanonical, projectTrips, tripLabel } from "./shopping/trips";

export * from "./plan/slots";
export * from "./plan/types";
export * from "./shopping/model";
export * from "./shopping/state";
export * from "./plan/month";
export * from "./shopping/trips";
export * from "./shopping/clean";
export * from "./plan/grid";
export * from "./plan/parse";
export * from "./plan/constraints";

/**
 * Un plato que cambió la comprobación del plan para que su día encaje. Comida y
 * cena son de un día; desayuno y merienda son una idea de la semana (`week`,
 * `option`: índices en `weeks[].breakfasts`/`snacks`) que usan `days` días
 * desde `date`.
 */
export type PlanFitChange = {
  date: string;
  slot: "comida" | "cena" | "desayuno" | "merienda";
  from: string;
  to: string;
  week?: number;
  option?: number;
  days?: number;
};

/**
 * Aplica los cambios de la comprobación del plan (`fitMonthlyPlan`), cada uno
 * SOLO si su celda sigue teniendo el plato de antes (`from`): la ronda tarda y
 * la persona puede haber cambiado algo mientras. Comida y cena por fecha y sin
 * tocar hoy, el pasado ni un plato puesto a mano (`applyPlanChanges`); una idea
 * semanal, en su semana.
 */
export function applyPlanFitChanges(
  plan: MonthlyPlan,
  changes: readonly PlanFitChange[],
  today: string,
): { plan: MonthlyPlan; applied: PlanFitChange[] } {
  let next = plan;
  const applied: PlanFitChange[] = [];
  for (const c of changes) {
    if (c.slot === "comida" || c.slot === "cena") {
      const key = c.slot === "comida" ? "lunch" : "dinner";
      if (planDayOf(next, c.date)?.[key] !== c.from) continue;
      const after = applyPlanChanges(next, [{ date: c.date, [key]: c.to }], today);
      if (after === next) continue;
      next = after;
    } else {
      const list = c.slot === "desayuno" ? "breakfasts" : "snacks";
      const week = c.week != null ? next.weeks[c.week] : undefined;
      if (!week || c.option == null || week[list][c.option] !== c.from) continue;
      next = {
        ...next,
        weeks: next.weeks.map((w, wi) =>
          wi === c.week
            ? { ...w, [list]: w[list].map((idea, i) => (i === c.option ? c.to : idea)) }
            : w,
        ),
      };
    }
    applied.push(c);
  }
  return { plan: next, applied };
}

export type PlanFitMark = {
  at: string;
  /** Días que encajan / días medidos, antes y después de la ronda (0-1). */
  before: number;
  after: number;
  changed: PlanFitChange[];
};

/** Versión actual de `MonthlyPlan.targetsVersion`. */
export const PLAN_TARGETS_VERSION = 1;

/**
 * `MealSlot` (plan-shared, 4 comidas) y `MealKey` (household-shared, issue 03)
 * comparten los mismos 3 nombres para desayuno/comida/cena — solo el snack no
 * tiene equivalente, porque nunca es una comida compartida del hogar (D5).
 */
const mealKeyOf = (slot: MealSlot): MealKey | null => (slot === "snack" ? null : slot);

/**
 * Si esa comida de ese día es compartida y quien llama NO es quien planifica
 * en casa, el cambio no es suyo que hacer (D2): devuelve el mensaje que se le
 * enseña. `date` decide el día de la semana; si no hay hogar (o no tiene
 * planificador con cuenta) o la comida no se comparte, `null`.
 */
export function sharedSlotWriteBlocked(
  home: {
    plannerId: string | null;
    sharedSlots: SharedSlots;
    members: { userId: string | null; displayName: string }[];
  },
  userId: string,
  date: string,
  slot: MealSlot,
): string | null {
  const mealKey = mealKeyOf(slot);
  if (!mealKey) return null;
  if (!home.plannerId || home.plannerId === userId) return null;
  const weekday = planCursor(date).dayIndex;
  if (!isSharedSlot(home.sharedSlots, mealKey, weekday)) return null;
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  return `Esa comida la lleva ${plannerName} de tu casa. Puedo cambiar tus comidas en solitario.`;
}

/**
 * Conserva el pasado y el día de hoy del plan actual y sólo adopta del plan
 * nuevo los días POSTERIORES a `today`, mirando la fecha real de cada celda.
 *
 * Antes se decidía por posición en la rejilla (`día > el de hoy dentro de su
 * semana`), y eso no coincide con el calendario: un lunes 7, que es la última
 * fecha de la semana 0 pero la posición 0 de la fila, dejaba las posiciones 1-6
 * —que son los días 1 al 6, ya pasados— del lado "futuro". Resultado: la
 * recolocación reescribía días pasados y no tocaba ninguno de los siguientes,
 * así que el ajuste no se veía por ningún lado y parecía que el coach no había
 * hecho nada.
 */
export const mergeFuturePlan = (
  current: MonthlyPlan,
  next: MonthlyPlan,
  today: string,
): MonthlyPlan => {
  const month = today.slice(0, 7);
  return {
    ...(current.coverage ? { coverage: current.coverage } : {}),
    ...(current.cadence ? { cadence: current.cadence } : {}),
    intro: next.intro || current.intro,
    focus: next.focus.length ? next.focus : current.focus,
    weeks: current.weeks.map((week, wi) => {
      const fresh = next.weeks[wi];
      if (!fresh) return week;
      // Los campos de semana (desayunos y meriendas rotan por semana) solo se
      // adoptan si la semana entera está por venir; si no, cambiarían también
      // lo que ya se comió.
      const weekAhead = week.days.every((_, di) => {
        const date = dateOfPlanCell(month, wi, di);
        return date == null || date > today;
      });
      return {
        label: week.label,
        focus: weekAhead ? fresh.focus || week.focus : week.focus,
        breakfasts: weekAhead && fresh.breakfasts.length ? fresh.breakfasts : week.breakfasts,
        snacks: weekAhead && fresh.snacks.length ? fresh.snacks : week.snacks,
        days: week.days.map((day, di) => {
          const date = dateOfPlanCell(month, wi, di);
          if (date == null || date <= today) return day;
          const freshDay =
            fresh.days.find((d) => normDay(d.day) === normDay(day.day)) ?? fresh.days[di];
          if (!freshDay?.lunch && !freshDay?.dinner) return day;
          // El spread conserva breakfast/snack/extras/kids/pinned: un plato pedido
          // a mano (incluido el plato aparte de un niño) manda sobre la
          // recolocación automática hasta que se cambie a mano otra vez (la IA
          // sólo devuelve lunch/dinner por día). Una comida o cena elegida a mano
          // vive en el mismo campo que escribe la IA, así que la protege `pinned`.
          return {
            ...day,
            lunch: isPinned(day, "comida") ? day.lunch : freshDay.lunch || day.lunch,
            dinner: isPinned(day, "cena") ? day.dinner : freshDay.dinner || day.dinner,
          };
        }),
      };
    }),
  };
};

/** Un día que la recolocación cambia. Solo lo que cambia: lo demás se queda. */
export type PlanChange = { date: string; lunch?: string; dinner?: string };

/**
 * Lee la respuesta de la IA al recolocar el plan, que es una LISTA DE CAMBIOS
 * ({"intro", "cambios": [{"fecha","comida","cena"}]}), no el plan entero.
 *
 * Pedir las cuatro semanas de vuelta para mover dos cenas salía caro y salía
 * mal: el modelo copiaba el plan tal cual la mayoría de las veces. Una lista
 * corta es barata de generar y, sobre todo, se puede validar — aquí se
 * descarta cualquier fecha que no esté entre las editables, así que un despiste
 * del modelo no puede reescribir un día ya cerrado.
 *
 * Devuelve `null` solo si la respuesta no tiene forma de lista de cambios (para
 * que quien llama reintente). Una lista vacía es una respuesta válida: significa
 * "no hace falta cambiar nada".
 */
export function cleanReflowChanges(
  raw: unknown,
  allowedDates: readonly string[],
): { intro: string; changes: PlanChange[] } | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.cambios)) return null;
  const allowed = new Set(allowedDates);
  const changes: PlanChange[] = [];
  for (const item of o.cambios) {
    const c = (item ?? {}) as Record<string, unknown>;
    const date = String(c.fecha ?? "");
    if (!allowed.has(date)) continue;
    const lunch = concreteChange(c.comida);
    const dinner = concreteChange(c.cena);
    if (!lunch && !dinner) continue;
    changes.push({ date, ...(lunch ? { lunch } : {}), ...(dinner ? { dinner } : {}) });
  }
  return { intro: String(o.intro ?? ""), changes };
}

/**
 * Un plato propuesto al recolocar, solo si es concreto (`concreteDish`): sin el
 * "fuera de casa"/"o similar", y vacío si es genérico o un cheat day — una
 * recolocación compensa con platos calculables, y no cambiar nada siempre vale.
 */
function concreteChange(raw: unknown): string {
  const v = concreteDish(String(raw ?? "").trim());
  return v.kind === "ok" ? v.dish.slice(0, 200) : "";
}

/**
 * Aplica una lista de cambios sobre el plan, cada uno en la celda que le toca
 * por fecha (`planSlotIndex`, la misma que usa la pantalla). Un cambio con
 * fecha de hoy o anterior se ignora: el pasado no se reescribe nunca. Tampoco
 * se pisa una comida o cena elegida a mano (`pinned`), aunque la IA la devuelva.
 */
export function applyPlanChanges(
  current: MonthlyPlan,
  changes: readonly PlanChange[],
  today: string,
): MonthlyPlan {
  const byCell = new Map<string, PlanChange>();
  for (const c of changes) {
    if (!c.date || c.date <= today) continue;
    const at = planSlotIndex(current, c.date);
    if (at) byCell.set(`${at.weekIndex}:${at.dayIndex}`, c);
  }
  if (!byCell.size) return current;
  return {
    ...current,
    weeks: current.weeks.map((week, wi) => ({
      ...week,
      days: week.days.map((day, di) => {
        const c = byCell.get(`${wi}:${di}`);
        // El spread conserva breakfast/snack/extras/kids/pinned: la recolocación
        // solo toca comida y cena, y nunca la que se eligió a mano.
        if (!c) return day;
        return {
          ...day,
          lunch: c.lunch && !isPinned(day, "comida") ? c.lunch : day.lunch,
          dinner: c.dinner && !isPinned(day, "cena") ? c.dinner : day.dinner,
        };
      }),
    })),
  };
}

/**
 * Segunda pasada tras `mergeFuturePlan`, solo para el recálculo por cambio de
 * mesa (issue 05, `reflowMonthlyPlan` scope "full"). `mergeFuturePlan` conserva
 * el `kids` del plan actual en los días futuros (para no pisar un `setChildMeal`
 * a mano); pero un bebé recién dado de alta necesita su puré y ese `kids` nuevo
 * viene en `fresh`, no en el actual. Aquí:
 *  - se descartan los `kids` de un niño que ya no está en la casa (`keepChildIds`);
 *  - se adopta del plan nuevo cada `(childId, slot)` que el día no tuviera ya
 *    (una entrada existente = plato puesto a mano, se respeta).
 * Solo toca días posteriores a `today`, por fecha real de la celda (mismo
 * criterio que `mergeFuturePlan`); hoy y el pasado no se tocan.
 */
export const mergeFutureKids = (
  merged: MonthlyPlan,
  fresh: MonthlyPlan,
  today: string,
  keepChildIds: string[],
): MonthlyPlan => {
  const keep = new Set(keepChildIds);
  const month = today.slice(0, 7);
  return {
    ...merged,
    weeks: merged.weeks.map((week, wi) => {
      const freshWeek = fresh.weeks[wi];
      if (!freshWeek) return week;
      return {
        ...week,
        days: week.days.map((day, di) => {
          const date = dateOfPlanCell(month, wi, di);
          if (date == null || date <= today) return day;
          const freshDay =
            freshWeek.days.find((d) => normDay(d.day) === normDay(day.day)) ?? freshWeek.days[di];
          const existing = (day.kids ?? []).filter((k) => keep.has(k.childId));
          const taken = new Set(existing.map((k) => `${k.childId}|${k.slot}`));
          const added = (freshDay?.kids ?? []).filter(
            (k) => keep.has(k.childId) && !taken.has(`${k.childId}|${k.slot}`),
          );
          const kids = [...existing, ...added];
          if (kids.length === (day.kids?.length ?? 0) && !added.length) return day;
          const nextDay: PlanDay = { ...day };
          if (kids.length) nextDay.kids = kids;
          else delete nextDay.kids;
          return nextDay;
        }),
      };
    }),
  };
};

/**
 * Resultado del recálculo completo (`reflowMonthlyPlan` scope "full": cambió la
 * mesa) aplicado a una versión de la fila: días futuros del plan nuevo
 * (`mergeFuturePlan` + `mergeFutureKids`, que respetan lo fijado y los platos de
 * niños puestos a mano), la lista nueva con las marcas de compra traspasadas por
 * nombre (`carryOwnedCanonical`) y la cadencia y cobertura de esa versión.
 *
 * Se aplica a la versión MÁS RECIENTE de la fila (ticket 21): la generación
 * tarda ~100 s y entretanto la persona puede fijar un plato, marcar la compra o
 * cambiar la cadencia. `fallback` es lo que se usó al generar, por si la fila no
 * lo trae.
 */
export function mergeRegeneratedPlan(
  latest: { plan: MonthlyPlan; shopping: ShoppingList },
  fresh: { plan: MonthlyPlan; shopping: ShoppingList },
  today: string,
  keepChildIds: string[],
  fallback: { coverage: PlanCoverage; cadence: ShoppingCadence },
): { plan: MonthlyPlan; shopping: ShoppingList } {
  const merged = mergeFutureKids(
    mergeFuturePlan(latest.plan, fresh.plan, today),
    fresh.plan,
    today,
    keepChildIds,
  );
  return {
    plan: {
      ...merged,
      coverage: latest.plan.coverage ?? fallback.coverage,
      cadence: latest.plan.cadence ?? fallback.cadence,
    },
    shopping: carryOwnedCanonical(latest.shopping, fresh.shopping),
  };
}

/**
 * Suma a cada celda (fecha y comida) las kcal que la compensación le ha movido
 * (`PlanDay.kcalAdjust`). Solo días posteriores a `today`: hoy y el pasado no
 * se tocan. Se acumula: dos compensaciones sobre la misma cena se suman.
 */
export type KcalAdjustCell = { date: string; slot: MealSlot; kcal: number };

export function addKcalAdjust(
  plan: MonthlyPlan,
  cells: readonly KcalAdjustCell[],
  today: string,
): MonthlyPlan {
  const byCell = new Map<string, { slot: MealSlot; kcal: number }[]>();
  for (const c of cells) {
    if (c.date <= today || !Math.round(c.kcal)) continue;
    const at = planSlotIndex(plan, c.date);
    if (!at) continue;
    const key = `${at.weekIndex}:${at.dayIndex}`;
    byCell.set(key, [...(byCell.get(key) ?? []), c]);
  }
  if (!byCell.size) return plan;
  return {
    ...plan,
    weeks: plan.weeks.map((week, wi) => ({
      ...week,
      days: week.days.map((day, di) => {
        const add = byCell.get(`${wi}:${di}`);
        if (!add) return day;
        const next: Partial<Record<MealSlot, number>> = { ...(day.kcalAdjust ?? {}) };
        for (const { slot, kcal } of add) next[slot] = Math.round((next[slot] ?? 0) + kcal);
        const kcalAdjust = cleanKcalAdjust(next);
        const { kcalAdjust: _drop, ...rest } = day;
        return kcalAdjust ? { ...rest, kcalAdjust } : rest;
      }),
    })),
  };
}

/**
 * Escribe un plato suelto en la celda de `date`, tal cual lo pidió la persona.
 * Es la única forma de hacerlo: la usa `setPlanMeal` en el servidor y la
 * actualización optimista de la pantalla, así que lo que se ve al instante es
 * exactamente lo que se guarda.
 *
 * - `off`: ingredientes del plato que no están en la compra (aviso en pantalla).
 * - `pin` (por defecto `true`): marca la comida como elegida a mano, para que
 *   ningún reajuste la pise. `false` quita la marca (lo usa "Deshacer" para
 *   dejar el día como estaba).
 *
 * Devuelve `null` si la fecha no tiene celda en el plan.
 */
export function withPlanMeal(
  plan: MonthlyPlan,
  date: string,
  slot: MealSlot,
  dish: string,
  opts: { off?: readonly string[]; pin?: boolean } = {},
): MonthlyPlan | null {
  const at = planSlotIndex(plan, date);
  if (!at) return null;
  const off = opts.off ?? [];
  const pin = opts.pin ?? true;
  return {
    ...plan,
    weeks: plan.weeks.map((week, wi) =>
      wi !== at.weekIndex
        ? week
        : {
            ...week,
            days: week.days.map((day, di) => {
              if (di !== at.dayIndex) return day;
              const updated: PlanDay = { ...day, [MEAL_SLOT_FIELD[slot]]: dish };

              const extras = { ...(day.extras ?? {}) };
              if (off.length) extras[slot] = [...off];
              else delete extras[slot];
              if (Object.keys(extras).length) updated.extras = extras;
              else delete updated.extras;

              const pinned = new Set(day.pinned ?? []);
              if (pin) pinned.add(slot);
              else pinned.delete(slot);
              const pins = MEAL_SLOTS.filter((s) => pinned.has(s));
              if (pins.length) updated.pinned = pins;
              else delete updated.pinned;

              return updated;
            }),
          },
    ),
  };
}

/**
 * Pone (o, con `dish` vacío, quita) el plato aparte de un niño en la celda de
 * `date`. Nunca toca la comida de los adultos. Con `onlyIfEmpty` solo rellena un
 * hueco: si ese niño ya tiene plato en esa comida, lo deja (lo usa
 * `fillChildMeals`, que no debe pisar un plato puesto a mano).
 *
 * Devuelve el MISMO objeto si no cambia nada, y `null` si la fecha no tiene
 * celda en el plan.
 */
export function withChildMeal(
  plan: MonthlyPlan,
  date: string,
  meal: { childId: string; slot: MealSlot; dish: string; off?: readonly string[] },
  opts: { onlyIfEmpty?: boolean } = {},
): MonthlyPlan | null {
  const at = planSlotIndex(plan, date);
  if (!at) return null;
  const day = plan.weeks[at.weekIndex]!.days[at.dayIndex]!;
  const same = (k: ChildMeal) => k.childId === meal.childId && k.slot === meal.slot;
  if (opts.onlyIfEmpty && (day.kids ?? []).some(same)) return plan;
  const others = (day.kids ?? []).filter((k) => !same(k));
  const kids: ChildMeal[] = meal.dish
    ? [
        ...others,
        {
          childId: meal.childId,
          slot: meal.slot,
          dish: meal.dish,
          ...(meal.off?.length ? { off: [...meal.off] } : {}),
        },
      ]
    : others;
  if (!meal.dish && others.length === (day.kids?.length ?? 0)) return plan;
  const updated: PlanDay = { ...day };
  if (kids.length) updated.kids = kids;
  else delete updated.kids;
  return {
    ...plan,
    weeks: plan.weeks.map((week, wi) =>
      wi !== at.weekIndex
        ? week
        : { ...week, days: week.days.map((d, di) => (di === at.dayIndex ? updated : d)) },
    ),
  };
}

export type PlanMeal = {
  moment: string;
  slot: MealSlot;
  idea: string;
  /** Ingredientes de ese plato que no están en la lista de la compra. */
  off: string[];
};

/**
 * Comidas de una fecha concreta, listas para tarjetas de seguimiento diario.
 * Comida y cena salen del día exacto del plan; desayuno y snack usan el plato
 * pedido para ese día si lo hay y, si no, rotan entre las opciones de la semana
 * según el día para dar variedad sin depender de más IA.
 *
 * Un slot sin plato (idea vacía) no aparece — antes solo pasaba esto con el
 * snack; ahora las cuatro comidas se tratan igual, que es lo que hace que
 * excluir una comida en el onboarding se note de verdad aquí: si
 * `generateMonthlyPlan` la deja en blanco para ese perfil, deja de salir en
 * Hoy y en Plan sin que este componente tenga que saber nada de preferencias.
 *
 * `selectedSlots`, si se pasa, es un cinturón extra sobre lo anterior: aunque
 * el día tenga contenido en un slot (p. ej. porque se espejó desde el plato
 * compartido de otro miembro del hogar — `composeDayForUser` no conoce las
 * preferencias de cada persona), aquí se descarta igual si esa persona no
 * quiere ese slot. Se usa en las pantallas (Hoy, Plan, detalle del día); el
 * resto de usos internos (chat, intercambiar un plato) no lo necesitan.
 */
export function mealsForDate(
  plan: MonthlyPlan | null,
  date: string,
  selectedSlots?: readonly MealSlot[],
): PlanMeal[] {
  const found = planForDate(plan, date);
  const { dayIndex } = planCursor(date);
  const rotate = (options: string[]) => (options.length ? options[dayIndex % options.length]! : "");
  const day = found?.day ?? null;
  const off = (slot: MealSlot) => day?.extras?.[slot] ?? [];
  const allowed = selectedSlots ? new Set(selectedSlots) : null;

  const meal = (slot: MealSlot, idea: string): PlanMeal | null => {
    if (!idea || (allowed && !allowed.has(slot))) return null;
    return { moment: MEAL_SLOT_LABEL[slot], slot, idea, off: off(slot) };
  };

  return [
    meal("desayuno", day?.breakfast || rotate(found?.week.breakfasts ?? [])),
    meal("comida", day?.lunch ?? ""),
    meal("cena", day?.dinner ?? ""),
    meal("snack", day?.snack || rotate(found?.week.snacks ?? [])),
  ].filter((m): m is PlanMeal => m !== null);
}

export type MealStatus = "plan" | "distinto" | "salteo";

/**
 * Una comida dentro del registro del día (`daily_logs.habits`). Vive aquí y no
 * en `daily.ts` porque `reconcileHabits` la necesita y `daily.ts` ya importa
 * este módulo (al revés sería un ciclo).
 */
export type MealHabit = {
  label: string;
  done: boolean;
  status?: MealStatus;
  /**
   * Plato que el PLAN proponía para ese momento, congelado la primera vez que
   * se ve el día y nunca reescrito. Es lo que Hoy tacha bajo el plato real:
   * cambies una vez o veinte, el tachado sigue siendo la sugerencia original.
   * Sustituye a `wasIdea`, que guardaba "lo que había justo antes del último
   * cambio" y por tanto se iba desplazando con cada cambio encadenado.
   */
  plannedIdea?: string;
  /** Antecesor de `plannedIdea`. Solo se lee, para registros ya guardados. */
  wasIdea?: string;
  /**
   * kcal que la guía estimaba para el plato del plan de ese momento, congeladas
   * igual que `plannedIdea`. El desvío que se le pasa a la IA se mide siempre
   * contra el PLAN, no contra el último cambio: si no, cambiar dos veces una
   * cena daba un desvío medido contra el cambio intermedio (y podía salir
   * negativo tras comerse una pizza).
   */
  plannedKcal?: number;
  /** Proteína (g) del plato del plan, congelada igual que `plannedKcal` (ticket 13). */
  plannedProtein?: number;
  /**
   * Tamaño que eligió en "comí distinto" (ticket 17): pequeño · normal ·
   * grande, sobre su ración habitual. Si las últimas 5 veces eligió el mismo,
   * ese viene preseleccionado (`learnedPortionSize`).
   */
  portionSize?: "pequena" | "normal" | "grande";
  /**
   * kcal que la persona apuntó a mano porque su texto no permitía calcular el
   * plato ("comí algo rápido", ticket 13). La cifra es suya, no un promedio.
   */
  manualKcal?: number;
  /** Qué comió realmente cuando status === "distinto". Se escribe desde el
   * DayDetailSheet al corregir un día pasado — el plan no cambia, pero el
   * historial queda correcto. */
  actual?: string;
  /** Días futuros que se recolocaron para compensar este cambio. Lo escribe el
   * lote de `use-meal-swap`, en todas las comidas del mismo lote. */
  adjustmentChanges?: MealChange[];
  /** Explicación en una frase del mismo ajuste. */
  adjustmentSummary?: string;
  /** Desvío estimado en kcal del lote frente a lo que preveía el plan. */
  adjustmentKcal?: number;
  /**
   * Desvío en kcal de ESTA comida frente al plan, capturado al cambiarla
   * (`compensateDishChanges`). Se sobrescribe si se vuelve a cambiar la misma
   * comida. Vive aparte de `adjustmentKcal` (que es el total ya compensado de
   * un lote) porque hace falta poder sumar el desvío de varios cambios
   * repartidos en distintos lotes del mismo día antes de que ninguno cruce el
   * umbral por separado — ver `pendingSwapKcal`.
   */
  swapKcalDelta?: number;
  /**
   * Desvío de proteína (g) de ESTA comida frente al plan, con la misma
   * contabilidad que `swapKcalDelta` (se compensa a la vez, `swapCompensated`, y
   * se devuelve con el signo contrario al deshacer). Ticket 13: una bajada de
   * proteína de 20 g o más se compensa con cualquier objetivo.
   */
  swapProteinDelta?: number;
  /** Si `swapKcalDelta` (y `swapProteinDelta`) ya se mandaron a `reflowMeals`. */
  swapCompensated?: boolean;
  /**
   * Plato que había en el plan cuando se confirmó "comí esto" o "comí otra
   * cosa" — no lo que se comió, sino contra qué momento del plan se confirmó.
   * `reconcileHabits` lo compara con el plato actual del plan para detectar
   * una confirmación obsoleta (un plato compartido que el hogar cambia por
   * detrás, nunca una recolocación automática, que no toca hoy).
   */
  confirmedIdea?: string;
};

/**
 * El plato que hay que tachar bajo el plato real de una comida: la sugerencia
 * original del plan, o `null` si lo que se ve ya es esa sugerencia. Cae a
 * `wasIdea` para registros anteriores a `plannedIdea`.
 */
export function suggestedDish(habit: MealHabit, currentIdea: string): string | null {
  const suggested = habit.plannedIdea || habit.wasIdea;
  return suggested && suggested !== currentIdea ? suggested : null;
}

/**
 * kcal de cambios de plato de hoy que todavía no se han mandado a
 * `reflowMeals` (con signo): la suma de `swapKcalDelta` de las comidas cuyo
 * `swapCompensated` no es `true`. Mismo papel que `pendingSnackKcal` para el
 * picoteo — deja que dos cambios pequeños en lotes distintos se sumen hasta
 * pasar el umbral de `compensationNeed` aunque ninguno lo cruce por separado.
 */
export function pendingSwapKcal(habits: readonly MealHabit[]): number {
  let total = 0;
  for (const h of habits) {
    if (h.swapCompensated || h.swapKcalDelta == null) continue;
    total += h.swapKcalDelta;
  }
  return Math.round(total);
}

/** Igual que `pendingSwapKcal`, para la proteína (g, con signo). */
export function pendingSwapProtein(habits: readonly MealHabit[]): number {
  let total = 0;
  for (const h of habits) {
    if (h.swapCompensated || h.swapProteinDelta == null) continue;
    total += h.swapProteinDelta;
  }
  return Math.round(total);
}

/**
 * Casa el registro del día con las comidas que el plan tiene HOY para esta
 * persona (ya filtradas por `effectiveMealSlots`).
 *
 * Hace falta porque `daily_logs.habits` se escribe UNA vez, al crear el día, y
 * lo crea quien toque el día primero con la lista que tenga a mano: abrir el
 * chat antes que Hoy lo crea vacío, y `logTodayWeight` lo creaba con todas las
 * comidas. A partir de ahí nadie lo reconciliaba, así que una comida
 * descartada en el onboarding seguía apareciendo en Hoy para siempre.
 *
 * Conserva por `label` todo lo que es del registro y no del plan (qué marcaste,
 * qué comiste, el ajuste), descarta las comidas que ya no se planifican, añade
 * las que falten y congela `plannedIdea` la primera vez que ve cada comida.
 *
 * `changed` es `false` cuando no hay nada que guardar — quien llama lo usa para
 * no escribir en bucle en cada render.
 */
export function reconcileHabits(
  habits: readonly MealHabit[] | null | undefined,
  meals: readonly { moment: string; idea: string }[],
): { habits: MealHabit[]; changed: boolean } {
  const previous = habits ?? [];
  const byLabel = new Map(previous.map((h) => [h.label, h]));
  const next = meals.map((m) => {
    const existing = byLabel.get(m.moment);
    if (!existing) return { label: m.moment, done: false, plannedIdea: m.idea || undefined };
    // Una confirmación ("comí esto" / "comí otra cosa") queda obsoleta si el
    // plato que hay AHORA en ese momento ya no es el que se confirmó: pasa
    // cuando el hogar espeja por detrás un cambio del planificador sobre una
    // comida compartida, nunca por una recolocación automática (que no toca
    // hoy). Se trata como una comida nueva — si no, Hoy seguía marcando como
    // "ya comido" un plato distinto al que de verdad se sirvió, y la barra de
    // macros sumaba las kcal congeladas del plato antiguo bajo el nombre del
    // nuevo.
    if (
      existing.status &&
      existing.status !== "salteo" &&
      existing.confirmedIdea &&
      existing.confirmedIdea !== m.idea
    ) {
      return { label: m.moment, done: false, plannedIdea: m.idea || undefined };
    }
    // `plannedIdea` solo se rellena si falta: una vez congelado no se toca ni
    // aunque el plato del plan haya cambiado (que es justo lo que pasa tras un
    // cambio a mano — `setPlanMeal` escribe el plato nuevo en el plan).
    return existing.plannedIdea || !m.idea
      ? existing
      : { ...existing, plannedIdea: existing.wasIdea || m.idea };
  });
  // Comparación por identidad: las comidas que no cambian se devuelven tal
  // cual, así que basta con mirar si alguna posición trae otro objeto. También
  // detecta un reordenado, que se aprovecha para dejar el registro en el mismo
  // orden que el plan (y por tanto no vuelve a dispararse a la siguiente).
  const changed = next.length !== previous.length || next.some((h, i) => h !== previous[i]);
  return { habits: next, changed };
}

/**
 * Igualdad estructural entre dos listas de comidas del registro del día.
 *
 * `daily_logs.habits` es una única columna JSON con dos escritores de
 * estrategias distintas: `patchTodayHabits` (relee la fila justo antes de
 * escribir) y el guardado de la reconciliación de Hoy, que manda la lista
 * entera que tenía en memoria. Antes de reescribir la columna con lo segundo
 * hay que comprobar que la fila sigue siendo la que se reconcilió; si no, un
 * cambio de plato hecho a la vez (que escribe `status`/`done`/`confirmedIdea`)
 * se perdía debajo de una lista construida desde la caché vieja.
 *
 * Compara el JSON tal y como vuelve de Postgres, donde una clave puesta a
 * `undefined` sencillamente no existe: `{done:false}` y
 * `{done:false, status:undefined}` son la misma comida.
 */
export function sameHabits(
  a: readonly MealHabit[] | null | undefined,
  b: readonly MealHabit[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((h, i) => sameJson(h, right[i]));
}

/** Igualdad estructural sobre valores JSON — ver `sameHabits`. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameJson(v, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set(Object.keys(left).concat(Object.keys(right)));
  for (const key of keys) {
    if (!sameJson(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Platos aparte de un niño para una fecha (issue 07): devuelve solo los slots
 * con override propio para ese niño; en el resto de comidas el niño come el
 * plato compartido del día, así que no aparecen aquí.
 */
export function childMealsForDate(
  plan: MonthlyPlan | null,
  date: string,
  childId: string,
): { slot: MealSlot; dish: string; off: string[] }[] {
  const day = planForDate(plan, date)?.day;
  if (!day?.kids?.length) return [];
  return day.kids
    .filter((k) => k.childId === childId && k.dish)
    .map((k) => ({ slot: k.slot, dish: k.dish, off: k.off ?? [] }));
}

export type ChildPureeGap = { date: string; slot: "comida" | "cena" };

/**
 * Días (de `today` a fin de mes) en los que un bebé de triturados come en casa
 * pero el plan todavía no tiene su puré para esa comida — pasa cuando se da de
 * alta o se cambia de etapa a un bebé DESPUÉS de generar el plan del mes, ya
 * que solo la IA de `generateMonthlyPlan` rellena `days[].kids`. Solo mira
 * comida y cena (igual que el prompt de generación): el desayuno y el snack no
 * llevan plato aparte de un niño. Nunca mira hacia atrás: un día pasado no se
 * puede recolocar.
 */
export function childPureeGaps(
  plan: MonthlyPlan | null,
  child: { id: string; stage: FeedingStage; homeSchedule: HomeSchedule },
  today: string,
): ChildPureeGap[] {
  if (!plan || child.stage !== "triturados") return [];
  const month = today.slice(0, 7);
  const gaps: ChildPureeGap[] = [];
  for (let i = 0; ; i++) {
    const date = addDays(today, i);
    if (date.slice(0, 7) !== month) break;
    const day = planForDate(plan, date)?.day;
    if (!day) continue;
    const { dayIndex } = planCursor(date);
    for (const slot of ["comida", "cena"] as const) {
      if (!isSharedSlot(child.homeSchedule, slot, dayIndex)) continue;
      const hasEntry = (day.kids ?? []).some((k) => k.childId === child.id && k.slot === slot);
      if (!hasEntry) gaps.push({ date, slot });
    }
  }
  return gaps;
}

/**
 * Marcas de "elegido a mano" de un día de un miembro del hogar tras espejar las
 * comidas compartidas: igual que el plato de un niño, la marca viaja con su
 * comida. En un slot compartido manda la del planificador (el plato es suyo) y
 * en el resto se conserva la propia. Si no, un miembro que tenía fijada su cena
 * en solitario seguiría protegiendo el plato del planificador cuando esa cena
 * pasa a ser compartida.
 */
export function mirrorPinned(
  own: PlanDay,
  source: PlanDay,
  sharedSlots: ReadonlySet<string>,
): MealSlot[] | undefined {
  const pins = new Set([
    ...(own.pinned ?? []).filter((s) => !sharedSlots.has(s)),
    ...(source.pinned ?? []).filter((s) => sharedSlots.has(s)),
  ]);
  const ordered = MEAL_SLOTS.filter((s) => pins.has(s));
  return ordered.length ? ordered : undefined;
}

/**
 * El día que ve un miembro del hogar (issue 05, D1): las comidas compartidas
 * ese día de la semana muestran el plato del planificador; las demás, el
 * suyo propio. `weekday` es el índice de día dentro de la semana del plan
 * (0=lunes…6=domingo, igual que `SharedSlots`), no un índice de calendario.
 * Lectura en vivo, válida para cualquier día — a diferencia del espejo de
 * `syncSharedMeals` (que solo escribe hacia adelante), esto no muta nada.
 */
export function composeDayForUser(
  mineDay: PlanDay,
  plannerDay: PlanDay | undefined,
  sharedSlots: SharedSlots,
  weekday: number,
): PlanDay {
  if (!plannerDay) return mineDay;
  const shared = MEAL_KEYS.filter((m) => isSharedSlot(sharedSlots, m, weekday));
  if (!shared.length) return mineDay;

  const extras = { ...(mineDay.extras ?? {}) };
  for (const meal of shared) {
    const mark = plannerDay.extras?.[meal];
    if (mark?.length) extras[meal] = mark;
    else delete extras[meal];
  }

  const next: PlanDay = {
    ...mineDay,
    lunch: shared.includes("comida") ? plannerDay.lunch || mineDay.lunch : mineDay.lunch,
    dinner: shared.includes("cena") ? plannerDay.dinner || mineDay.dinner : mineDay.dinner,
    ...(shared.includes("desayuno") && plannerDay.breakfast
      ? { breakfast: plannerDay.breakfast }
      : {}),
  };
  if (Object.keys(extras).length) next.extras = extras;
  else delete next.extras;

  // El plato aparte de un niño (issue 07) lo pone el planificador y va con la
  // comida compartida: se trae el del planificador para un slot compartido y se
  // conserva el propio (raro) para un slot que ese día no se comparte.
  const sharedSet = new Set<string>(shared);
  const kids = [
    ...(mineDay.kids ?? []).filter((k) => !sharedSet.has(k.slot)),
    ...(plannerDay.kids ?? []).filter((k) => sharedSet.has(k.slot)),
  ];
  // Si el resultado son los mismos platos que ya había, se deja el array tal
  // cual: recomponer un día que no cambia (quien planifica congelando sus
  // compartidas) no debe reescribirlo solo por cambiarles el orden.
  const kidsKey = (list: readonly ChildMeal[]) =>
    list
      .map((k) => JSON.stringify(k))
      .sort()
      .join("|");
  if (kids.length) {
    next.kids = mineDay.kids && kidsKey(mineDay.kids) === kidsKey(kids) ? mineDay.kids : kids;
  } else delete next.kids;

  const pinned = mirrorPinned(mineDay, plannerDay, sharedSet);
  if (pinned) next.pinned = pinned;
  else delete next.pinned;
  return next;
}

/**
 * El plan mensual que ve un miembro del hogar: compone cada día con
 * `composeDayForUser` y, cuando el desayuno se comparte, también sustituye la
 * rotación semanal (`week.breakfasts`) por la del planificador — igual que
 * hace `syncSharedMeals`, porque un desayuno sin plato a mano para ESE día
 * rota entre las ideas de la semana, y esas ideas tienen que ser las de la
 * casa, no las propias. Sin plan propio (`mine` null) compone igualmente,
 * sobre un esqueleto en blanco con los mismos rótulos de semana/día que el
 * del planificador, para que las comidas compartidas se vean aunque la
 * persona no haya planificado nada suyo todavía.
 */
export function composeMonthlyPlanForMember(
  mine: MonthlyPlan | null,
  planner: MonthlyPlan | null,
  sharedSlots: SharedSlots,
): MonthlyPlan | null {
  if (!planner || !MEAL_KEYS.some((m) => sharedSlots[m].length)) return mine;

  const base: MonthlyPlan =
    mine ??
    ({
      intro: "",
      focus: [],
      weeks: planner.weeks.map((w) => ({
        label: w.label,
        focus: "",
        breakfasts: [],
        snacks: [],
        days: w.days.map((d) => ({ day: d.day, lunch: "", dinner: "" })),
      })),
      coverage: planner.coverage,
      cadence: planner.cadence,
    } satisfies MonthlyPlan);

  return {
    ...base,
    weeks: base.weeks.map((week, wi) => {
      const plannerWeek = planner.weeks[wi];
      if (!plannerWeek) return week;
      return {
        ...week,
        breakfasts:
          sharedSlots.desayuno.length && plannerWeek.breakfasts.length
            ? plannerWeek.breakfasts
            : week.breakfasts,
        days: week.days.map((day, di) =>
          composeDayForUser(day, plannerWeek.days[di], sharedSlots, di),
        ),
      };
    }),
  };
}

/** Aviso corto para pantalla cuando un plato lleva algo que no se compró. */
export const offListNote = (names: string[] | undefined) =>
  names?.length ? `Fuera de tu compra: ${names.join(", ")}` : null;

// ---------------------------------------------------------------------------
// Diff de platos futuros tras un ajuste del plan
// ---------------------------------------------------------------------------

/**
 * Un plato del plan que cambió entre la versión anterior y la posterior de un
 * `adjustMonthlyPlan`. Usado por el badge "i" de Hoy para mostrar qué efecto
 * tuvo el cambio de plato en el plan futuro.
 */
export type MealChange = {
  date: string;
  slot: MealSlot;
  slotLabel: string;
  before: string;
  after: string;
};

/**
 * Compara los platos de los días FUTUROS (posteriores a `today`) entre dos
 * versiones del plan y devuelve los que cambiaron. Ignora el día de hoy y
 * anteriores (están fijados). Compara solo lunch y dinner — desayunos y snacks
 * no los recoloca `adjustMonthlyPlan` (giran por semana, no por día).
 */
export function diffFutureMeals(
  before: MonthlyPlan | null,
  after: MonthlyPlan | null,
  today: string,
): MealChange[] {
  if (!before || !after) return [];
  const month = today.slice(0, 7);
  const changes: MealChange[] = [];
  const totalDays = daysInMonth(month);

  for (let d = 1; d <= totalDays; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    if (date <= today) continue; // solo días futuros

    const mealsBefore = mealsForDate(before, date);
    const mealsAfter = mealsForDate(after, date);

    for (const mb of mealsBefore) {
      // Solo comparar comida y cena — lo que adjustMonthlyPlan recoloca
      if (mb.slot !== "comida" && mb.slot !== "cena") continue;
      const ma = mealsAfter.find((m) => m.slot === mb.slot);
      if (ma && ma.idea && mb.idea && ma.idea !== mb.idea) {
        changes.push({
          date,
          slot: mb.slot,
          slotLabel: MEAL_SLOT_LABEL[mb.slot],
          before: mb.idea,
          after: ma.idea,
        });
      }
    }
  }
  return changes;
}

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Días hacia delante en los que se reparte una compensación. */
export const COMPENSATION_WINDOW_DAYS = 6;

/**
 * Fechas en las que se puede absorber un desvío de HOY (el picoteo, y más
 * adelante cualquier cambio de plato, ticket 08 de `hoy-semanas-editables`):
 * de mañana a hoy + `days`, dentro del mismo mes.
 *
 * Solo quedan las fechas con al menos una comida o cena PROPIA ese día: un
 * desvío personal se corrige en las comidas no compartidas de esa persona,
 * nunca cambiando la mesa de toda la casa. Y solo las que son la fecha real de
 * su celda (`dateOfPlanCell`): los días 29 en adelante comparten celda con la
 * semana 3 y una recolocación sobre ellos se descarta, así que ofrecerlos
 * gastaría una llamada a la IA que no puede cambiar nada.
 *
 * `reason` explica una ventana vacía: `no-meals` (no planifica comidas ni
 * cenas), `no-days` (se acaba el mes) o `shared-only` (quedan días, pero todas
 * sus comidas y cenas son de la casa).
 */
export function compensationWindow(opts: {
  today: string;
  sharedSlots: SharedSlots;
  selectedSlots: readonly MealSlot[];
  /**
   * Sin otro adulto con quien compartir la mesa, "compartido" no protege a
   * nadie más: se tratan como propias igualmente (p. ej. una persona adulta
   * sola con peques a cargo).
   */
  soloAdult?: boolean;
  days?: number;
}): { dates: string[]; reason: "no-meals" | "no-days" | "shared-only" | null } {
  const month = opts.today.slice(0, 7);
  const days = opts.days ?? COMPENSATION_WINDOW_DAYS;
  const movable = (["comida", "cena"] as const).filter((s) => opts.selectedSlots.includes(s));
  if (!movable.length) return { dates: [], reason: "no-meals" };
  const inMonth: string[] = [];
  const dates: string[] = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(opts.today, i);
    if (date.slice(0, 7) !== month) break;
    const { weekIndex, dayIndex } = planCursor(date);
    if (dateOfPlanCell(month, weekIndex, dayIndex) !== date) continue;
    inMonth.push(date);
    if (opts.soloAdult || movable.some((slot) => !isSharedSlot(opts.sharedSlots, slot, dayIndex)))
      dates.push(date);
  }
  if (dates.length) return { dates, reason: null };
  return { dates, reason: inMonth.length ? "shared-only" : "no-days" };
}

/** Menú de los próximos días, para que el coach sepa qué está cambiando. */
export function upcomingMeals(plan: MonthlyPlan | null, today: string, days = 7) {
  if (!plan) return [];
  const month = today.slice(0, 7);
  const out: Record<string, string>[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (date.slice(0, 7) !== month) break;
    out.push({
      fecha: date,
      dia: weekdayName(date),
      ...Object.fromEntries(mealsForDate(plan, date).map((m) => [m.slot, m.idea])),
    });
  }
  return out;
}

/**
 * Lo que el coach necesita saber del plan en cada mensaje: qué hay comprado
 * (para proponer platos con eso) y qué menú tienen los próximos días (para
 * saber qué está sustituyendo cuando le piden cambiar un plato).
 */
export function coachPlanContext(
  row:
    | {
        plan: MonthlyPlan | null;
        shopping: ShoppingList | null;
        confirmed_at: string | null;
        pantry_extras?: PantryExtra[] | null;
      }
    | null
    | undefined,
  today: string,
) {
  if (!row?.plan) return { compra: null, proximos: [], despensa_extra: [] };
  return {
    compra: {
      confirmada: Boolean(row.confirmed_at),
      ingredientes: (row.shopping ?? []).flatMap((g) => g.items.map((i) => i.name)),
    },
    // Ingredientes que la persona dice tener en casa fuera de la lista de la
    // compra: el coach puede proponer platos con ellos, pero no cuentan como
    // "comprados" ni entran en la lista.
    despensa_extra: (row.pantry_extras ?? []).map((e) => e.name),
    proximos: upcomingMeals(row.plan, today),
  };
}

/** Texto plano de los ingredientes del mes, listo para compartir o descargar. */
export const shoppingToText = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  month: string,
  coverage?: PlanCoverage,
) => {
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const lines = [`Ingredientes del mes · ${monthLabel}`, `Frecuencia: ${cadence}`, ""];
  const cov = coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const trips = tripsForCoverage(cadence, cov);
  for (const trip of projectTrips(shopping, cadence, cov)) {
    lines.push(
      `${tripLabel(cadence, trip.trip, coverage, trips)} — ${eur(pendingTotal(trip.groups))}`,
    );
    for (const group of trip.groups) {
      lines.push(`  ${group.category}`);
      for (const item of group.items) {
        const qty = item.qty ? ` (${item.qty})` : "";
        lines.push(`   - ${item.name}${qty} — ${eur(item.price_eur)}`);
      }
    }
    lines.push("");
  }
  lines.push(`Total del mes: ${eur(shoppingTotal(shopping))}`);
  return lines.join("\n");
};

/**
 * Texto plano de un solo tramo de ingredientes, listo para compartir aparte —
 * cada tramo es una lista distinta, así que compartirlo no manda todo el mes.
 */
export const tripToText = (
  trip: { groups: { category: string; items: ShoppingItem[] }[] },
  label: string,
) => {
  const lines = [`${label} — ${eur(pendingTotal(trip.groups))}`, ""];
  for (const group of trip.groups) {
    lines.push(group.category);
    for (const item of group.items) {
      const qty = item.qty ? ` (${item.qty})` : "";
      lines.push(`  - ${item.name}${qty} — ${eur(item.price_eur)}`);
    }
  }
  return lines.join("\n");
};
