/**
 * ¿Hay que recolocar otras comidas por un desvío de energía? Lo decide el
 * código, nunca el modelo (spec `hoy-semanas-editables`, D2 y D5; lo usa primero
 * el picoteo de `picoteo-hoy`).
 *
 * La tabla la aprobó el usuario: un desvío a favor del objetivo tiene más margen
 * (400) que uno en contra (200), y una bajada de proteína de 20 g o más se
 * compensa siempre. 200 kcal es el mismo "desvío grande" que `FORCE_ADJUST_KCAL`
 * en `reflowMeals`.
 *
 * Puro y sin la tabla de alimentos: se puede importar desde cualquier sitio.
 */

export type CompensationGoal = "perder" | "mantener" | "ganar";

/** Umbrales en kcal: se compensa si Δ ≥ `above` o Δ ≤ `below`. */
export const COMPENSATION_THRESHOLDS: Record<CompensationGoal, { above: number; below: number }> = {
  perder: { above: 200, below: -400 },
  mantener: { above: 200, below: -200 },
  ganar: { above: 400, below: -200 },
};

/** Una bajada de proteína de al menos estos gramos se compensa con cualquier objetivo. */
export const COMPENSATION_PROTEIN_DROP_G = -20;

export type CompensationDecision =
  | { compensate: false; reason: "below-threshold" | "pregnancy" }
  | {
      compensate: true;
      /** Desvío de energía que hay que absorber (0 si solo cuenta la proteína). */
      kcalDelta: number;
      /** Bajada de proteína que hay que reponer, o null si no llega al umbral. */
      proteinDelta: number | null;
    };

const isGoal = (goal: string | null | undefined): goal is CompensationGoal =>
  goal === "perder" || goal === "mantener" || goal === "ganar";

/** Embarazo o lactancia: nunca se quitan kcal de días futuros. */
const cannotCutEnergy = (pregnancyStatus: string | null | undefined) =>
  pregnancyStatus === "embarazada" || pregnancyStatus === "lactancia";

/**
 * `goal` es la dirección del objetivo (`deriveGoalType`, o el objetivo legacy
 * normalizado). Cualquier otro valor, o ninguno, usa la fila de mantener.
 *
 * Un exceso (Δ > 0) se compensa quitando energía de otros días, así que con
 * embarazo o lactancia esa parte no se compensa nunca: el desvío se queda
 * registrado y ya está.
 */
export function compensationNeed(input: {
  deltaKcal: number;
  deltaProtein?: number | null;
  goal: string | null | undefined;
  pregnancyStatus?: string | null;
}): CompensationDecision {
  const deltaKcal = Math.round(input.deltaKcal);
  const deltaProtein = input.deltaProtein == null ? null : Math.round(input.deltaProtein);
  const limits = COMPENSATION_THRESHOLDS[isGoal(input.goal) ? input.goal : "mantener"];

  const kcalHit = deltaKcal >= limits.above || deltaKcal <= limits.below;
  const proteinHit = deltaProtein != null && deltaProtein <= COMPENSATION_PROTEIN_DROP_G;
  if (!kcalHit && !proteinHit) return { compensate: false, reason: "below-threshold" };

  if (deltaKcal > 0 && cannotCutEnergy(input.pregnancyStatus)) {
    // Solo queda la proteína, que se repone sin quitar energía.
    return proteinHit
      ? { compensate: true, kcalDelta: 0, proteinDelta: deltaProtein }
      : { compensate: false, reason: "pregnancy" };
  }

  return {
    compensate: true,
    kcalDelta: deltaKcal,
    proteinDelta: proteinHit ? deltaProtein : null,
  };
}
