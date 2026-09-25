/**
 * Cierre del día (`alignSoloMeals` del ticket 08 de `precision-nutricional`).
 *
 * Cada plato del plan se escala al objetivo de su comida (`scale.ts`), pero con
 * límites para que siga siendo el mismo plato: una merienda de una naranja no
 * llega a 160 kcal, un desayuno de solo yogur no llega a 330. Lo que una comida
 * no alcanza se pasa a las demás comidas PROPIAS del día que tengan margen, en
 * proporción a su objetivo, hasta que el día cuadra o nadie más puede absorber.
 *
 * - Una comida compartida del hogar se sirve con la ración del hogar (D4) y no
 *   absorbe nada, pero SÍ cuenta: su objetivo en el día de cada adulto es el
 *   suyo propio (`goal`), no el medio con el que se sirve. Si el plato común
 *   le da 100 kcal de más, sus comidas propias bajan 100.
 * - Una pieza (`servingKind: "unidad"`) no se escala: cuenta, pero no absorbe.
 * - Un plato sin receta todavía (`calculando`, D13) ni cuenta ni absorbe.
 *
 * Se calcula SIEMPRE sobre el día planeado (el plato congelado en
 * `plannedIdea`, no el que se acabó comiendo): así la ración de la cena no
 * cambia porque a mediodía se comiera otra cosa. Compensar un cambio de hoy es
 * cosa de `settleDay`, y solo desde mañana.
 *
 * Puro y determinista. Solo en servidor (lee la tabla de composición).
 */

import { ZERO, type Macros } from "./nutrition";
import type { CanonicalRecipe } from "./recipe";
import { plannedMacros, type PlannedServing, type ScaleTarget } from "./scale";

export type DayMeal = {
  /** Receta del plato planeado; `null` si aún no se ha podido calcular. */
  recipe: Pick<CanonicalRecipe, "ingredients" | "servingKind"> | null;
  /** Con qué se sirve (ración y objetivo de la comida; el del hogar si es compartida). */
  serving: PlannedServing;
  /** El objetivo de esta comida en el día de la persona (el propio, también si es compartida). */
  goal: ScaleTarget | null;
  /** Compartida del hogar: su ración es la de todos y no absorbe el hueco del día. */
  shared: boolean;
};

export type ClosedDay = {
  /** Objetivo con el que servir cada comida, en el mismo orden (null: sin objetivo). */
  targets: (ScaleTarget | null)[];
  /** Día servido − objetivo del día, sobre las comidas que cuentan (+ sobra, − falta). */
  residual: { kcal: number; protein_g: number };
};

/** Pasadas como mucho: cada una reparte lo que la anterior no pudo colocar. */
const MAX_PASSES = 3;
/** Por debajo de esto (sobre el objetivo del día), el día ya cuadra. */
const DAY_TOLERANCE = 0.005;
/** Una comida que se queda a más de esto de su objetivo ha tocado su límite. */
const SATURATED = 0.03;

const served = (meal: DayMeal, target: ScaleTarget | null): Macros =>
  meal.recipe
    ? plannedMacros(meal.recipe, { base: meal.serving.base, target }).macros
    : { ...ZERO };

/**
 * Los objetivos con los que se sirve cada comida para que el día de la persona
 * cierre en su objetivo. Sin objetivo (menor, faltan datos) o sin nada que
 * repartir, los de siempre.
 */
export function closeDay(meals: readonly DayMeal[]): ClosedDay {
  const targets = meals.map((m) => (m.serving.target ? { ...m.serving.target } : null));
  // Cuentan las comidas con receta y objetivo propio.
  const counted = meals
    .map((m, i) => i)
    .filter((i) => meals[i]!.recipe && meals[i]!.goal && meals[i]!.goal!.kcal > 0);
  // Absorbe una comida propia que de verdad responde al escalado: una pieza no,
  // y un plato solo de fruta o verdura (la naranja de la merienda) tampoco.
  const moves = (i: number) => {
    const t = targets[i]!;
    const at = (f: number) => served(meals[i]!, { ...t, kcal: t.kcal * f }).kcal;
    return at(1.2) !== at(0.8);
  };
  const flexible = counted.filter(
    (i) =>
      !meals[i]!.shared && meals[i]!.recipe!.servingKind !== "unidad" && targets[i] && moves(i),
  );
  const dayGoal = counted.reduce(
    (acc, i) => ({
      kcal: acc.kcal + meals[i]!.goal!.kcal,
      protein_g: acc.protein_g + meals[i]!.goal!.protein_g,
    }),
    { kcal: 0, protein_g: 0 },
  );
  const dayServed = () =>
    counted.reduce(
      (acc, i) => {
        const m = served(meals[i]!, targets[i]!);
        return { kcal: acc.kcal + m.kcal, protein_g: acc.protein_g + m.protein_g };
      },
      { kcal: 0, protein_g: 0 },
    );

  const saturated = new Set<number>();
  let total = dayServed();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const gap = dayGoal.kcal - total.kcal;
    if (Math.abs(gap) <= DAY_TOLERANCE * dayGoal.kcal) break;
    const open = flexible.filter((i) => !saturated.has(i));
    if (!open.length) break;
    const weight = open.reduce((s, i) => s + meals[i]!.goal!.kcal, 0);
    // La proteína que falta se reparte una vez, con el primer hueco: es la
    // segunda prioridad del escalado y no debe seguir inflándose cada pasada.
    const proteinGap = pass === 0 ? dayGoal.protein_g - total.protein_g : 0;
    for (const i of open) {
      const share = meals[i]!.goal!.kcal / weight;
      const t = targets[i]!;
      targets[i] = {
        kcal: Math.max(0, Math.round(t.kcal + gap * share)),
        protein_g: Math.max(0, Math.round(t.protein_g + proteinGap * share)),
      };
    }
    for (const i of open) {
      const got = served(meals[i]!, targets[i]!).kcal;
      const want = targets[i]!.kcal;
      if (Math.abs(got - want) <= SATURATED * Math.max(want, 1)) continue;
      // Ha tocado su límite: se queda en lo que de verdad sirve. Un objetivo
      // inflado se aplicaría tal cual a otro plato si hoy se cambia éste.
      saturated.add(i);
      targets[i] = { ...targets[i]!, kcal: got };
    }
    total = dayServed();
  }

  return {
    targets,
    residual: {
      kcal: Math.round(total.kcal - dayGoal.kcal),
      protein_g: Math.round(total.protein_g - dayGoal.protein_g),
    },
  };
}

/**
 * El día servido entero: las macros de cada comida (null si no tiene receta) ya
 * cerradas con `closeDay`, y la suma. Para comparar dos versiones de un día
 * (un plato cambiado) o medir el plan contra el objetivo.
 */
export function serveDay(meals: readonly DayMeal[]): {
  meals: (Macros | null)[];
  total: Macros;
  closed: ClosedDay;
} {
  const closed = closeDay(meals);
  const out = meals.map((m, i) => (m.recipe ? served(m, closed.targets[i]!) : null));
  const total = out.reduce<Macros>(
    (acc, m) =>
      m
        ? {
            kcal: acc.kcal + m.kcal,
            protein_g: acc.protein_g + m.protein_g,
            carbs_g: acc.carbs_g + m.carbs_g,
            fat_g: acc.fat_g + m.fat_g,
            fiber_g: acc.fiber_g + m.fiber_g,
          }
        : acc,
    { ...ZERO },
  );
  return { meals: out, total, closed };
}
