import type { MacroEstimate } from "./daily";
import type { MealChange } from "./plan-shared";

/**
 * Picoteo de un día (`daily_logs.snacks`, feature `picoteo-hoy`).
 *
 * Vive en su propia columna y no en `habits` porque `reconcileHabits`
 * reconstruye `habits` desde el plan en cada carga y lo borraría. Además así un
 * picoteo no cuenta en el semáforo de cumplimiento: no es un fallo.
 *
 * Copia de `src/lib/snacks.ts` de la web (no hay código compartido entre las
 * dos apps). La usan Hoy y el detalle de un día pasado; el servidor es la web.
 */

export type SnackEntry = {
  id: string;
  /** Lo que la persona contó ("un puñado de almendras"). */
  text: string;
  /** Cuándo se apuntó (ISO). */
  at: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  /** `lookup`: calculado con la tabla de composición. `manual`: la persona puso las kcal. */
  source: "lookup" | "manual";
};

export type SnackOutcome =
  "adjusted" | "below-threshold" | "pregnancy" | "no-plan" | "no-meals" | "no-days" | "shared-only";

export type DaySnacks = {
  entries: SnackEntry[];
  /**
   * kcal ya enviadas a compensar, con signo. Lo pendiente es
   * `Σ kcal − compensatedKcal`: dos picoteos pequeños se suman hasta pasar el
   * umbral, borrar uno ya compensado deja un pendiente negativo, y volver a
   * asentar el mismo día nunca compensa dos veces.
   */
  compensatedKcal: number;
  /** Último reajuste de días futuros hecho por el picoteo de este día. */
  adjustment?: { changes: MealChange[]; summary: string; kcal: number } | null;
  /** Qué pasó la última vez que se asentó el picoteo. */
  lastOutcome?: SnackOutcome | null;
};

export const EMPTY_SNACKS: DaySnacks = { entries: [], compensatedKcal: 0 };

/** Límites de lo que se acepta guardar. */
export const SNACK_TEXT_MIN = 2;
export const SNACK_TEXT_MAX = 120;
export const SNACK_KCAL_MAX = 3000;
/** Entradas como mucho por día: un tope contra un bucle, no un límite real. */
export const SNACK_MAX_ENTRIES = 30;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const macro = (v: unknown) => Math.max(0, Math.round(num(v)));

const OUTCOMES: readonly SnackOutcome[] = [
  "adjusted",
  "below-threshold",
  "pregnancy",
  "no-plan",
  "no-meals",
  "no-days",
  "shared-only",
];

function cleanEntry(raw: unknown): SnackEntry | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const text = String(o.text ?? "").trim();
  if (!id || !text) return null;
  return {
    id,
    text: text.slice(0, SNACK_TEXT_MAX),
    at: String(o.at ?? ""),
    kcal: Math.min(SNACK_KCAL_MAX, macro(o.kcal)),
    protein_g: macro(o.protein_g),
    carbs_g: macro(o.carbs_g),
    fat_g: macro(o.fat_g),
    fiber_g: macro(o.fiber_g),
    source: o.source === "manual" ? "manual" : "lookup",
  };
}

/** Lectura defensiva de la columna. `null` si no hay nada útil. */
export function cleanDaySnacks(raw: unknown): DaySnacks | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const entries = (Array.isArray(o.entries) ? o.entries : [])
    .map(cleanEntry)
    .filter((e): e is SnackEntry => !!e)
    .slice(0, SNACK_MAX_ENTRIES);
  const adj = o.adjustment as Record<string, unknown> | null | undefined;
  const adjustment =
    adj && typeof adj === "object"
      ? {
          changes: (Array.isArray(adj.changes) ? adj.changes : []) as MealChange[],
          summary: String(adj.summary ?? ""),
          kcal: Math.round(num(adj.kcal)),
        }
      : null;
  const lastOutcome = OUTCOMES.includes(o.lastOutcome as SnackOutcome)
    ? (o.lastOutcome as SnackOutcome)
    : null;
  if (!entries.length && !adjustment && !num(o.compensatedKcal)) return null;
  return {
    entries,
    compensatedKcal: Math.round(num(o.compensatedKcal)),
    adjustment,
    lastOutcome,
  };
}

/** Suma de macros de todo el picoteo del día. */
export function snackTotals(snacks: DaySnacks | null | undefined): MacroEstimate {
  const totals: MacroEstimate = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const e of snacks?.entries ?? []) {
    totals.kcal += e.kcal;
    totals.protein_g += e.protein_g;
    totals.carbs_g += e.carbs_g;
    totals.fat_g += e.fat_g;
    totals.fiber_g += e.fiber_g;
  }
  return totals;
}

/** kcal de picoteo que todavía no se han mandado a compensar (con signo). */
export function pendingSnackKcal(snacks: DaySnacks | null | undefined): number {
  if (!snacks) return 0;
  return Math.round(snackTotals(snacks).kcal - snacks.compensatedKcal);
}

export function withSnack(snacks: DaySnacks | null | undefined, entry: SnackEntry): DaySnacks {
  const base = snacks ?? EMPTY_SNACKS;
  return { ...base, entries: [...base.entries, entry].slice(-SNACK_MAX_ENTRIES) };
}

export function withoutSnack(snacks: DaySnacks | null | undefined, id: string): DaySnacks {
  const base = snacks ?? EMPTY_SNACKS;
  return { ...base, entries: base.entries.filter((e) => e.id !== id) };
}

/**
 * Macros de una cifra corregida a mano: el resto de macros se escala en la
 * misma proporción que las kcal. Sin cifra calculada de partida, solo hay kcal.
 */
export function scaleSnackMacros(estimate: MacroEstimate | null, kcal: number): MacroEstimate {
  const target = Math.max(0, Math.round(kcal));
  if (!estimate || estimate.kcal <= 0) {
    return { kcal: target, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  }
  const k = target / estimate.kcal;
  return {
    kcal: target,
    protein_g: Math.round(estimate.protein_g * k),
    carbs_g: Math.round(estimate.carbs_g * k),
    fat_g: Math.round(estimate.fat_g * k),
    fiber_g: Math.round(estimate.fiber_g * k),
  };
}

export type SnackAdjustment = NonNullable<DaySnacks["adjustment"]>;
