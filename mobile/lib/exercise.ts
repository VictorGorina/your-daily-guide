import { exerciseNetKcal } from "./exercise-energy";
import type { MealChange } from "./plan-shared";

/**
 * Deporte de un día (`daily_logs.exercise`, mismo patrón que `picoteo-hoy` en
 * `snacks.ts`, pero al revés: un déficit en vez de un exceso).
 *
 * Convención de signo: `ExerciseEntry.kcal` es NEGATIVO (un déficit frente al
 * plan), para poder reusar `compensationNeed`/`reflowMeals` (en la web, que es
 * quien tiene el servidor) sin invertir nada. La UI muestra `-entry.kcal`
 * (positivo, "kcal quemadas").
 *
 * Ticket 16 de `precision-nutricional`: la cifra es NETA y con el peso, y una
 * sesión de la rutina de la semana solo desvía lo que pasa de ella. Ese reparto
 * lo decide el servidor al guardar (`splitRoutineSession` en la web).
 *
 * Copia de `src/lib/exercise.ts` de la web (no hay código compartido entre las
 * dos apps). La usan Hoy y el detalle de un día pasado; el servidor es la web.
 */

/** Las mismas etiquetas que la tabla MET de `exercise-energy.ts`. */
export const EXERCISE_ACTIVITIES: { label: string }[] = [
  { label: "Correr" },
  { label: "Caminar" },
  { label: "Bici" },
  { label: "Gimnasio / pesas" },
  { label: "Natación" },
  { label: "Otra" },
];

export const EXERCISE_INTENSITY: { label: string }[] = [
  { label: "Suave" },
  { label: "Normal" },
  { label: "Fuerte" },
];

/** Peso con el que se calcula si el perfil no lo tiene. */
export const DEFAULT_EXERCISE_WEIGHT_KG = 70;

export const EXERCISE_MINUTES_MIN = 5;
export const EXERCISE_MINUTES_MAX = 360;
/** Entradas como mucho por día: un tope contra un bucle, no un límite real. */
export const EXERCISE_MAX_ENTRIES = 30;

/** kcal NETAS quemadas (positivo) con el peso de la persona (ticket 16). */
export function estimateExerciseKcal(
  activity: string,
  minutes: number,
  intensity: string,
  weightKg?: number | null,
): number {
  const kg = Number(weightKg) > 0 ? Number(weightKg) : DEFAULT_EXERCISE_WEIGHT_KG;
  return exerciseNetKcal(activity, minutes, intensity, kg);
}

export type ExerciseEntry = {
  id: string;
  activity: string;
  minutes: number;
  intensity: string;
  /**
   * Negativo: la parte que DESVÍA el día. En una sesión de su rutina, solo lo
   * que pasa de la sesión típica (ticket 16).
   */
  kcal: number;
  /** Cuándo se apuntó (ISO). */
  at: string;
  /** Es una de las sesiones de la rutina de la semana: ya va en el objetivo. */
  routine?: boolean;
  routineKcal?: number;
  /** "2 de 3 esta semana". */
  routineIndex?: number;
  routineOf?: number;
};

export type ExerciseOutcome =
  "adjusted" | "below-threshold" | "pregnancy" | "no-plan" | "no-meals" | "no-days" | "shared-only";

export type DayExercise = {
  entries: ExerciseEntry[];
  /**
   * kcal ya enviadas a compensar, con signo (negativo). Lo pendiente es
   * `Σ kcal − compensatedKcal`: dos actividades seguidas se suman hasta pasar
   * el umbral, borrar una ya compensada deja un pendiente positivo (hay que
   * devolver energía), y volver a asentar el mismo día nunca compensa dos
   * veces.
   */
  compensatedKcal: number;
  /** Último reajuste de días futuros hecho por el deporte de este día. */
  adjustment?: { changes: MealChange[]; summary: string; kcal: number } | null;
  /** Qué pasó la última vez que se asentó el deporte. */
  lastOutcome?: ExerciseOutcome | null;
};

export const EMPTY_EXERCISE: DayExercise = { entries: [], compensatedKcal: 0 };

const EXERCISE_KCAL_MAX = 3000;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const OUTCOMES: readonly ExerciseOutcome[] = [
  "adjusted",
  "below-threshold",
  "pregnancy",
  "no-plan",
  "no-meals",
  "no-days",
  "shared-only",
];

function cleanEntry(raw: unknown): ExerciseEntry | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const activity = String(o.activity ?? "").trim();
  if (!id || !activity) return null;
  const minutes = Math.min(
    EXERCISE_MINUTES_MAX,
    Math.max(EXERCISE_MINUTES_MIN, Math.round(num(o.minutes))),
  );
  const kcal = Math.max(-EXERCISE_KCAL_MAX, Math.min(0, Math.round(num(o.kcal))));
  const routine = o.routine === true;
  const index = Math.round(num(o.routineIndex));
  const of = Math.round(num(o.routineOf));
  return {
    id,
    activity,
    minutes,
    intensity: String(o.intensity ?? EXERCISE_INTENSITY[1]!.label),
    kcal,
    at: String(o.at ?? ""),
    ...(routine
      ? {
          routine,
          routineKcal: Math.max(0, Math.min(EXERCISE_KCAL_MAX, Math.round(num(o.routineKcal)))),
          ...(index > 0 && of > 0 ? { routineIndex: index, routineOf: of } : {}),
        }
      : {}),
  };
}

/** Lectura defensiva de la columna. `null` si no hay nada útil. */
export function cleanDayExercise(raw: unknown): DayExercise | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const entries = (Array.isArray(o.entries) ? o.entries : [])
    .map(cleanEntry)
    .filter((e): e is ExerciseEntry => !!e)
    .slice(0, EXERCISE_MAX_ENTRIES);
  const adj = o.adjustment as Record<string, unknown> | null | undefined;
  const adjustment =
    adj && typeof adj === "object"
      ? {
          changes: (Array.isArray(adj.changes) ? adj.changes : []) as MealChange[],
          summary: String(adj.summary ?? ""),
          kcal: Math.round(num(adj.kcal)),
        }
      : null;
  const lastOutcome = OUTCOMES.includes(o.lastOutcome as ExerciseOutcome)
    ? (o.lastOutcome as ExerciseOutcome)
    : null;
  if (!entries.length && !adjustment && !num(o.compensatedKcal)) return null;
  return {
    entries,
    compensatedKcal: Math.round(num(o.compensatedKcal)),
    adjustment,
    lastOutcome,
  };
}

/** Suma de kcal (negativa) de todo el deporte del día. */
export function exerciseTotals(exercise: DayExercise | null | undefined): number {
  return (exercise?.entries ?? []).reduce((sum, e) => sum + e.kcal, 0);
}

/** ¿Todo el deporte del día fue de su rutina, sin nada extra? (para `balanceNote`). */
export function onlyRoutineExercise(exercise: DayExercise | null | undefined): boolean {
  const entries = exercise?.entries ?? [];
  return entries.length > 0 && entries.every((e) => e.routine && e.kcal === 0);
}

/** kcal de deporte que todavía no se han mandado a compensar (con signo, negativo = pendiente de reponer). */
export function pendingExerciseKcal(exercise: DayExercise | null | undefined): number {
  if (!exercise) return 0;
  return Math.round(exerciseTotals(exercise) - exercise.compensatedKcal);
}

export function withExercise(
  exercise: DayExercise | null | undefined,
  entry: ExerciseEntry,
): DayExercise {
  const base = exercise ?? EMPTY_EXERCISE;
  return { ...base, entries: [...base.entries, entry].slice(-EXERCISE_MAX_ENTRIES) };
}

export function withoutExercise(exercise: DayExercise | null | undefined, id: string): DayExercise {
  const base = exercise ?? EMPTY_EXERCISE;
  return { ...base, entries: base.entries.filter((e) => e.id !== id) };
}
