/**
 * La ronda de corrección del plan (ticket 10 de `precision-nutricional`):
 * recetas del mes → `planFit` → UNA petición de cambios al modelo → se queda
 * cada cambio solo si el día mejora de verdad (`dayScore`) → `planFit` otra vez
 * para el informe. Nunca hay una segunda ronda: lo que siga sin encajar se
 * acepta con su residuo.
 *
 * Va DESPUÉS del precalentado de recetas (`recipe-warm.ts`), no dentro de la
 * generación: generar el plan ya tarda ~100 s y descomponer los ~50 platos del
 * mes no cabe en los 300 s de una función. Tras el precalentado todas las
 * recetas están en la caché global y esto solo lee; lo nuevo son los pocos
 * platos que proponga el modelo.
 *
 * La llamada al modelo se inyecta (`ask`): producción la hace con `askForJson`
 * (`fitMonthlyPlan`) y el eval con el mismo generador. Solo en servidor.
 */

import type { SharedServing } from "@/lib/household.server";
import {
  applyPlanChanges,
  applyPlanFitChanges,
  effectiveMealSlots,
  isPinned,
  isPlanWeekAhead,
  mealsForDate,
  planCursor,
  planDayOf,
  planSlotIndex,
  type MonthlyPlan,
  type PlanChange,
  type PlanFitChange,
} from "@/lib/plan-shared";

import { energyTargets } from "./energy";
import {
  dayScore,
  planFit,
  type FitDay,
  type FitOptions,
  type Misfit,
  type WeeklyIdea,
} from "./plan-fit";
import { resolveServing, type ServingContext } from "./planned-serving.server";
import { portionFactors } from "./portion";
import { getRecipes, type RecipeLookup } from "./recipes.server";
import { recipeSlotOfMoment } from "./validate-recipe";

type MealKey = "desayuno" | "comida" | "cena";

export type PlanFitReport = {
  /** Días que encajan / días medidos, antes y después de la ronda. */
  before: number;
  after: number;
  measuredDays: number;
  misfits: number;
  changed: PlanFitChange[];
  /** Cambios del modelo que no mejoraban su día (o no se pudieron calcular). */
  discarded: number;
  skipped?: "sin-objetivo" | "encaja";
  /** Segundos de cada fase: recetas del plan, petición al modelo, recetas nuevas. */
  seconds?: { recipes: number; ask: number; newRecipes: number };
};

/** Una idea semanal de desayuno o merienda que no deja encajar sus días. */
export type RotationMisfit = {
  week: number;
  option: number;
  slot: "desayuno" | "snack";
  /** El primero de sus días que no encaja (motivo y objetivo de la comida). */
  misfit: Misfit;
  dates: string[];
};

/**
 * Tope de platos (comida/cena) e ideas semanales por ronda. En el eval, 6
 * platos nuevos costaron 57 s de recetas y la petición 38 s; con estos topes la
 * ronda de un mes cabe con holgura en los 300 s de una función.
 */
const MAX_DISHES = 20;
const MAX_IDEAS = 8;

/** Un cambio de plato mejora el día si baja su puntuación al menos esto. */
const MIN_GAIN = 0.005;

export async function fitPlanMeals(opts: {
  plan: MonthlyPlan;
  month: string;
  /** Solo se tocan (y se miden) los días posteriores a esta fecha. */
  after: string;
  profile: unknown;
  /** Comidas compartidas del hogar de cada fecha (`sharedMealPortionsByDate`). */
  shared: (date: string) => Partial<Record<MealKey, SharedServing>>;
  /** Quien genera puede cambiar una compartida (planificador o en solitario). */
  canTouchShared: boolean;
  apiKey: string;
  userId: string | null;
  /**
   * Pide los cambios al modelo: platos de comida y cena (lista ya limpia de
   * `cleanReflowChanges`) e ideas semanales de desayuno y merienda.
   */
  ask: (
    misfits: Misfit[],
    rotations: RotationMisfit[],
  ) => Promise<{ changes: PlanChange[]; ideas: WeeklyIdea[] }>;
}): Promise<{ plan: MonthlyPlan; report: PlanFitReport }> {
  const { plan, month, after, profile } = opts;
  const energy = energyTargets(profile as never);
  const empty = { before: 1, after: 1, measuredDays: 0, misfits: 0, changed: [], discarded: 0 };
  if (!energy) return { plan, report: { ...empty, skipped: "sin-objetivo" } };

  const own = portionFactors(energy, profile as { sex?: string | null } | null);
  const selected = effectiveMealSlots(
    (profile ?? {}) as { meal_slots?: unknown; meals_to_plan?: string | null },
  );
  const fitOptions: FitOptions = {
    canTouchShared: opts.canTouchShared,
    highProtein: energy.protein_g / Math.max(1, energy.basis.refWeightKg) >= 1.6,
  };

  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = plan.coverage?.fromDay ?? 1;
  const to = Math.min(plan.coverage?.toDay ?? last, last);
  const dates = Array.from(
    { length: Math.max(0, to - from + 1) },
    (_, i) => `${month}-${String(from + i).padStart(2, "0")}`,
  ).filter((date) => date > after);

  const recipes = new Map<string, RecipeLookup>();
  const loadRecipes = async (meals: { idea: string; moment: string }[]) => {
    const missing = meals.filter((meal) => meal.idea.trim() && !recipes.has(meal.idea.trim()));
    if (!missing.length) return;
    const found = await getRecipes(
      missing.map((meal) => meal.idea),
      {
        apiKey: opts.apiKey,
        userId: opts.userId,
        slots: new Map(missing.map((meal) => [meal.idea.trim(), recipeSlotOfMoment(meal.moment)])),
      },
    );
    for (const [dish, lookup] of found) recipes.set(dish, lookup);
  };

  const buildDay = (p: MonthlyPlan, date: string): FitDay => {
    const ctx: ServingContext = {
      own,
      energy,
      shared: opts.shared(date),
      kcalAdjust: planDayOf(p, date)?.kcalAdjust,
    };
    return {
      date,
      meals: mealsForDate(p, date, selected).map((meal) => ({
        ...resolveServing(meal.moment, ctx),
        slot: meal.slot,
        dish: meal.idea,
        recipe: recipes.get(meal.idea.trim())?.recipe ?? null,
      })),
    };
  };
  const measure = (p: MonthlyPlan) =>
    planFit(
      dates.map((date) => buildDay(p, date)),
      fitOptions,
    );

  const clock = () => performance.now() / 1000;
  const t0 = clock();
  await loadRecipes(dates.flatMap((date) => mealsForDate(plan, date, selected)));
  const t1 = clock();
  const first = measure(plan);
  const measuredDays = first.days.filter((d) => d.measured).length;
  // Un plato elegido a mano no lo cambia nadie (`applyPlanChanges` tampoco).
  const misfits = first.misfits.filter((mf) => !isPinned(planDayOf(plan, mf.date), mf.slot));
  // Los días que peor encajan primero, y con tope: cada plato nuevo es una
  // receta que descomponer dentro de la misma función (300 s).
  const dayScoreOf = new Map(first.days.map((d) => [d.date, d.score]));
  const worstFirst = [...misfits].sort(
    (a, b) => (dayScoreOf.get(b.date) ?? 0) - (dayScoreOf.get(a.date) ?? 0),
  );
  const mainMisfits = worstFirst
    .filter((mf) => mf.slot === "comida" || mf.slot === "cena")
    .slice(0, MAX_DISHES);

  // Desayuno y merienda son ideas de la semana: se agrupan por idea. Solo en
  // semanas enteramente futuras (cambiar la idea reescribiría también lo que
  // enseñan los días pasados) y, si el desayuno se comparte en casa, solo quien
  // planifica (`syncSharedMeals` copia sus ideas a los demás).
  const breakfastShared = dates.some((date) => !!opts.shared(date).desayuno);
  const rotationMisfits = new Map<string, RotationMisfit>();
  for (const mf of worstFirst) {
    if (mf.slot !== "desayuno" && mf.slot !== "snack") continue;
    if (mf.slot === "desayuno" && breakfastShared && !opts.canTouchShared) continue;
    const at = rotationOf(plan, mf.date, mf.slot);
    if (!at || !isPlanWeekAhead(month, at.week, after)) continue;
    const key = `${at.week}|${mf.slot}|${at.option}`;
    const found = rotationMisfits.get(key);
    if (!found && rotationMisfits.size >= MAX_IDEAS) continue;
    if (found) found.dates.push(mf.date);
    else rotationMisfits.set(key, { ...at, slot: mf.slot, misfit: mf, dates: [mf.date] });
  }

  if (!mainMisfits.length && !rotationMisfits.size) {
    return {
      plan,
      report: {
        ...empty,
        before: first.fitPct,
        after: first.fitPct,
        measuredDays,
        skipped: "encaja",
      },
    };
  }

  // Solo las celdas señaladas: el modelo no reescribe un día que ya encaja.
  const wanted = new Set(mainMisfits.map((mf) => `${mf.date}|${mf.slot}`));
  const answer = await opts.ask(mainMisfits, [...rotationMisfits.values()]);
  const t2 = clock();
  const proposed = answer.changes
    .map((c) => ({
      date: c.date,
      ...(c.lunch && wanted.has(`${c.date}|comida`) ? { lunch: c.lunch } : {}),
      ...(c.dinner && wanted.has(`${c.date}|cena`) ? { dinner: c.dinner } : {}),
    }))
    .filter((c) => c.lunch || c.dinner);
  const ideas = answer.ideas.filter((idea) =>
    rotationMisfits.has(`${idea.week}|${idea.slot}|${idea.option}`),
  );
  await loadRecipes([
    ...proposed.flatMap((c) => [
      ...(c.lunch ? [{ idea: c.lunch, moment: "Comida" }] : []),
      ...(c.dinner ? [{ idea: c.dinner, moment: "Cena" }] : []),
    ]),
    ...ideas.map((idea) => ({
      idea: idea.dish,
      moment: idea.slot === "desayuno" ? "Desayuno" : "Merienda",
    })),
  ]);
  const t3 = clock();

  // Cada cambio se queda solo si mejora, y un plato nuevo que no se deja
  // calcular no entra: no se sabría si encaja (D13).
  const calculable = (dish?: string) => !dish || !!recipes.get(dish.trim())?.recipe;
  const score = (p: MonthlyPlan, days: readonly string[]) =>
    days.reduce((sum, date) => sum + dayScore(buildDay(p, date), fitOptions), 0);
  let next = plan;
  let discarded = 0;
  const changed: PlanFitChange[] = [];

  // Comida y cena: cada día con la mejor variante (las dos, solo la comida o
  // solo la cena).
  for (const change of proposed) {
    const variants: PlanChange[] = [
      change,
      ...(change.lunch && change.dinner
        ? [
            { date: change.date, lunch: change.lunch },
            { date: change.date, dinner: change.dinner },
          ]
        : []),
    ].filter((v) => calculable(v.lunch) && calculable(v.dinner));
    const base = score(next, [change.date]);
    let best: { variant: PlanChange; plan: MonthlyPlan; score: number } | null = null;
    for (const variant of variants) {
      const candidate = applyPlanChanges(next, [variant], after);
      const s = score(candidate, [change.date]);
      if (s < base - MIN_GAIN && (!best || s < best.score))
        best = { variant, plan: candidate, score: s };
    }
    const offered = (change.lunch ? 1 : 0) + (change.dinner ? 1 : 0);
    if (!best) {
      discarded += offered;
      continue;
    }
    const before = planDayOf(next, change.date);
    next = best.plan;
    const kept = (["lunch", "dinner"] as const).filter((k) => best.variant[k]);
    discarded += offered - kept.length;
    for (const k of kept) {
      changed.push({
        date: change.date,
        slot: k === "lunch" ? "comida" : "cena",
        from: before?.[k] ?? "",
        to: best.variant[k]!,
      });
    }
  }

  // Ideas de la semana: cuenta la suma de todos los días que la usan.
  for (const idea of ideas) {
    const list = idea.slot === "desayuno" ? "breakfasts" : "snacks";
    const from = next.weeks[idea.week]?.[list][idea.option];
    const days = dates.filter((date) => {
      const at = rotationOf(next, date, idea.slot);
      return at?.week === idea.week && at.option === idea.option;
    });
    if (!from || !days.length || !calculable(idea.dish)) {
      discarded += 1;
      continue;
    }
    const change: PlanFitChange = {
      date: days[0]!,
      slot: idea.slot === "desayuno" ? "desayuno" : "merienda",
      from,
      to: idea.dish,
      week: idea.week,
      option: idea.option,
      days: days.length,
    };
    const candidate = applyPlanFitChanges(next, [change], after).plan;
    if (score(candidate, days) < score(next, days) - MIN_GAIN) {
      next = candidate;
      changed.push(change);
    } else {
      discarded += 1;
    }
  }

  const final = measure(next);
  return {
    plan: next,
    report: {
      before: first.fitPct,
      after: final.fitPct,
      measuredDays,
      misfits: mainMisfits.length + rotationMisfits.size,
      changed,
      discarded,
      seconds: {
        recipes: Math.round(t1 - t0),
        ask: Math.round(t2 - t1),
        newRecipes: Math.round(t3 - t2),
      },
    },
  };
}

/** Qué idea de la semana sirve el desayuno o la merienda de `date` (null: puesta a mano). */
function rotationOf(
  p: MonthlyPlan,
  date: string,
  slot: "desayuno" | "snack",
): { week: number; option: number } | null {
  const at = planSlotIndex(p, date);
  const week = at ? p.weeks[at.weekIndex] : undefined;
  if (!at || !week) return null;
  const day = week.days[at.dayIndex];
  // Como en `mealsForDate`: un plato propio del día manda sobre la rotación.
  if (slot === "desayuno" ? day?.breakfast : day?.snack) return null;
  const list = slot === "desayuno" ? week.breakfasts : week.snacks;
  if (!list.length) return null;
  return { week: at.weekIndex, option: planCursor(date).dayIndex % list.length };
}
