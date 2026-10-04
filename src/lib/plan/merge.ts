import { concreteDish } from "@/lib/plan-concrete-dish";
import type { ShoppingCadence, ShoppingList } from "../shopping/model";
import { carryOwnedCanonical } from "../shopping/trips";
import { dateOfPlanCell, normDay, planSlotIndex } from "./grid";
import { cleanKcalAdjust } from "./parse";
import { MEAL_SLOT_FIELD, MEAL_SLOTS, type MealSlot } from "./slots";
import {
  type ChildMeal,
  isPinned,
  type MonthlyPlan,
  type PlanCoverage,
  type PlanDay,
} from "./types";

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
    ...(current.cadenceFrom ? { cadenceFrom: current.cadenceFrom } : {}),
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
