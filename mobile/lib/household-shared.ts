/**
 * Subconjunto de `src/lib/household-shared.ts` de la web: lo que necesita Hoy
 * para saber si una comida es compartida con el resto del hogar. Copia, no
 * código compartido (ver AGENTS.md).
 */

export const MEAL_KEYS = ["desayuno", "comida", "cena"] as const;
export type MealKey = (typeof MEAL_KEYS)[number];

export type SharedMeals = Record<MealKey, number[]>;

export const EMPTY_SHARED: SharedMeals = { desayuno: [], comida: [], cena: [] };

export function cleanSharedMeals(raw: unknown): SharedMeals {
  const o = (raw ?? {}) as Record<string, unknown>;
  const days = (v: unknown) =>
    [
      ...new Set(
        (Array.isArray(v) ? v : [])
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
      ),
    ].sort((a, b) => a - b);
  return {
    desayuno: days(o.desayuno),
    comida: days(o.comida),
    cena: days(o.cena),
  };
}

/** Días en los que dos personas comparten la misma comida. */
export const sharedDays = (a: SharedMeals, b: SharedMeals, meal: MealKey) =>
  a[meal].filter((d) => b[meal].includes(d));
