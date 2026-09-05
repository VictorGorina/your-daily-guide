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

/** "Ana", "Ana y Luis", "Ana, Luis y Marta". */
function joinPeople(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * Describe la mesa del hogar en un par de frases para el prompt del coach:
 * quién come junto y quién tiene la app, los niños con edad y alergias, y quién
 * planifica. Es solo texto — el reparto de permisos (quién puede cambiar qué)
 * lo imponen los guards del servidor, no este resumen.
 */
export function describeRoster(
  members: { displayName: string; hasAccount: boolean; isPlanner: boolean }[],
  children: { name: string; age: number | null; allergies: string | null }[],
): string {
  const withApp = members.filter((m) => m.hasAccount).map((m) => m.displayName);
  const withoutApp = members.filter((m) => !m.hasAccount).map((m) => m.displayName);
  const planner = members.find((m) => m.isPlanner)?.displayName ?? null;

  const adultParts: string[] = [];
  if (withApp.length) adultParts.push(`${joinPeople(withApp)} (con la app)`);
  if (withoutApp.length) {
    adultParts.push(`${joinPeople(withoutApp)} (sin la app, solo cuentan para la compra)`);
  }

  const lines: string[] = [
    adultParts.length
      ? `Comen juntos en casa: ${adultParts.join(", ")}.`
      : "Hogar sin adultos configurados todavía.",
  ];
  if (children.length) {
    lines.push(
      `Niños: ${children
        .map(
          (c) =>
            `${c.name}${c.age != null ? ` (${c.age} años)` : ""}${
              c.allergies ? `, alergia a ${c.allergies}` : ", sin alergias"
            }`,
        )
        .join("; ")}.`,
    );
  }
  lines.push(
    planner
      ? `Planifica el menú y hace la compra de la casa: ${planner}.`
      : "Ahora mismo nadie de la casa planifica el menú compartido.",
  );
  return lines.join("\n");
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
  // ¿Hay alguien más en casa?
  const othersHome =
    members.some(
      (m) => !m.isPlanner && (m.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday),
    ) || children.some((c) => (c.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday));
  return othersHome;
}

/**
 * Suma de raciones de todas las personas presentes en casa para una comida y
 * día concretos (planificador, otros adultos, niños).
 */
export function servingsForMealDay(
  members: { portion: number; homeSchedule: HomeSchedule | null }[],
  children: { portion: number; homeSchedule: HomeSchedule | null }[],
  meal: MealKey,
  weekday: number,
): number {
  let total = 0;
  for (const m of members) {
    if ((m.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday)) total += Number(m.portion) || 1;
  }
  for (const c of children) {
    if ((c.homeSchedule ?? EMPTY_SCHEDULE)[meal].includes(weekday))
      total += Number(c.portion) || 0.5;
  }
  return Math.round(total * 100) / 100;
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

/**
 * Paleta de avatares de la pestaña Familia: cinco tonos cálidos tomados del
 * rediseño. `#ffe7d3` y `#e1f2e4` ya son `--primary-soft` / `--success-soft` del
 * sistema; el resto son variantes en la misma familia. `soft` es el fondo del
 * círculo, `ink` la inicial encima.
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
 * color en la BD: se calcula al vuelo para que cada cara tenga su tono y no
 * cambie entre recargas.
 */
export function personColor(seed: string): { soft: string; ink: string } {
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum += seed.charCodeAt(i);
  return PERSON_COLORS[sum % PERSON_COLORS.length]!;
}
