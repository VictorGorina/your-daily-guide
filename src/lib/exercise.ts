import { exerciseNetKcal, type TrainingRoutine } from "@/lib/nutrition/exercise-energy";
import type { MealChange } from "@/lib/plan-shared";

/**
 * Deporte de un día (`daily_logs.exercise`, mismo patrón que `picoteo-hoy` en
 * src/lib/snacks.ts, pero al revés: un déficit en vez de un exceso).
 *
 * Vive en su propia columna y no en `habits` por el mismo motivo que el
 * picoteo: `reconcileHabits` reconstruye `habits` desde el plan en cada carga
 * y lo borraría, y así el deporte no cuenta en el semáforo de cumplimiento.
 *
 * Las kcal quemadas se calculan con una tabla determinista
 * (`estimateExerciseKcal`), no con IA: a diferencia del picoteo (que necesita
 * reconocer qué se ha comido) aquí la actividad, los minutos, la intensidad y
 * el peso ya definen la cifra sin ambigüedad.
 *
 * Ticket 16 de `precision-nutricional` (D9): la cifra es NETA y depende del
 * peso (`exerciseNetKcal`, MET − 1), y la rutina habitual ya va dentro del
 * objetivo (`energyTargets`), así que solo desvía el día lo que PASA de ella:
 * la 4.ª sesión de quien entrena 3, o el exceso de una sesión el doble de larga
 * de lo habitual (`splitRoutineSession`).
 *
 * Convención de signo: `ExerciseEntry.kcal` es NEGATIVO (un déficit frente al
 * plan), para poder reusar `compensationNeed`/`reflowMeals` sin invertir nada
 * — el mismo camino que ya usa el picoteo, que ya contempla un `kcalDelta`
 * negativo como "déficit extra (por ejemplo ejercicio)"
 * (`plan.functions.ts`, `reflowMeals`). La UI muestra `-entry.kcal` (positivo,
 * "kcal quemadas").
 *
 * Lógica pura: la usan Hoy, el detalle de un día pasado y el servidor
 * (`exercise.functions.ts`).
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

/**
 * kcal NETAS quemadas (positivo) con el peso de la persona: lo que se gasta por
 * encima del reposo, que ya está en el gasto diario. La misma fórmula que ve la
 * persona antes de guardar. Antes daba 300 kcal por 30 min de correr a
 * cualquiera; lo real (neto) es ~220 a 50 kg y ~440 a 100 kg (H20).
 */
export function estimateExerciseKcal(
  activity: string,
  minutes: number,
  intensity: string,
  weightKg?: number | null,
): number {
  const kg = Number(weightKg) > 0 ? Number(weightKg) : DEFAULT_EXERCISE_WEIGHT_KG;
  return exerciseNetKcal(activity, minutes, intensity, kg);
}

/** Cómo se reparte una sesión entre la rutina (ya en el objetivo) y lo extra. */
export type RoutineSplit = {
  /** kcal netas de la sesión entera (positivo). */
  totalKcal: number;
  /** ¿Cuenta como una de las sesiones de la rutina de esta semana? */
  routine: boolean;
  /** Parte que ya va dentro del objetivo (positivo). */
  routineKcal: number;
  /** Parte que desvía el día (positivo): lo que pasa de la sesión típica. */
  extraKcal: number;
  /** Qué sesión de la rutina es esta semana (1.ª, 2.ª…) y de cuántas. */
  routineIndex?: number;
  routineOf?: number;
};

/**
 * Reparte una sesión entre rutina y extra (D9, ticket 16).
 *
 * - Sin rutina (o perfil antiguo, cuyo factor de actividad ya incluía el
 *   deporte y no la separa: `routine = null`): todo es extra, como antes.
 * - Si esta semana quedan sesiones de la rutina por hacer, esta es una: su
 *   parte "normal" (una sesión típica de su rutina) ya está en el objetivo y
 *   solo cuenta como extra lo que la pase (90 min cuando lo habitual son 45).
 * - Con la rutina ya completa, la sesión entera es extra.
 *
 * `routineSessionsBefore` = sesiones de rutina ya apuntadas esta semana ISO.
 */
export function splitRoutineSession(opts: {
  activity: string;
  minutes: number;
  intensity: string;
  weightKg?: number | null;
  routine: TrainingRoutine | null;
  routineSessionsBefore: number;
}): RoutineSplit {
  const kg = Number(opts.weightKg) > 0 ? Number(opts.weightKg) : DEFAULT_EXERCISE_WEIGHT_KG;
  const totalKcal = exerciseNetKcal(opts.activity, opts.minutes, opts.intensity, kg);
  const r = opts.routine;
  if (!r || r.sessionsPerWeek <= 0 || opts.routineSessionsBefore >= r.sessionsPerWeek) {
    return { totalKcal, routine: false, routineKcal: 0, extraKcal: totalKcal };
  }
  const typical = exerciseNetKcal(r.activity, r.minutes, r.intensity, kg);
  const routineKcal = Math.min(totalKcal, typical);
  return {
    totalKcal,
    routine: true,
    routineKcal,
    extraKcal: totalKcal - routineKcal,
    routineIndex: opts.routineSessionsBefore + 1,
    routineOf: r.sessionsPerWeek,
  };
}

/** Sesiones de rutina ya apuntadas en una lista de días (la semana en curso). */
export function routineSessionsIn(days: readonly (DayExercise | null | undefined)[]): number {
  return days.reduce((n, day) => n + (day?.entries ?? []).filter((e) => e.routine).length, 0);
}

/** Lunes de la semana ISO de una fecha (YYYY-MM-DD) y los días de lunes a esa fecha. */
export function isoWeekDaysUntil(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  const weekday = (day.getUTCDay() + 6) % 7; // lunes = 0
  const out: string[] = [];
  for (let i = weekday; i >= 0; i--) {
    out.push(new Date(day.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export type ExerciseEntry = {
  id: string;
  activity: string;
  minutes: number;
  intensity: string;
  /**
   * Negativo: la parte que DESVÍA el día frente al plan. En una sesión de su
   * rutina, solo lo que pasa de la sesión típica (ticket 16); una entrada
   * antigua, sin `routine`, cuenta entera como antes.
   */
  kcal: number;
  /** Cuándo se apuntó (ISO). */
  at: string;
  /** Es una de las sesiones de la rutina de la semana: su parte normal ya va en el objetivo. */
  routine?: boolean;
  /** kcal (positivo) que ya estaban dentro del objetivo por ser de la rutina. */
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

export type ExerciseAdjustment = NonNullable<DayExercise["adjustment"]>;
