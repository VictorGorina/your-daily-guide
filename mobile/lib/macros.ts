import type { DailyLog, MacroEstimate, MealMacroEstimate } from "./daily";

/**
 * Copia de `src/lib/macros.ts` de la web (ver AGENTS.md: no hay código
 * compartido entre las dos apps). La usan la pestaña Hoy y el detalle de un día
 * pasado en Plan.
 */

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
 * Desvío en kcal de un lote de cambios de plato frente a lo que preveía el
 * plan: para cada comida cambiada, lo que estima la guía nueva menos lo que
 * estimaba la guía que había antes de tocarla.
 *
 * Es lo que convierte "he comido pizza y cerveza" en una cifra que la IA puede
 * usar para recolocar los días siguientes (`kcalDelta` en `adjustMonthlyPlan`).
 * Antes no se le pasaba nada desde Hoy y el coach solía responder que el plan
 * ya estaba equilibrado.
 *
 * Devuelve `null` si no hay ninguna comida con las dos cifras — sin dato es
 * mejor no inventarse un cero, que la IA leería como "no ha pasado nada".
 */
export function kcalDeltaOf(
  changes: readonly { label: string; prevKcal: number | null }[],
  mealMacros: MealMacroEstimate[] | null | undefined,
): number | null {
  let total = 0;
  let counted = 0;
  for (const change of changes) {
    if (change.prevKcal == null) continue;
    const now = mealMacros?.find((m) => m.moment === change.label)?.kcal;
    if (typeof now !== "number") continue;
    total += now - change.prevKcal;
    counted += 1;
  }
  return counted ? Math.round(total) : null;
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
