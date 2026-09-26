/**
 * ¿El plan encaja con el objetivo? (ticket 10 de `precision-nutricional`).
 *
 * Cada plato se escala al objetivo de su comida (`scale.ts`) y el día se cierra
 * (`closeDay`), pero el escalado tiene límites para que el plato siga siendo el
 * mismo: una merluza con brócoli no llega a una comida de 465 kcal. `planFit`
 * sirve cada día como lo enseña Hoy (`serveDay`) y dice qué días no cierran y
 * QUÉ comida cambiar para que cierren. Quien lo llama pide esos cambios al
 * modelo en UNA ronda (`plan-fit.server.ts`) y se queda con los que mejoran.
 *
 * - Un día fuera de ±5 % de su objetivo, o con la proteína por debajo del 90 %,
 *   no encaja. Un día con algún plato aún sin receta (`calculando`, D13) no se
 *   mide: no se sabe.
 * - Kcal: la culpable es la comida principal (comida o cena) que menos se deja
 *   estirar hacia donde hace falta: se le pide un 25 % más (o menos) y se mira
 *   cuánto sirve. El hueco de desayuno y merienda ya lo absorben comida y cena
 *   en `closeDay` cuando tienen margen.
 * - Proteína: cualquier comida que se quede por debajo del 75 % de la suya,
 *   también desayuno y merienda (las ideas de la semana, que la ronda cambia en
 *   las semanas futuras: `plan-fit.server.ts`).
 * - Solo comidas PROPIAS (D4). Una compartida del hogar, solo si el día no tiene
 *   ninguna principal propia y quien genera puede tocarla (`canTouchShared`: el
 *   planificador).
 * - La estructura también cuenta (ticket 23): una comida principal de un solo
 *   componente, o con poca proteína cuando el objetivo de proteína es alto.
 *
 * Puro y determinista. Solo en servidor (lee la tabla de composición).
 */

import { serveDay, type DayMeal } from "./day-close";
import { plannedMacros, type ScaleTarget } from "./scale";

export type FitSlot = "desayuno" | "comida" | "cena" | "snack";
export type MainSlot = "comida" | "cena";

export type FitMeal = DayMeal & { slot: FitSlot; dish: string };
export type FitDay = { date: string; meals: FitMeal[] };

export type MisfitReason = "corta" | "pasa" | "proteina" | "un-componente";

export type Misfit = {
  date: string;
  /** Desayuno y merienda solo por proteína; kcal y estructura, solo comida y cena. */
  slot: FitSlot;
  dish: string;
  shared: boolean;
  reasons: MisfitReason[];
  /** Lo que sirve el plato con el día cerrado. */
  kcalServed: number;
  /** El objetivo de esa comida (el propio, también si es compartida). */
  kcalGoal: number;
  proteinGoal: number;
};

export type DayFit = {
  date: string;
  /** false: algún plato sin receta todavía; no cuenta en `fitPct`. */
  measured: boolean;
  fits: boolean;
  kcal: number;
  kcalGoal: number;
  protein: number;
  proteinGoal: number;
  /** Lo que se aparta el día (kcal y proteína) más allá de lo tolerado; 0 si cumple. */
  score: number;
};

export type PlanFit = {
  days: DayFit[];
  misfits: Misfit[];
  /** Días que encajan / días medidos (1 si no hay ninguno medido). */
  fitPct: number;
};

export type FitOptions = {
  /** Tolerancia del día sobre su objetivo de kcal (el 10 pide ±5 %). */
  kcalTolerance?: number;
  /** Proteína mínima del día sobre su objetivo. */
  proteinMin?: number;
  /** Puede cambiar una comida compartida (planificador). */
  canTouchShared?: boolean;
  /**
   * Objetivo de proteína alto (≥ 1,6 g/kg): cada comida principal debe llevar
   * al menos `MAIN_PROTEIN_MIN_G`.
   */
  highProtein?: boolean;
};

export const KCAL_TOLERANCE = 0.05;
export const PROTEIN_MIN = 0.9;
/** Proteína mínima de una comida principal con objetivo alto (ticket 10). */
export const MAIN_PROTEIN_MIN_G = 25;
/** Una comida por debajo de esto de su proteína se cambia cuando al día le falta. */
export const MEAL_PROTEIN_MIN = 0.75;
/** Con un día más lejos que esto de su objetivo, se cambian las dos principales. */
const BOTH_MAINS = 0.15;
/** Cuánto se le pide de más (o de menos) a un plato para ver si se deja estirar. */
const STRETCH = 0.25;
/** Lo que pesa en `score` una comida principal de un solo componente. */
const SINGLE_COMPONENT_WEIGHT = 0.02;

const isMain = (slot: FitSlot): slot is MainSlot => slot === "comida" || slot === "cena";
const singleComponent = (dish: string) => !dish.includes("·");

/** Cuánto sirve el plato si se le pide `factor` veces su objetivo, sobre ese objetivo. */
function capacity(meal: FitMeal, factor: number): number {
  const goal = meal.goal ?? meal.serving.target;
  if (!meal.recipe || !goal || goal.kcal <= 0) return 1;
  const target: ScaleTarget = { kcal: goal.kcal * factor, protein_g: goal.protein_g };
  const got = plannedMacros(meal.recipe, { base: meal.serving.base, target }).macros.kcal;
  return got / goal.kcal;
}

type DayEval = {
  fit: DayFit;
  served: ReturnType<typeof serveDay>;
};

function evalDay(day: FitDay, o: Required<Omit<FitOptions, "canTouchShared">>): DayEval {
  const served = serveDay(day.meals);
  const measured = day.meals.length > 0 && day.meals.every((m) => !!m.recipe);
  const kcal = Math.round(served.total.kcal);
  const protein = Math.round(served.total.protein_g);
  const kcalGoal = kcal - served.closed.residual.kcal;
  const proteinGoal = protein - served.closed.residual.protein_g;
  const kcalMiss = kcalGoal > 0 ? Math.abs(kcal - kcalGoal) / kcalGoal : 0;
  const proteinShort = proteinGoal > 0 ? Math.max(0, o.proteinMin - protein / proteinGoal) : 0;
  const singles = day.meals.filter((m) => isMain(m.slot) && singleComponent(m.dish)).length;
  const score =
    Math.max(0, kcalMiss - o.kcalTolerance) + proteinShort + singles * SINGLE_COMPONENT_WEIGHT;
  const fits = measured && kcalMiss <= o.kcalTolerance && proteinShort === 0;
  return {
    fit: { date: day.date, measured, fits, kcal, kcalGoal, protein, proteinGoal, score },
    served,
  };
}

const withDefaults = (opts: FitOptions) => ({
  kcalTolerance: opts.kcalTolerance ?? KCAL_TOLERANCE,
  proteinMin: opts.proteinMin ?? PROTEIN_MIN,
  highProtein: opts.highProtein ?? false,
});

/** Lo que se aparta un día de su objetivo (0 si encaja). Para comparar dos versiones. */
export function dayScore(day: FitDay, opts: FitOptions = {}): number {
  return evalDay(day, withDefaults(opts)).fit.score;
}

export function planFit(days: readonly FitDay[], opts: FitOptions = {}): PlanFit {
  const o = withDefaults(opts);
  const out: DayFit[] = [];
  const misfits: Misfit[] = [];

  for (const day of days) {
    const { fit, served } = evalDay(day, o);
    out.push(fit);
    if (!fit.measured) continue;

    // Lo que se puede cambiar: propias; una compartida solo si no hay ninguna
    // propia y quien genera la puede tocar (D4).
    const indexed = day.meals
      .map((meal, i) => ({ meal, i }))
      .filter(({ meal }) => meal.dish.trim() && meal.goal);
    const preferOwn = (list: typeof indexed) => {
      const own = list.filter(({ meal }) => !meal.shared);
      return own.length ? own : opts.canTouchShared ? list : [];
    };
    const candidates = preferOwn(indexed.filter(({ meal }) => isMain(meal.slot)));

    const picked = new Map<number, Set<MisfitReason>>();
    const add = (i: number, reason: MisfitReason) =>
      picked.set(i, (picked.get(i) ?? new Set()).add(reason));

    // Kcal: la principal que menos se deja estirar hacia donde hace falta. El
    // hueco de desayuno y merienda ya lo absorben comida y cena (`closeDay`).
    const miss = fit.kcalGoal > 0 ? (fit.kcal - fit.kcalGoal) / fit.kcalGoal : 0;
    if (candidates.length && Math.abs(miss) > o.kcalTolerance) {
      const short = miss < 0;
      const reach = (c: (typeof candidates)[number]) =>
        capacity(c.meal, short ? 1 + STRETCH : 1 - STRETCH);
      // Corta: la de menos alcance primero; se pasa: la que menos baja.
      const ranked = [...candidates].sort((a, b) =>
        short ? reach(a) - reach(b) : reach(b) - reach(a),
      );
      const n = Math.abs(miss) > BOTH_MAINS ? 2 : 1;
      for (const c of ranked.slice(0, n)) add(c.i, short ? "corta" : "pasa");
    }

    // Proteína del día: cualquier comida, también desayuno y merienda (con la
    // proteína en el 30 % de la energía, una merienda de zanahorias no deja
    // cerrar el día por mucho que se cambien comida y cena). Todas las que se
    // quedan lejos de la suya y, si ninguna, la que menos aporta.
    const proteinOf = (i: number) => served.meals[i]?.protein_g ?? 0;
    const proteinRatio = (c: (typeof indexed)[number]) =>
      proteinOf(c.i) / Math.max(1, c.meal.goal!.protein_g);
    if (fit.proteinGoal > 0 && fit.protein < o.proteinMin * fit.proteinGoal) {
      const pool = preferOwn(indexed);
      const low = pool.filter((c) => proteinRatio(c) < MEAL_PROTEIN_MIN);
      const worst = [...pool].sort((a, b) => proteinRatio(a) - proteinRatio(b))[0];
      for (const c of low.length ? low : worst ? [worst] : []) add(c.i, "proteina");
    }

    for (const c of candidates) {
      if (singleComponent(c.meal.dish)) add(c.i, "un-componente");
      if (o.highProtein && proteinOf(c.i) < MAIN_PROTEIN_MIN_G) add(c.i, "proteina");
    }

    for (const [i, reasons] of picked) {
      const meal = day.meals[i]!;
      misfits.push({
        date: day.date,
        slot: meal.slot,
        dish: meal.dish,
        shared: meal.shared,
        reasons: [...reasons],
        kcalServed: Math.round(served.meals[i]?.kcal ?? 0),
        kcalGoal: Math.round(meal.goal!.kcal),
        proteinGoal: Math.round(meal.goal!.protein_g),
      });
    }
  }

  const measured = out.filter((d) => d.measured);
  return {
    days: out,
    misfits,
    fitPct: measured.length ? measured.filter((d) => d.fits).length / measured.length : 1,
  };
}

/** La frase del motivo para el prompt de corrección ("se queda corta: 310 kcal para 465"). */
export function misfitReasonText(m: Misfit): string {
  const parts = m.reasons.map((r) => {
    switch (r) {
      case "corta":
        return `se queda corta aun escalada: ${m.kcalServed} kcal para ${m.kcalGoal}`;
      case "pasa":
        return `se pasa aun escalada: ${m.kcalServed} kcal para ${m.kcalGoal}`;
      case "proteina":
        return `le falta proteína (objetivo ${m.proteinGoal} g)`;
      case "un-componente":
        return "es un solo plato, sin acompañamiento ni postre";
    }
  });
  return parts.join("; ");
}

/** Una idea semanal nueva de desayuno o merienda (índices de `weeks[]` y de su lista). */
export type WeeklyIdea = {
  week: number;
  option: number;
  slot: "desayuno" | "snack";
  dish: string;
};

/**
 * Lee `"ideas": [{"semana", "comida", "opcion", "plato"}]` de la respuesta de la
 * ronda. `semana` y `opcion` van en base 1 para el modelo; aquí en base 0. Solo
 * entran las que se pidieron (`allowed`, claves `semana|slot|opcion` en base 0).
 */
export function cleanWeeklyIdeas(raw: unknown, allowed: ReadonlySet<string>): WeeklyIdea[] {
  const list = (raw ?? {}) as { ideas?: unknown };
  if (!Array.isArray(list.ideas)) return [];
  const out: WeeklyIdea[] = [];
  for (const item of list.ideas) {
    const o = (item ?? {}) as Record<string, unknown>;
    const week = Number(o.semana) - 1;
    const option = Number(o.opcion) - 1;
    const meal = String(o.comida ?? "").toLowerCase();
    const slot = meal === "desayuno" ? "desayuno" : meal === "merienda" ? "snack" : null;
    const dish = String(o.plato ?? "")
      .trim()
      .slice(0, 200);
    if (!slot || !dish || !Number.isInteger(week) || !Number.isInteger(option)) continue;
    if (!allowed.has(`${week}|${slot}|${option}`)) continue;
    out.push({ week, option, slot, dish });
  }
  return out;
}
