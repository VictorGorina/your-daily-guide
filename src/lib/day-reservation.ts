/**
 * Reserva y liberación de los tres libros de cuentas del día (`settleDay`,
 * feature `balance-del-dia`; caducidad de la reserva, ticket 22). Solo lo usa
 * el servidor: vivía al final de `day-balance.ts`, y separado deja ese archivo
 * igual que su copia del móvil, que el drift check vigila (ticket 10).
 *
 * Puro (solo lógica, sin I/O).
 */

import { dayBalance, type DayAdjustmentRecord } from "@/lib/day-balance";
import { pendingExerciseKcal, type DayExercise } from "@/lib/exercise";
import type { MealHabit } from "@/lib/plan-shared";
import { pendingSnackKcal, type DaySnacks } from "@/lib/snacks";

// ---------------------------------------------------------------------------
// Reserva y liberación de los tres libros (`settleDay`)
// ---------------------------------------------------------------------------

/** Lo que `settleDay` marcó como compensado antes de llamar a la IA. */
export type DayReservation = {
  labels: string[];
  snackKcal: number;
  exerciseKcal: number;
  total: number;
  /** Proteína pendiente (g, con signo) que se reservó con las comidas. */
  protein: number;
};

export const EMPTY_RESERVATION: DayReservation = {
  labels: [],
  snackKcal: 0,
  exerciseKcal: 0,
  total: 0,
  protein: 0,
};

/** Los tres libros de cuentas del día, tal como están en `daily_logs`. */
type DayBooks = {
  habits: MealHabit[];
  snacks: DaySnacks | null;
  exercise: DayExercise | null;
};

type DayBooksPatch = Partial<DayBooks>;

/**
 * Reserva: marca los tres libros como compensados (comidas cambiadas con
 * `swapCompensated`, picoteo y deporte sumando a su `compensatedKcal`) sobre la
 * fila recién leída, para que un asentamiento simultáneo no compense lo mismo
 * dos veces. Devuelve el parche y lo reservado, que es lo que `releaseDay`
 * devuelve si la compensación no llega a aplicarse.
 */
export function reserveDay(current: DayBooks): {
  patch: DayBooksPatch;
  reservation: DayReservation;
} {
  const now = dayBalance(current.habits, current.snacks, current.exercise);
  const labels = current.habits
    .filter((h) => (h.swapKcalDelta != null || h.swapProteinDelta != null) && !h.swapCompensated)
    .map((h) => h.label);
  const pendingSnacks = pendingSnackKcal(current.snacks);
  const pendingExercise = pendingExerciseKcal(current.exercise);
  const reservation: DayReservation = {
    labels,
    snackKcal: pendingSnacks,
    exerciseKcal: pendingExercise,
    total: now.pending,
    protein: now.proteinPending,
  };
  const patch: DayBooksPatch = {
    habits: current.habits.map((h) =>
      labels.includes(h.label) ? { ...h, swapCompensated: true } : h,
    ),
    ...(pendingSnacks && current.snacks
      ? {
          snacks: {
            ...current.snacks,
            compensatedKcal: current.snacks.compensatedKcal + pendingSnacks,
          },
        }
      : {}),
    ...(pendingExercise && current.exercise
      ? {
          exercise: {
            ...current.exercise,
            compensatedKcal: current.exercise.compensatedKcal + pendingExercise,
          },
        }
      : {}),
  };
  return { patch, reservation };
}

/** Devuelve una reserva de `reserveDay` sobre la fila actual (releída). */
export function releaseDay(current: DayBooks, reservation: DayReservation): DayBooksPatch {
  return {
    habits: current.habits.map((h) =>
      reservation.labels.includes(h.label) ? { ...h, swapCompensated: false } : h,
    ),
    ...(reservation.snackKcal && current.snacks
      ? {
          snacks: {
            ...current.snacks,
            compensatedKcal: current.snacks.compensatedKcal - reservation.snackKcal,
          },
        }
      : {}),
    ...(reservation.exerciseKcal && current.exercise
      ? {
          exercise: {
            ...current.exercise,
            compensatedKcal: current.exercise.compensatedKcal - reservation.exerciseKcal,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Reservas con caducidad (ticket 22 de la auditoría, CAL-09)
// ---------------------------------------------------------------------------

/**
 * Una reserva en vuelo, guardada en `daily_logs.adjustment.pending` en la MISMA
 * escritura que marca los libros. Si la petición muere entre la reserva y el
 * resultado (Vercel la corta, o la liberación falla), el día se quedaría
 * "compensado" sin que nada se moviera; con esto, el siguiente asentamiento la
 * encuentra caducada y la devuelve. Guarda lo reservado porque quien la libera
 * es otra petición, que no lo tiene en memoria. Es una lista: dos asentamientos
 * seguidos no se pisan la marca.
 */
export type PendingReservation = { id: string; since: string; reservation: DayReservation };

/**
 * Más que el `maxDuration` de la función (300 s, `vite.config.ts`): la reserva
 * se escribe después de empezar la petición, así que pasado esto quien la hizo
 * ya no existe. Si se sube `maxDuration`, hay que subir esto.
 */
export const RESERVATION_TTL_MS = 5 * 60_000;

/** Cifra de la BD o 0 (mismo criterio que `cleanDayAdjustment` en `day-balance.ts`). */
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const cleanReservation = (raw: unknown): DayReservation | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    labels: Array.isArray(o.labels)
      ? o.labels.filter((l): l is string => typeof l === "string")
      : [],
    snackKcal: num(o.snackKcal),
    exerciseKcal: num(o.exerciseKcal),
    total: num(o.total),
    protein: num(o.protein),
  };
};

/** Lectura defensiva de las reservas en vuelo de la columna `adjustment`. */
export function cleanPendingReservations(adjustment: unknown): PendingReservation[] {
  const list = (adjustment as { pending?: unknown } | null)?.pending;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const reservation = cleanReservation(o.reservation);
    return typeof o.id === "string" && typeof o.since === "string" && reservation
      ? [{ id: o.id, since: o.since, reservation }]
      : [];
  });
}

/** Las que llevan más de `RESERVATION_TTL_MS`. Una fecha ilegible cuenta como caducada. */
export function staleReservations(
  list: readonly PendingReservation[],
  now = Date.now(),
): PendingReservation[] {
  return list.filter((p) => {
    const since = Date.parse(p.since);
    return !Number.isFinite(since) || now - since > RESERVATION_TTL_MS;
  });
}

/** Devuelve varias reservas seguidas sobre la fila actual (`releaseDay` encadenado). */
export function releaseReservations(
  current: DayBooks,
  list: readonly PendingReservation[],
): DayBooksPatch {
  let books = current;
  for (const p of list) books = { ...books, ...releaseDay(books, p.reservation) };
  return { habits: books.habits, snacks: books.snacks, exercise: books.exercise };
}

/**
 * El valor de la columna `adjustment`: el registro del día y, si hay, las
 * reservas en vuelo. `null` si no queda nada.
 */
export function adjustmentColumn(
  record: DayAdjustmentRecord | null,
  pending: readonly PendingReservation[],
): (DayAdjustmentRecord & { pending?: PendingReservation[] }) | null {
  if (!record && !pending.length) return null;
  return {
    ...(record ?? { adjustment: null, lastOutcome: null }),
    ...(pending.length ? { pending: [...pending] } : {}),
  };
}
