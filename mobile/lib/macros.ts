import type { DailyLog, MacroEstimate, MealMacroEstimate } from "./daily";

/**
 * Copia de `src/lib/macros.ts` de la web (ver AGENTS.md: no hay código
 * compartido entre las dos apps). La usan la pestaña Hoy y el detalle de un día
 * pasado en Plan.
 */

/** Suma de dos estimaciones (p. ej. comidas marcadas + picoteo del día). */
export function addMacros(a: MacroEstimate, b: MacroEstimate): MacroEstimate {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
    fiber_g: a.fiber_g + b.fiber_g,
  };
}

/** Punto de partida de la barra mientras no hay nada que sumar todavía. */
export const ZERO_MACROS: MacroEstimate = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
};

/**
 * Suma las estimaciones por plato (`mealMacros`) de las comidas ya marcadas como
 * comidas ("comí esto" / "comí distinto"). `null` cuando la guía todavía no trae
 * `mealMacros` — el caller cae a `ZERO_MACROS`.
 */
export function sumDoneMacros(
  mealMacros: MealMacroEstimate[] | null | undefined,
  habits: DailyLog["habits"],
): MacroEstimate | null {
  if (!mealMacros?.length) return null;
  const doneLabels = new Set(
    habits.filter((h) => h.status === "plan" || h.status === "distinto").map((h) => h.label),
  );
  const totals: MacroEstimate = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const m of mealMacros) {
    if (!doneLabels.has(m.moment)) continue;
    totals.kcal += m.kcal;
    totals.protein_g += m.protein_g;
    totals.carbs_g += m.carbs_g;
    totals.fat_g += m.fat_g;
    totals.fiber_g += m.fiber_g;
  }
  return totals;
}

/**
 * Desvío en kcal de cada comida cambiada frente a lo que preveía el plan: lo
 * que estima la guía nueva menos lo que estimaba la guía de antes de tocarla,
 * UNA cifra por comida (no ya sumadas).
 *
 * Es lo que convierte "he comido pizza y cerveza" en algo que el servidor
 * puede acumular día a día (`compensateDishChanges`, que guarda cada cifra en
 * `MealHabit.swapKcalDelta` y decide con `pendingSwapKcal` si hace falta
 * recolocar el plan): dos cambios pequeños por separado deben poder sumar
 * hasta pasar el umbral aunque cada lote solo vea el suyo.
 *
 * Omite las comidas sin las dos cifras — sin dato es mejor no inventarse un
 * cero, que se leería como "no ha pasado nada".
 */
export function perMealKcalDeltas(
  changes: readonly { label: string; prevKcal: number | null }[],
  mealMacros: MealMacroEstimate[] | null | undefined,
): { label: string; kcalDelta: number }[] {
  const out: { label: string; kcalDelta: number }[] = [];
  for (const change of changes) {
    if (change.prevKcal == null) continue;
    const now = mealMacros?.find((m) => m.moment === change.label)?.kcal;
    if (typeof now !== "number") continue;
    out.push({ label: change.label, kcalDelta: Math.round(now - change.prevKcal) });
  }
  return out;
}

/**
 * Respaldo genérico (no personalizado por ningún profesional) para cuando aún no
 * hay `macroEstimate` del día. La proteína se ajusta al peso (~1,2 g/kg); el
 * resto usa un valor fijo. Orientativo.
 */
export function macroTargets(weightKg: number | null) {
  const proteinTarget = Math.round(Math.min(200, Math.max(45, (weightKg ?? 70) * 1.2)));
  return { protein_g: proteinTarget, carbs_g: 250, fat_g: 70, fiber_g: 30 };
}
