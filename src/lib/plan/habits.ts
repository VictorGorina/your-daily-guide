import type { MealChange } from "./compensation";
import { planCursor, planForDate } from "./grid";
import { MEAL_SLOT_LABEL, type MealSlot } from "./slots";
import type { MonthlyPlan } from "./types";

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
