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

export function describeSharedSlots(slots: SharedSlots): string {
  const parts = MEAL_KEYS.filter((m) => slots[m].length).map(
    (m) => `${MEAL_LABEL[m]}: ${slots[m].map((d) => DAY_LABEL[d]).join(", ")}`,
  );
  return parts.length ? parts.join(" · ") : "sin comidas compartidas";
}

// ---------------------------------------------------------------------------
// Per-member home schedules (Feature 5: "¿Cuándo come cada uno en casa?")
// ---------------------------------------------------------------------------

/**
 * Horario individual: en qué días de la semana come en casa para cada comida.
 * Mismo shape que `SharedSlots`, pero por persona en vez de por hogar.
 */
export type HomeSchedule = Record<MealKey, number[]>;

export const EMPTY_SCHEDULE: HomeSchedule = { desayuno: [], comida: [], cena: [] };

/** Parse + clean un home_schedule crudo de la BD (misma lógica que cleanSharedSlots). */
export const cleanHomeSchedule = (raw: unknown): HomeSchedule => cleanSharedSlots(raw);

/**
 * ¿Es esa comida "efectivamente compartida" ese día de la semana?
 * Compartida = el planificador está en casa Y al menos otra persona también.
 */
export function isEffectivelyShared(
  members: { id: string; isPlanner?: boolean; homeSchedule: HomeSchedule | null }[],
  children: { id: string; homeSchedule: HomeSchedule | null }[],
  meal: MealKey,
  weekday: number,
): boolean {
  const planner = members.find((m) => m.isPlanner);
  if (!planner) return false;
  const plannerSched = planner.homeSchedule ?? EMPTY_SCHEDULE;
  if (!plannerSched[meal].includes(weekday)) return false;
  const othersHome =
    members.some(
      (m) => !m.isPlanner && (m.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday),
    ) || children.some((c) => (c.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday));
  return othersHome;
}

/**
 * Deriva un `SharedSlots` computado a partir de los horarios individuales:
 * un slot está "compartido" si el planificador está en casa y al menos otra
 * persona también. Así todo el código que ya usa `isSharedSlot(sharedSlots, …)`
 * sigue funcionando sin cambios.
 */
export function deriveSharedSlots(
  members: { isPlanner?: boolean; homeSchedule: HomeSchedule | null }[],
  children: { homeSchedule: HomeSchedule | null }[],
): SharedSlots {
  const result: SharedSlots = { desayuno: [], comida: [], cena: [] };
  for (const meal of MEAL_KEYS) {
    for (let day = 0; day <= 6; day++) {
      if (
        isEffectivelyShared(
          members as { id: string; isPlanner?: boolean; homeSchedule: HomeSchedule | null }[],
          children as { id: string; homeSchedule: HomeSchedule | null }[],
          meal,
          day,
        )
      ) {
        result[meal].push(day);
      }
    }
  }
  return result;
}

/** Info de una persona presente en casa para un meal+día concreto. */
export type AtHomePerson = {
  id: string;
  displayName: string;
  portion: number;
  isPlanner?: boolean;
  isChild?: boolean;
};

/**
 * Quién está en casa para una comida un día concreto de la semana.
 * Examina el `homeSchedule` de cada miembro y niño.
 */
export function whoIsHome(
  members: {
    id: string;
    displayName: string;
    portion: number;
    isPlanner?: boolean;
    homeSchedule: HomeSchedule | null;
  }[],
  children: { id: string; name: string; portion: number; homeSchedule: HomeSchedule | null }[],
  meal: MealKey,
  weekday: number,
): { people: AtHomePerson[]; totalPortions: number } {
  const people: AtHomePerson[] = [];
  for (const m of members) {
    const sched = m.homeSchedule ?? EMPTY_SCHEDULE;
    if (sched[meal].includes(weekday)) {
      people.push({
        id: m.id,
        displayName: m.displayName,
        portion: m.portion,
        isPlanner: m.isPlanner,
      });
    }
  }
  for (const c of children) {
    const sched = c.homeSchedule ?? EMPTY_SCHEDULE;
    if (sched[meal].includes(weekday)) {
      people.push({
        id: c.id,
        displayName: c.name,
        portion: c.portion,
        isChild: true,
      });
    }
  }
  const totalPortions = Math.round(people.reduce((s, p) => s + p.portion, 0) * 100) / 100;
  return { people, totalPortions };
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

/**
 * Paleta de avatares de la pestaña Familia: cinco tonos cálidos del rediseño.
 * `#ffe7d3` y `#e1f2e4` ya son `--primary-soft` / `--success-soft` del sistema.
 */
export const PERSON_COLORS: readonly { soft: string; ink: string }[] = [
  { soft: "#ffe7d3", ink: "#c2611f" },
  { soft: "#e1f2e4", ink: "#3d8f52" },
  { soft: "#fbeecb", ink: "#a37b13" },
  { soft: "#dbeaf6", ink: "#3a7fb0" },
  { soft: "#f8dfdd", ink: "#c2534b" },
];

/**
 * Color de avatar de una persona del hogar, derivado de forma determinista de un
 * `seed` estable (el id del hueco de la mesa o del peque). No hay columna de
 * color en la BD: se calcula al vuelo para que cada cara tenga su tono estable.
 */
export function personColor(seed: string): { soft: string; ink: string } {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum += seed.charCodeAt(i);
  return PERSON_COLORS[sum % PERSON_COLORS.length]!;
}
