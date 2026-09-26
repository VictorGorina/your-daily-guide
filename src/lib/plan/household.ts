import {
  type FeedingStage,
  type HomeSchedule,
  isSharedSlot,
  MEAL_KEYS,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";
import { addDays } from "./compensation";
import { planCursor, planForDate } from "./grid";
import { MEAL_SLOTS, type MealSlot } from "./slots";
import type { ChildMeal, MonthlyPlan, PlanDay } from "./types";

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
