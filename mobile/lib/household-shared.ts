/**
 * Subconjunto de `src/lib/household-shared.ts` de la web: lo que necesitan Hoy y
 * Familia para las comidas compartidas del hogar. Copia, no código compartido
 * (ver AGENTS.md).
 */

export const MEAL_KEYS = ["desayuno", "comida", "cena"] as const;
export type MealKey = (typeof MEAL_KEYS)[number];

export const MEAL_LABEL: Record<MealKey, string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
};

/** 0 = lunes … 6 = domingo (igual que el plan mensual). */
export const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
export const DAY_LABEL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Los días en que cada comida es una comida compartida del hogar: mismo plato
 * para todos. Una sola config por hogar (`households.shared_slots`).
 */
export type SharedSlots = Record<MealKey, number[]>;

export const EMPTY_SLOTS: SharedSlots = { desayuno: [], comida: [], cena: [] };

export function cleanSharedSlots(raw: unknown): SharedSlots {
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

export const toggleDay = (list: number[], day: number) =>
  list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort((a, b) => a - b);

/** ¿Esa comida ese día (0=lunes … 6=domingo) es una comida compartida del hogar? */
export const isSharedSlot = (slots: SharedSlots, meal: MealKey, day: number) =>
  slots[meal].includes(day);

/** Apetito de una persona: ajusta su ración base ±0,2 (niños) o la fija directa (adultos). */
export type Appetite = "poco" | "normal" | "mucho";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ración base de un niño según su edad (1 = ración de adulto estándar). Misma
 * tabla que el backfill de la migración `household_children_portion.sql`.
 */
export function childBasePortion(age: number | null): number {
  if (age == null) return 0.5;
  if (age <= 3) return 0.3;
  if (age <= 8) return 0.5;
  if (age <= 13) return 0.75;
  return 1;
}

const CHILD_APPETITE_ADJUST: Record<Appetite, number> = { poco: -0.2, normal: 0, mucho: 0.2 };

/** Ración de un niño: su base por edad, ajustada ±0,2 según su apetito. */
export function childPortion(age: number | null, appetite: Appetite): number {
  return Math.max(0.1, round2(childBasePortion(age) + CHILD_APPETITE_ADJUST[appetite]));
}
