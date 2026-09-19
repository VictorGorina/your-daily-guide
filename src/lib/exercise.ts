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
 * reconocer qué se ha comido) aquí la actividad, los minutos y la intensidad
 * ya definen la cifra sin ambigüedad.
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

export const EXERCISE_ACTIVITIES: { label: string; kcalPerMin: number }[] = [
  { label: "Correr", kcalPerMin: 10 },
  { label: "Caminar", kcalPerMin: 4 },
  { label: "Bici", kcalPerMin: 8 },
  { label: "Gimnasio / pesas", kcalPerMin: 7 },
  { label: "Natación", kcalPerMin: 9 },
  { label: "Otra", kcalPerMin: 6 },
];

export const EXERCISE_INTENSITY: { label: string; factor: number }[] = [
  { label: "Suave", factor: 0.8 },
  { label: "Normal", factor: 1 },
  { label: "Fuerte", factor: 1.25 },
];

export const EXERCISE_MINUTES_MIN = 5;
export const EXERCISE_MINUTES_MAX = 360;
/** Entradas como mucho por día: un tope contra un bucle, no un límite real. */
export const EXERCISE_MAX_ENTRIES = 30;

/** kcal quemadas (positivo), con la misma fórmula que veía la persona antes de guardar. */
export function estimateExerciseKcal(activity: string, minutes: number, intensity: string): number {
  const base = EXERCISE_ACTIVITIES.find((a) => a.label === activity)?.kcalPerMin ?? 6;
  const factor = EXERCISE_INTENSITY.find((i) => i.label === intensity)?.factor ?? 1;
  return Math.round(minutes * base * factor);
}

export type ExerciseEntry = {
  id: string;
  activity: string;
  minutes: number;
  intensity: string;
  /** Negativo: kcal quemadas como déficit frente al plan. */
  kcal: number;
  /** Cuándo se apuntó (ISO). */
  at: string;
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
  return {
    id,
    activity,
    minutes,
    intensity: String(o.intensity ?? EXERCISE_INTENSITY[1]!.label),
    kcal,
    at: String(o.at ?? ""),
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

/**
 * Junta el reajuste nuevo con el que ya había ese día, para que la hoja "Ver"
 * enseñe todo lo que ha movido el deporte y no solo la última pasada: de cada
 * comida se conserva el plato de ANTES del primer reajuste y el de DESPUÉS
 * del último, y se quita la que ha vuelto a quedar como estaba.
 */
export function mergeExerciseAdjustment(
  prev: ExerciseAdjustment | null | undefined,
  next: ExerciseAdjustment,
): ExerciseAdjustment {
  if (!prev) return next;
  const byCell = new Map<string, MealChange>();
  for (const c of prev.changes) byCell.set(`${c.date}:${c.slot}`, c);
  for (const c of next.changes) {
    const key = `${c.date}:${c.slot}`;
    const earlier = byCell.get(key);
    byCell.set(key, earlier ? { ...c, before: earlier.before } : c);
  }
  const changes = [...byCell.values()]
    .filter((c) => c.before !== c.after)
    .sort((a, b) =>
      a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date),
    );
  return { changes, summary: next.summary || prev.summary, kcal: prev.kcal + next.kcal };
}

/** Lo que se le cuenta a la IA al recolocar. */
export function exerciseNote(entries: readonly ExerciseEntry[], pendingKcal: number): string {
  const list = entries
    .map(
      (e) =>
        `${e.activity} ${e.minutes} min (${e.intensity.toLowerCase()}, ~${-e.kcal} kcal quemadas)`,
    )
    .join("; ");
  return pendingKcal < 0
    ? `Hoy ha hecho deporte: ${list || "nada apuntado"}. Reponlo en los días siguientes.`
    : `Ha borrado deporte de hoy que ya se había compensado (queda: ${list || "nada"}). Quita esa energía de más de los días siguientes.`;
}

/**
 * Frase para Hoy cuando el último asentamiento no ha movido el plan por un
 * motivo que conviene explicar. `null` si no hay nada que decir (por debajo
 * del umbral el deporte solo suma: no hace falta avisar).
 */
export function exerciseOutcomeNote(outcome: ExerciseOutcome | null | undefined): string | null {
  switch (outcome) {
    case "no-days":
      return "No quedan días este mes para reponerlo.";
    case "shared-only":
      return "Tus comidas de estos días son de la casa: no las cambio por tu deporte.";
    case "no-meals":
      return "No planificas comidas ni cenas en las que reponerlo.";
    case "no-plan":
      return "Aún no tienes plan este mes: queda apuntado.";
    case "pregnancy":
      return "Queda apuntado. Con embarazo o lactancia no recorto los próximos días.";
    default:
      return null;
  }
}
