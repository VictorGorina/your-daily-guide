import type { HouseholdState } from "./household";
import {
  EMPTY_SCHEDULE,
  isSharedSlot,
  whoIsHome,
  type MealKey,
  type SharedSlots,
} from "./household-shared";
import { childMealsForDate, type MonthlyPlan } from "./plan-shared";

// Lo que la tira de comidas de Hoy necesita saber de cada momento del día y de
// quién se sienta a la mesa. Puro: la pantalla y `MealStrip` lo comparten.

// Orden cronológico aproximado de cada momento, para saber cuál toca ahora.
export const MOMENT_RANK: Record<string, number> = {
  Desayuno: 0,
  Comida: 1,
  Merienda: 2,
  Snack: 2,
  Cena: 3,
};
export const rankOf = (label: string) => MOMENT_RANK[label] ?? 1.5;

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
    return { meHome: true, others: [] as { id: string; displayName: string; portion: number }[] };
  }
  const others = hMembers
    .filter((m) => m.user_id !== household?.me?.user_id)
    .map((m) => ({ id: m.id, displayName: m.display_name, portion: m.portion }));
  return { meHome: true, others };
}

/** Platos aparte de los niños de la casa para ese momento del día (issue 07). */
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
