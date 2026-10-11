import {
  isJobKind,
  jobErrorText,
  type JobInputs,
  type JobKind,
  type JobResults,
  type JobRow,
  parseJobInput,
} from "@/lib/jobs";
import { errorText, logEvent } from "@/lib/log.server";
import { publicError } from "@/lib/public-error";

/**
 * El trabajador de la cola (ticket 40): reclama UN trabajo, lo ejecuta y deja
 * el resultado en su fila. Lo llama `POST /api/jobs/run` (el cron de la base de
 * datos y quien encola, nada más responder).
 *
 * No hay sesión de la persona: cada trabajo corre con el `user_id` de su fila,
 * que puso el servidor al encolar con el del JWT. Por eso `store` y `runners`
 * llegan inyectados: aquí no se toca ningún cliente.
 */

/** Dónde viven los trabajos. La de verdad es `jobs-store.server.ts`. */
export type JobStore = {
  /** Reclama el siguiente trabajo ejecutable (`claim_job()`), o `null`. */
  claim(): Promise<JobRow | null>;
  /**
   * Cierra un trabajo. Solo si sigue siendo de ESTE intento (`attempts`): un
   * intento dado por muerto que acaba tarde no pisa al que lo relevó.
   */
  finish(
    job: Pick<JobRow, "id" | "attempts">,
    outcome: { status: "done"; result: unknown } | { status: "failed"; error: string },
  ): Promise<void>;
};

/** Cada tipo de trabajo, ya con su entrada leída. */
export type JobRunners = {
  [K in JobKind]: (userId: string, input: JobInputs[K]) => Promise<JobResults[K]>;
};

export type JobRunSummary =
  { ran: false } | { ran: true; id: string; kind: string; status: "done" | "failed" };

export async function runNextJob(store: JobStore, runners: JobRunners): Promise<JobRunSummary> {
  const job = await store.claim();
  if (!job) return { ran: false };

  const started = Date.now();
  const base = { job: job.id, kind: job.kind, attempt: job.attempts };
  try {
    if (!isJobKind(job.kind)) throw new Error(`tipo de trabajo desconocido: ${job.kind}`);
    const result = await runKind(runners, job.kind, job.user_id, job.input);
    await store.finish(job, { status: "done", result });
    logEvent("info", "job_done", { ...base, ms: Date.now() - started });
    return { ran: true, id: job.id, kind: job.kind, status: "done" };
  } catch (error) {
    // Un error escrito para la persona (cuota, "ya tiene plan") es un final
    // normal; lo demás es un fallo nuestro y va con su detalle al log.
    const expected = publicError(error) === error;
    logEvent(expected ? "info" : "error", "job_failed", {
      ...base,
      ms: Date.now() - started,
      error: errorText(error),
    });
    await store.finish(job, { status: "failed", error: jobErrorText(error) });
    return { ran: true, id: job.id, kind: job.kind, status: "failed" };
  }
}

async function runKind<K extends JobKind>(
  runners: JobRunners,
  kind: K,
  userId: string,
  rawInput: unknown,
): Promise<JobResults[K]> {
  const input = parseJobInput(kind, rawInput);
  if (!input) throw new Error(`entrada no válida para ${kind}`);
  return runners[kind](userId, input);
}
