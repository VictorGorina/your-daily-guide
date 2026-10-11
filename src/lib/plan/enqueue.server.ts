import { afterResponse } from "@/lib/after-response.server";
import type { QueuedJob } from "@/lib/job-wait";
import { type JobInputs, type JobKind, jobsEnabled } from "@/lib/jobs";
import { runNextJob } from "@/lib/jobs-run.server";
import { type Enqueued, enqueueJob, jobStore } from "@/lib/jobs-store.server";
import { errorText, logEvent } from "@/lib/log.server";
import { planJobRunners } from "./job-runners.server";

type Deps = {
  enabled: () => boolean;
  enqueue: (userId: string, kind: JobKind, input: JobInputs[JobKind]) => Promise<Enqueued>;
  /** Arranca el trabajador sin esperar al cron. */
  kick: () => void;
};

const realDeps: Deps = {
  enabled: () => jobsEnabled(),
  enqueue: enqueueJob,
  // En esta misma función, después de responder (`waitUntil`). Si no hay
  // puente o la función muere, el trabajo sigue en cola y lo recoge el cron
  // (`jobs-run`, cada minuto). Reclama el más antiguo, que puede ser de otra
  // persona: el de esta lo recoge entonces el cron.
  kick: () => {
    afterResponse(
      runNextJob(jobStore, planJobRunners).catch((error) =>
        logEvent("error", "job_worker_failed", { error: errorText(error) }),
      ),
    );
  },
};

/**
 * Encola el trabajo o lo hace en la propia petición (ticket 40 de la auditoría).
 *
 * Va a la cola solo si la petición lo pidió (`async: true`: una build del
 * móvil ya instalada espera el resultado en la respuesta) y `JOBS_ENABLED`
 * está definida. Se hace en línea, como siempre, si no; si encolar falla
 * (`job_enqueue_failed`); o si ya hay un trabajo activo de ese tipo que pide
 * OTRA cosa (rehacer el plan mientras se recalcula por la despensa): su
 * `jobId` terminaría «hecho» sin haber hecho lo que se pidió.
 *
 * `precheck` solo corre antes de encolar: lo que la persona debe saber ya
 * (un 400) y no al cabo de un minuto en un trabajo fallido. `run` hace las
 * suyas.
 */
export async function enqueueOrRun<K extends JobKind, R>(
  opts: {
    queued: boolean;
    userId: string;
    kind: K;
    input: JobInputs[K];
    precheck?: () => Promise<void>;
    run: () => Promise<R>;
  },
  deps: Deps = realDeps,
): Promise<R | QueuedJob> {
  if (!opts.queued || !deps.enabled()) return opts.run();
  await opts.precheck?.();

  let job: Enqueued;
  try {
    job = await deps.enqueue(opts.userId, opts.kind, opts.input);
  } catch (error) {
    logEvent("error", "job_enqueue_failed", { kind: opts.kind, error: errorText(error) });
    return opts.run();
  }
  if (!job.created && !job.sameTarget) return opts.run();
  if (job.created) deps.kick();
  return { jobId: job.id };
}
