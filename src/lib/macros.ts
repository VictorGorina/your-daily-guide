import type { DailyLog } from "@/lib/daily";
import type { MacroEstimate, MealMacroEstimate } from "@/lib/guide.functions";

/**
 * Punto de partida de la barra de macros mientras no hay nada que sumar todavía
 * (guía sin cargar o ninguna comida marcada): la barra se muestra igual, en 0,
 * en vez de esperar a la primera comida confirmada.
 */
export const ZERO_MACROS: MacroEstimate = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
};

/**
 * Suma las estimaciones por plato (`mealMacros`) de las comidas que ya están
 * marcadas como comidas ("comí esto" / "comí distinto"), para que la barra
 * refleje solo lo confirmado — no el menú del día entero de golpe. Deshacer una
 * comida la resta de la suma, igual que el contador "x de y". `null` cuando la
 * guía todavía no trae `mealMacros` — el caller cae entonces a `ZERO_MACROS`
 * para seguir mostrando la barra (en 0) en vez de ocultarla.
 *
 * La usan tanto la pestaña Hoy como el detalle de un día pasado en Plan.
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
 * Referencia genérica (no personalizada por profesional alguno) de respaldo,
 * solo para cuando todavía no hay `macroEstimate` del día (guía sin generar o
 * sin plan). La proteína se ajusta al peso (~1,2 g/kg, cifra habitual para
 * población general); carbohidratos, grasa y fibra usan un valor fijo. En
 * cuanto hay guía, el objetivo real es el total estimado para los platos reales
 * de ese día (`macroEstimate`). Todo el bloque es orientativo.
 */
export function macroTargets(weightKg: number | null) {
  const proteinTarget = Math.round(Math.min(200, Math.max(45, (weightKg ?? 70) * 1.2)));
  return { protein_g: proteinTarget, carbs_g: 250, fat_g: 70, fiber_g: 30 };
}
