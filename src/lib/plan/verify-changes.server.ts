import type { ProfilePart } from "@/integrations/supabase/db-client";
import type { Deadline } from "@/lib/deadline";
import type { SharedServing } from "@/lib/household.server";
import {
  addKcalAdjust,
  applyPlanChanges,
  effectiveMealSlots,
  type KcalAdjustCell,
  type MonthlyPlan,
  type PlanChange,
  type ShoppingList,
} from "@/lib/plan-shared";

type MealKey = "desayuno" | "comida" | "cena";

/** Por qué no entra un cambio de plato. */
export type DroppedChange = {
  date: string;
  slot: "comida" | "cena";
  dish: string;
  /** Sin receta no se sabe qué pide ni si encaja (D13); "compra": le falta algo ese día. */
  why: "sin-receta" | "compra" | "objetivo";
};

/** Un plato nuevo puede dejar el día así de peor y seguir valiendo (ruido de redondeo). */
const MAX_LOSS = 0.005;

/**
 * Un cambio de plato que hace la app por su cuenta (el balance del día, el
 * coach, la despensa) se queda solo si el plato nuevo se puede cocinar con lo
 * que hay en casa ese día (su compra y la despensa extra) y deja el día igual o
 * más cerca de su objetivo, con su receta (decisión del usuario, 2026-10-27).
 * Con los dos platos de un día se prueba también cada uno solo, y se queda la
 * mejor combinación que cumple.
 *
 * `moved` es lo que la compensación mueve a cada comida (`addKcalAdjust`): el
 * día nuevo se mide con su objetivo ya ajustado, o aligerar una cena para
 * compensar un exceso contaría como alejarse del objetivo.
 */
export async function verifyPlanChanges(opts: {
  plan: MonthlyPlan;
  changes: readonly PlanChange[];
  moved: readonly KcalAdjustCell[];
  month: string;
  today: string;
  shopping: ShoppingList;
  pantry: readonly string[];
  profile: ProfilePart | null;
  shared: (date: string) => Partial<Record<MealKey, SharedServing>>;
  apiKey: string;
  userId: string;
  deadline?: Deadline;
}): Promise<{ kept: PlanChange[]; dropped: DroppedChange[] }> {
  const { plan, today } = opts;
  if (!opts.changes.length) return { kept: [], dropped: [] };
  const [coverage, { getRecipes }, { energyTargets }, { portionFactors }, fit, { dayScore }] =
    await Promise.all([
      import("@/lib/shopping/coverage.server"),
      import("@/lib/nutrition/recipes.server"),
      import("@/lib/nutrition/energy"),
      import("@/lib/nutrition/portion"),
      import("@/lib/nutrition/plan-fit.server"),
      import("@/lib/nutrition/plan-fit"),
    ]);
  const { mealsForDate } = await import("@/lib/plan-shared");
  const selected = effectiveMealSlots(opts.profile ?? {});

  // Las recetas de los platos nuevos y de todo lo que comen esos días.
  const dates = [...new Set(opts.changes.map((c) => c.date))];
  const dishes = [
    ...opts.changes.flatMap((c) => [c.lunch, c.dinner].filter((d): d is string => !!d)),
    ...dates.flatMap((date) => mealsForDate(plan, date, selected).map((m) => m.idea)),
  ];
  const recipes = await getRecipes(dishes, {
    apiKey: opts.apiKey,
    userId: opts.userId,
    deadline: opts.deadline,
  });
  const available = coverage.availableByDay({
    plan,
    shopping: opts.shopping,
    month: opts.month,
    pantry: opts.pantry,
  });

  const dropped: DroppedChange[] = [];
  const cookable = (date: string, slot: "comida" | "cena", dish: string): boolean => {
    const recipe = recipes.get(dish.trim())?.recipe;
    if (!recipe) {
      dropped.push({ date, slot, dish, why: "sin-receta" });
      return false;
    }
    const home = available(Number(date.slice(8, 10)));
    const missing = recipe.ingredients
      .map((ing) => coverage.familyOfFood(ing.foodKey))
      .some((family) => !coverage.isKitchenBasic(family) && !home.has(family));
    if (missing) dropped.push({ date, slot, dish, why: "compra" });
    return !missing;
  };

  const energy = energyTargets(opts.profile);
  const own = energy ? portionFactors(energy, opts.profile) : null;
  const score = (p: MonthlyPlan, date: string) =>
    dayScore(
      fit.fitDayOf({
        plan: p,
        date,
        energy: energy!,
        own: own!,
        selected,
        shared: opts.shared(date),
        recipes,
      }),
      { highProtein: fit.isHighProtein(energy!) },
    );

  const kept: PlanChange[] = [];
  for (const change of opts.changes) {
    const lunch =
      change.lunch && cookable(change.date, "comida", change.lunch) ? change.lunch : undefined;
    const dinner =
      change.dinner && cookable(change.date, "cena", change.dinner) ? change.dinner : undefined;
    if (!lunch && !dinner) continue;
    // Sin objetivo (menor de edad, faltan datos) no hay día con el que comparar.
    if (!energy) {
      kept.push({ date: change.date, ...(lunch ? { lunch } : {}), ...(dinner ? { dinner } : {}) });
      continue;
    }
    const base = score(plan, change.date);
    const variants: PlanChange[] = [
      ...(lunch && dinner ? [{ date: change.date, lunch, dinner }] : []),
      ...(lunch ? [{ date: change.date, lunch }] : []),
      ...(dinner ? [{ date: change.date, dinner }] : []),
    ];
    let best: { variant: PlanChange; score: number } | null = null;
    for (const variant of variants) {
      const slots = [variant.lunch ? "comida" : null, variant.dinner ? "cena" : null];
      const cells = opts.moved.filter((c) => c.date === change.date && slots.includes(c.slot));
      const candidate = addKcalAdjust(applyPlanChanges(plan, [variant], today), cells, today);
      const s = score(candidate, change.date);
      if (s <= base + MAX_LOSS && (!best || s < best.score)) best = { variant, score: s };
    }
    for (const [slot, dish] of [
      ["comida", lunch],
      ["cena", dinner],
    ] as const) {
      if (!dish) continue;
      const keptIt = slot === "comida" ? best?.variant.lunch : best?.variant.dinner;
      if (!keptIt) dropped.push({ date: change.date, slot, dish, why: "objetivo" });
    }
    if (best) kept.push(best.variant);
  }
  return { kept, dropped };
}
