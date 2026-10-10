import type { HouseholdState } from "@/lib/household";
import {
  EMPTY_SCHEDULE,
  isSharedSlot,
  whoIsHome,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";
import { childMealsForDate, type MonthlyPlan } from "@/lib/plan-shared";

// Lo que la tira de comidas de Hoy necesita saber de cada momento del día y de
// quién se sienta a la mesa. Puro: la pantalla y `MealStrip` lo comparten.
// Copia en `mobile/lib/today-meals.ts`.

// Orden cronológico aproximado de cada momento, para saber cuál toca ahora.
// Las comidas que no aparecen (nombres personalizados desde el chat) caen
// en un rango intermedio en vez de romper el orden.
export const MOMENT_RANK: Record<string, number> = {
  Desayuno: 0,
  Comida: 1,
  Merienda: 2,
  Snack: 2,
  Cena: 3,
};
export const rankOf = (label: string) => MOMENT_RANK[label] ?? 1.5;

// Hora orientativa de cada momento del día. La app no guarda horas por comida
// (el perfil solo tiene `meal_schedule` en texto libre), así que la tira usa
// estas de referencia; un momento con nombre propio simplemente no muestra
// hora. Coherentes con MOMENT_RANK para que la tira se lea de arriba abajo.
export const MOMENT_TIME: Record<string, string> = {
  Desayuno: "8:30",
  Almuerzo: "11:00",
  Comida: "14:00",
  Merienda: "17:30",
  Snack: "17:30",
  Cena: "20:30",
};

// Solo desayuno/comida/cena pueden ser comidas compartidas del hogar (el snack no).
export const MOMENT_TO_MEAL_KEY: Record<string, MealKey | undefined> = {
  Desayuno: "desayuno",
  Comida: "comida",
  Cena: "cena",
};

/** Who is eating at home for this meal today? Returns null if no household or not a main meal. */
export function mealCompanions(
  household: HouseholdState | null | undefined,
  sharedSlots: SharedSlots | null,
  label: string,
  weekday: number,
) {
  const mealKey = MOMENT_TO_MEAL_KEY[label];
  if (!mealKey) return null;
  const hMembers = household?.members ?? [];
  const hChildren = household?.children ?? [];
  if (!hMembers.length) return null;
  const hasSchedules =
    hMembers.some((m) => m.home_schedule != null) || hChildren.some((c) => c.home_schedule != null);
  if (hasSchedules) {
    // Quien no ha configurado su horario hereda los días compartidos del
    // hogar, no "nunca en casa" — así un horario a medias no borra la mesa.
    const baseline = household?.household?.shared_slots ?? EMPTY_SCHEDULE;
    const { people } = whoIsHome(
      hMembers.map((m) => ({
        id: m.id,
        displayName: m.display_name,
        portion: m.portion,
        isPlanner: m.is_planner,
        homeSchedule: m.home_schedule ?? baseline,
      })),
      hChildren.map((c) => ({
        id: c.id,
        name: c.name,
        portion: c.portion,
        homeSchedule: c.home_schedule ?? baseline,
        stage: c.feeding_stage,
      })),
      mealKey,
      weekday,
    );
    const myMemberId = household?.me?.id;
    const meHome = people.some((p) => p.id === myMemberId);
    const others = people.filter((p) => p.id !== myMemberId);
    return { meHome, others };
  }
  // Nadie tiene horario: se comparte lo que diga la columna del hogar.
  if (!sharedSlots || !isSharedSlot(sharedSlots, mealKey, weekday)) {
    return { meHome: true, others: [] };
  }
  const others = hMembers
    .filter((m) => m.user_id !== household?.me?.user_id)
    .map((m) => ({ id: m.id, displayName: m.display_name, portion: m.portion }));
  return { meHome: true, others };
}

/**
 * Platos aparte de los niños de la casa para ese momento del día (issue 07):
 * el plato compartido no les sirve ese día y el plan lleva el suyo.
 */
export function childMealsFor(
  household: HouseholdState | null | undefined,
  plan: MonthlyPlan | null,
  date: string,
  label: string,
) {
  const mealKey = MOMENT_TO_MEAL_KEY[label];
  const kids = household?.children ?? [];
  if (!mealKey || !kids.length) return [];
  return kids.flatMap((c) =>
    childMealsForDate(plan, date, c.id)
      .filter((k) => k.slot === mealKey)
      .map((k) => ({ name: c.name, dish: k.dish, off: k.off })),
  );
}
