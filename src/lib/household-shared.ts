/** Configuración de comidas compartidas del hogar (compartido entre cliente y servidor). */

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
 * para todos, salido de la misma compra. Es una sola config por hogar
 * (`households.shared_slots`), la fija el planificador.
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

export function describeSharedSlots(slots: SharedSlots): string {
  const parts = MEAL_KEYS.filter((m) => slots[m].length).map(
    (m) => `${MEAL_LABEL[m]}: ${slots[m].map((d) => DAY_LABEL[d]).join(", ")}`,
  );
  return parts.length ? parts.join(" · ") : "sin comidas compartidas";
}

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

/** Tabla de raciones del hogar por comida, para dimensionar la compra. */
export type ServingsTable = { shared: Record<MealKey, number>; plannerSolo: number };

/**
 * Cuántas raciones piden las comidas del hogar: `shared[meal]` es la suma de
 * raciones de todos los que comen ese slot (0 si esa comida no se comparte
 * ningún día); `plannerSolo` es la ración de quien planifica, para sus comidas
 * en solitario (snack y las comidas de días sin compartir).
 */
export function servingsPerSlot(
  members: { portion: number; isPlanner?: boolean }[],
  children: { portion: number }[],
  sharedSlots: SharedSlots,
): ServingsTable {
  const total =
    members.reduce((sum, m) => sum + (Number(m.portion) || 0), 0) +
    children.reduce((sum, c) => sum + (Number(c.portion) || 0), 0);
  const planner = members.find((m) => m.isPlanner);
  return {
    shared: Object.fromEntries(
      MEAL_KEYS.map((meal) => [meal, sharedSlots[meal].length ? round2(total) : 0]),
    ) as Record<MealKey, number>,
    plannerSolo: round2(planner?.portion ?? 1),
  };
}

/** Resume la tabla de raciones en texto, solo para las comidas que sí se comparten. */
export function describeServings(servings: ServingsTable, slots: SharedSlots): string {
  const parts = MEAL_KEYS.filter((m) => slots[m].length).map(
    (m) => `${MEAL_LABEL[m]}: ${servings.shared[m]} raciones`,
  );
  return parts.length ? parts.join(" · ") : "sin comidas compartidas";
}
