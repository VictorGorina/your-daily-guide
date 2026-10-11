/**
 * La cola de trabajos largos vista desde la pantalla (ticket 40 de la
 * auditoría). Generar el plan, ajustarlo al objetivo y recalcularlo pueden
 * responder `{ jobId }` en vez del resultado: el trabajo sigue en el servidor
 * y la pantalla lee su fila de `jobs` (RLS: solo la propia) hasta que termina.
 * Se puede salir y volver: el trabajo no depende de la petición.
 *
 * Sin imports a propósito: este archivo es idéntico en `src/lib/` y
 * `mobile/lib/` (lo vigila `scripts/check-shared-drift.sh`). Quién lee la fila
 * lo pone cada app (`jobs-read.ts`).
 */

/** Lo que responde el servidor cuando ha dejado el trabajo en la cola. */
export type QueuedJob = { jobId: string };

export function isQueuedJob(out: unknown): out is QueuedJob {
  return !!out && typeof out === "object" && typeof (out as QueuedJob).jobId === "string";
}

/** Las columnas de `jobs` que lee la pantalla. */
export const JOB_COLUMNS = "id, kind, status, input, result, error";

export type JobRowView = {
  id: string;
  kind: string;
  status: string;
  input?: unknown;
  result: unknown;
  error: string | null;
};

export const ACTIVE_JOB_STATUSES = ["queued", "running"];

export type JobOutcome =
  | { state: "pending" }
  | { state: "done"; result: unknown }
  /** `message: null`: no hay texto para la persona; la pantalla pone el suyo. */
  | { state: "failed"; message: string | null };

/** Lo que `claim_job()` escribe cuando un trabajo agota sus intentos. */
const EXHAUSTED = "attempts_exhausted";

export function jobOutcome(row: Pick<JobRowView, "status" | "result" | "error">): JobOutcome {
  if (row.status === "done") return { state: "done", result: row.result ?? null };
  if (row.status === "failed") {
    return { state: "failed", message: row.error && row.error !== EXHAUSTED ? row.error : null };
  }
  return { state: "pending" };
}

/**
 * Un trabajo que terminó mal, o que no se ha podido seguir. `message` es el
 * texto escrito para la persona, o vacío si no hay ninguno (la pantalla pone
 * entonces su mensaje genérico: `error.message || t(…)`).
 */
export class JobFailedError extends Error {
  constructor(message: string | null) {
    super(message ?? "");
    this.name = "JobFailedError";
  }
}

export type WaitOptions = {
  /** Cada cuánto se mira la fila. */
  intervalMs?: number;
  /** Cuánto se espera como mucho: tres intentos muertos son ~15 min. */
  timeoutMs?: number;
  /** Lecturas fallidas seguidas (sin red, fila que no aparece) antes de rendirse. */
  maxMisses?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Espera a que el trabajo termine y devuelve su `result`. Lanza
 * `JobFailedError` si falla, si la fila deja de poder leerse o si se acaba el
 * tiempo (el trabajo puede seguir vivo: al volver a la pantalla se retoma).
 */
export async function waitForJob(
  jobId: string,
  read: (jobId: string) => Promise<JobRowView | null>,
  opts: WaitOptions = {},
): Promise<unknown> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 16 * 60_000;
  const maxMisses = opts.maxMisses ?? 5;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;

  const started = now();
  let misses = 0;
  for (;;) {
    const row = await read(jobId).catch(() => null);
    if (row) {
      misses = 0;
      const outcome = jobOutcome(row);
      if (outcome.state === "done") return outcome.result;
      if (outcome.state === "failed") throw new JobFailedError(outcome.message);
    } else if (++misses >= maxMisses) {
      throw new JobFailedError(null);
    }
    if (now() - started >= timeoutMs) throw new JobFailedError(null);
    await sleep(intervalMs);
  }
}

/**
 * Resuelve una respuesta que puede ser el resultado o un `{ jobId }`: con el
 * resultado lo devuelve tal cual; con un trabajo, espera y devuelve el suyo.
 */
export async function settleJob<Result, JobResult>(
  out: Result | QueuedJob,
  read: (jobId: string) => Promise<JobRowView | null>,
  opts?: WaitOptions,
): Promise<Result | JobResult> {
  if (!isQueuedJob(out)) return out;
  return (await waitForJob(out.jobId, read, opts)) as JobResult;
}
