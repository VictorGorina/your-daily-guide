/**
 * Presupuesto de tiempo de una petición (ticket 22 de la auditoría, PERF-04).
 *
 * Toda la app es UNA función de Vercel con `maxDuration: 300` (`vite.config.ts`).
 * Si la plataforma la mata, se pierde todo lo que no se haya guardado, incluidas
 * recetas ya pagadas. Las server functions largas crean un `Deadline` al entrar
 * y lo pasan hacia abajo; cada paso que llama al modelo acorta su timeout a lo
 * que queda, y si no queda lo bastante, no empieza: lo que falte sale como
 * "Calculando…" y se reintenta (D13).
 *
 * Sin `Deadline`, cada paso usa su timeout de siempre.
 */

export type Deadline = {
  /** Instante (ms de época) en que se acaba el presupuesto. */
  at: number;
  remaining(now?: number): number;
};

/** 30 s de margen bajo los 300 s de Vercel para guardar y responder. */
export const REQUEST_BUDGET_MS = 270_000;

/** Por debajo de esto un paso con el modelo no merece empezar. */
export const MIN_STEP_MS = 10_000;

export const deadlineIn = (ms: number, now = Date.now()): Deadline => ({
  at: now + ms,
  remaining: (n = Date.now()) => Math.max(0, now + ms - n),
});

/** El presupuesto de una petición, desde ya. */
export const requestDeadline = (now = Date.now()): Deadline => deadlineIn(REQUEST_BUDGET_MS, now);

/**
 * Timeout de un paso: el suyo, pero nunca más de lo que queda menos un margen.
 * Sin `Deadline`, el suyo. Puede salir ≤ 0: mírese con `hasTimeFor`.
 */
export const stepTimeout = (
  own: number,
  deadline: Deadline | undefined,
  marginMs = 5_000,
  now = Date.now(),
): number => (deadline ? Math.min(own, deadline.remaining(now) - marginMs) : own);

/** ¿Hay tiempo para empezar un paso con este timeout? */
export const hasTimeFor = (timeoutMs: number, min = MIN_STEP_MS): boolean => timeoutMs >= min;
