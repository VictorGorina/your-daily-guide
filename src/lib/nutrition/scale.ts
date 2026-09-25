/**
 * Escalado de un plato del plan a su objetivo (ticket 08 de
 * `precision-nutricional`, adelantado para el 10).
 *
 * La receta canónica es UNA ración de AESAN por componente, y una ración de
 * AESAN es una unidad de recomendación (AESAN pide 4-6 de cereal al día), no el
 * plato de un adulto: con la estructura del ticket 23, un día de raciones base
 * ronda 1.100-1.600 kcal para la persona de referencia de 2.000. Multiplicar
 * todo por la ración personal (objetivo ÷ 2.000, ticket 21) conserva ese hueco:
 * `eval:plan-lite` dejaba 5 de 21 días a ±15 % del objetivo.
 *
 * Aquí cada plato del plan se escala al objetivo de SU comida
 * (`energyTargets().perSlot`), por grupos, decididos por los datos del alimento:
 *
 * - **V** (fijo): verdura, fruta y condimentos de pocas kcal (caldo, vinagre).
 *   No el aguacate ni la fruta desecada, que son energía (`DENSE_PRODUCE_KCAL`).
 *   Bajar ración nunca quita verdura; subirla no llena el plato de lechuga.
 * - **P** (proteína): la proteína aporta ≥ 35 % de sus kcal (pollo, pescado,
 *   huevo, tofu, yogur griego).
 * - **E** (energía): el resto (cereal, pan, legumbre, aceite, lácteo, queso).
 *
 * Dos factores, `fP` y `fE`, sobre la ración personal: kcal primero y, con el
 * margen que quede, la proteína de la comida. Límites para que el plato siga
 * siendo el mismo plato (`SCALE_LIMITS`); lo que no quepa queda como residuo, y
 * lo corrige la estructura de la comida o el `planFit` del ticket 10, no un
 * plato desfigurado.
 *
 * Los límites de E son más anchos que los del ticket 08 (0,7-1,4): con ellos
 * ningún día de la persona de referencia llegaba al objetivo, porque la ración
 * de AESAN del cereal es la mitad de lo que se sirve en un plato de comida.
 *
 * Puro. Solo en servidor (lee la tabla de composición).
 */

import type { Food } from "./foods.data";
import { foodByKey, type Macros } from "./nutrition";
import { eatenPortion, type PortionSize } from "./portion";
import { macrosOfRecipe, type CanonicalIngredient, type CanonicalRecipe } from "./recipe";

export type FoodGroup = "V" | "P" | "E";

/** Proteína ≥ 35 % de las kcal del alimento: grupo P. */
export const PROTEIN_SHARE_P = 0.35;

/** Límites de los factores, sobre la ración personal. */
export const SCALE_LIMITS = {
  fP: [0.75, 1.6],
  fE: [0.6, 2.0],
  /** `fP / fE`: ni el doble de pollo con la mitad de arroz, ni al revés. */
  ratio: [0.5, 2.0],
} as const;

/** Margen de kcal (sobre el objetivo) que se cede para acercar la proteína. */
const KCAL_SLACK = 0.01;

export type ScaleTarget = { kcal: number; protein_g: number };
export type GroupFactors = { fP: number; fE: number };

export type ScaledPortion = {
  factors: GroupFactors;
  macros: Macros;
  /** Lo que sobra (+) o falta (−) frente al objetivo. */
  residual: { kcal: number; protein_g: number };
};

/**
 * Por encima de esto (kcal / 100 g), una fruta o verdura es energía, no
 * volumen: aguacate, fruta desecada, salmorejo. El plátano (89) sigue fijo.
 */
export const DENSE_PRODUCE_KCAL = 120;

export function foodGroup(food: Pick<Food, "category" | "kcal" | "protein_g">): FoodGroup {
  if (
    (food.category === "verdura" || food.category === "fruta") &&
    food.kcal <= DENSE_PRODUCE_KCAL
  ) {
    return "V";
  }
  if (food.category === "despensa" && food.kcal < 60) return "V";
  if (food.kcal > 0 && (4 * food.protein_g) / food.kcal >= PROTEIN_SHARE_P) return "P";
  return "E";
}

const groupOf = (ing: Pick<CanonicalIngredient, "foodKey">): FoodGroup | null => {
  const food = foodByKey(ing.foodKey);
  return food ? foodGroup(food) : null;
};

/** Los ingredientes con los gramos de cada grupo multiplicados por su factor. */
export function scaledIngredients(
  recipe: Pick<CanonicalRecipe, "ingredients">,
  factors: GroupFactors,
): CanonicalIngredient[] {
  return recipe.ingredients.map((ing) => {
    const group = groupOf(ing);
    const f = group === "P" ? factors.fP : group === "E" ? factors.fE : 1;
    return f === 1 ? ing : { ...ing, gramsRaw: ing.gramsRaw * f };
  });
}

/** Macros de la receta con la ración personal `base` y los factores de grupo. */
export function macrosOfScaled(
  recipe: Pick<CanonicalRecipe, "ingredients">,
  base: number,
  factors: GroupFactors,
): Macros {
  return macrosOfRecipe({ ingredients: scaledIngredients(recipe, factors) }, base);
}

type Totals = { kcal: number; protein: number };

/** kcal y proteína de cada grupo, a la ración personal. `null` si falta una fila. */
function groupTotals(
  recipe: Pick<CanonicalRecipe, "ingredients">,
  base: number,
): Record<FoodGroup, Totals> | null {
  const out: Record<FoodGroup, Totals> = {
    V: { kcal: 0, protein: 0 },
    P: { kcal: 0, protein: 0 },
    E: { kcal: 0, protein: 0 },
  };
  for (const ing of recipe.ingredients) {
    const one = macrosOfRecipe({ ingredients: [ing] }, base * 100);
    const group = groupOf(ing);
    if (!group) return null;
    // ×100 y ÷100: `macrosOf` redondea a la unidad, y aquí hace falta el decimal.
    out[group].kcal += one.kcal / 100;
    out[group].protein += one.protein_g / 100;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/**
 * Los factores que dejan el plato más cerca del objetivo: kcal primero (con un
 * 1 % de margen) y, dentro de ese margen, la proteína; a igualdad, el reparto
 * menos deformado (`fP` cerca de `fE`).
 *
 * Se recorre `fP` en pasos de 0,01 y, para cada uno, `fE` se despeja de las kcal
 * y se recorta a sus límites. Son ~85 cuentas: determinista y sin los casos
 * especiales de la forma cerrada cuando un límite se activa.
 */
export function scaleRecipe(
  recipe: Pick<CanonicalRecipe, "ingredients">,
  target: ScaleTarget,
  base: number,
): ScaledPortion | null {
  const g = groupTotals(recipe, base);
  if (!g) return null;
  const K = target.kcal;
  const Pt = target.protein_g;
  const hasP = g.P.kcal > 0;
  const hasE = g.E.kcal > 0;

  type Candidate = { fP: number; fE: number; kcal: number; protein: number };
  const candidates: Candidate[] = [];
  const [pLo, pHi] = SCALE_LIMITS.fP;
  const steps = hasP ? Math.round((pHi - pLo) * 100) : 0;
  for (let i = 0; i <= steps; i++) {
    const fP = hasP ? round2(pLo + i / 100) : 1;
    let fE = 1;
    if (hasE) {
      const free = hasP
        ? ([fP / SCALE_LIMITS.ratio[1], fP / SCALE_LIMITS.ratio[0]] as const)
        : null;
      const [eLo, eHi] = SCALE_LIMITS.fE;
      const lo = free ? Math.max(eLo, free[0]) : eLo;
      const hi = free ? Math.min(eHi, free[1]) : eHi;
      if (lo > hi) continue;
      fE = clamp((K - g.V.kcal - fP * g.P.kcal) / g.E.kcal, [lo, hi]);
    }
    candidates.push({
      fP,
      fE,
      kcal: g.V.kcal + fP * g.P.kcal + fE * g.E.kcal,
      protein: g.V.protein + fP * g.P.protein + fE * g.E.protein,
    });
  }
  // Sin P ni E (solo verdura o fruta): no hay nada que escalar.
  if (!hasP && !hasE) candidates.push({ fP: 1, fE: 1, kcal: g.V.kcal, protein: g.V.protein });
  if (!candidates.length) return null;

  const kcalErr = (c: Candidate) => Math.abs(c.kcal - K);
  const best = Math.min(...candidates.map(kcalErr));
  const chosen = candidates
    .filter((c) => kcalErr(c) <= best + KCAL_SLACK * K)
    .sort(
      (a, b) =>
        Math.abs(a.protein - Pt) - Math.abs(b.protein - Pt) ||
        Math.abs(a.fP - a.fE) - Math.abs(b.fP - b.fE),
    )[0]!;

  const factors = { fP: chosen.fP, fE: round2(chosen.fE) };
  const macros = macrosOfScaled(recipe, base, factors);
  return {
    factors,
    macros,
    residual: { kcal: macros.kcal - Math.round(K), protein_g: macros.protein_g - Math.round(Pt) },
  };
}

/**
 * Con qué se sirve un plato del plan: la ración personal (`base`, ticket 21) y,
 * si la persona tiene objetivo, el de esa comida (ya con el ajuste del día, ver
 * `PlanDay.kcalAdjust`).
 */
export type PlannedServing = { base: number; target: ScaleTarget | null };

/**
 * Macros de un plato DEL PLAN. Sin objetivo (menor de edad o faltan datos), la
 * ración personal tal cual. Una pieza (tostadas, bocadillo, pizza) no se escala
 * por grupos: se sirven piezas enteras, las más cercanas al objetivo. `portion` es el factor efectivo
 * (kcal servidas ÷ kcal de la ración base), el que se guarda con la comida para
 * saber si una cifra reutilizada sigue valiendo.
 *
 * `times` multiplica el plato ya escalado ("dos platos", el chip "grande"): la
 * forma del plato no cambia, solo cuánto se sirve.
 */
export function plannedMacros(
  recipe: Pick<CanonicalRecipe, "ingredients" | "servingKind">,
  serving: PlannedServing,
  times = 1,
): { macros: Macros; portion: number } {
  const base = serving.base * times;
  const uniform = () => ({ macros: macrosOfRecipe(recipe, base), portion: round2(base) });
  if (!serving.target || serving.target.kcal <= 0) return uniform();
  if (recipe.servingKind === "unidad") {
    // Una pieza no se deforma: se sirven piezas enteras, las que dejan la
    // comida más cerca de su objetivo (mínimo una). El plan decide cuántas
    // tostadas tocan; lo que no cuadre lo absorben las demás (`closeDay`).
    const unitKcal = macrosOfRecipe(recipe, 1).kcal;
    if (unitKcal <= 0) return uniform();
    const units = Math.max(1, Math.round(serving.target.kcal / unitKcal)) * times;
    return { macros: macrosOfRecipe(recipe, units), portion: units };
  }
  const scaled = scaleRecipe(recipe, serving.target, serving.base);
  if (!scaled) return uniform();
  const macros = times === 1 ? scaled.macros : macrosOfScaled(recipe, base, scaled.factors);
  const baseKcal = macrosOfRecipe(recipe, 1).kcal;
  return { macros, portion: baseKcal > 0 ? round2(macros.kcal / baseKcal) : round2(base) };
}

/**
 * Macros de un plato COMIDO fuera del plan ("comí distinto", ticket 17, D10):
 * se escala igual que un plato del plan, pero con la ración habitual y al
 * objetivo de esa comida a mantenimiento (`serving`, ver `resolveEatenServing`):
 * fuera del plan uno se sirve su plato de siempre, no el de la dieta. Encima, la
 * cantidad del texto o el chip de tamaño (`eatenPortion`). Una pieza, tal cual.
 *
 * Tiene que medirse igual que el plato del plan: si el plan se sirve a su
 * tamaño real y lo comido a la ración de AESAN, cualquier cambio de plato
 * parecería comer un tercio menos y se compensaría al revés.
 */
export function eatenMacros(
  recipe: Pick<CanonicalRecipe, "ingredients" | "servingKind">,
  opts: { serving: PlannedServing; textQuantity: number | null; size?: PortionSize | null },
): { macros: Macros; portion: number } {
  const times = eatenPortion({
    servingKind: recipe.servingKind,
    textQuantity: opts.textQuantity,
    habitual: 1,
    size: opts.size,
  });
  if (recipe.servingKind === "unidad") {
    return { macros: macrosOfRecipe(recipe, times), portion: times };
  }
  return plannedMacros(recipe, opts.serving, times);
}
