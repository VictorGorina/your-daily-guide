import { GENERIC_ERROR_MESSAGE, publicError } from "@/lib/public-error";
import { asCadence, type PlanFitMark, type ShoppingCadence } from "@/lib/plan-shared";

/**
 * Cola de trabajos largos (ticket 40 de la auditoría, ARQ-03), la parte pura.
 *
 * Generar el plan tarda ~100 s dentro de una función de 300 s y el cliente
 * esperaba con la conexión abierta. Con la cola, la petición deja una fila en
 * `jobs` y responde `{ jobId }`; un trabajador (`POST /api/jobs/run`) la
 * reclama y la ejecuta, y la pantalla lee su fila hasta que termina.
 *
 * - Es OPT-IN por petición (`async: true`): las builds del móvil ya instaladas
 *   esperan el resultado en la respuesta y siguen recibiéndolo.
 * - `JOBS_ENABLED` es el interruptor: sin ella nadie encola.
 * - Solo se reintenta un intento MUERTO (la función se cortó sin terminar),
 *   nunca uno que acabó con error: cada intento son ~100 s de IA.
 */

export const JOB_KINDS = ["plan_generate", "plan_reflow", "plan_fit"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "queued" | "running" | "done" | "failed";

/** Lo que cada trabajo recibe: lo que su server function ya validó al encolar. */
export type JobInputs = {
  plan_generate: { month: string; cadence: ShoppingCadence; today: string };
  plan_reflow: { month: string; today: string; scope: "meals" | "full" };
  plan_fit: { month: string; today: string };
};

/**
 * Lo que cada trabajo deja en `jobs.result`. Sin el plan ni la compra: la
 * pantalla los vuelve a leer al terminar, y la fila no carga con ellos.
 */
export type JobResults = {
  plan_generate: { firstPlan: boolean };
  plan_reflow: {
    skipped?: "past" | "not-planner" | "no-plan";
    scope?: "meals" | "full";
    summary?: string;
    synced?: number;
  };
  plan_fit: { fit: PlanFitMark | null };
};

/** La fila de `jobs` que maneja el trabajador. */
export type JobRow = {
  id: string;
  user_id: string;
  kind: string;
  input: unknown;
  status: string;
  attempts: number;
};

/** Lo que la pantalla necesita de un trabajo. */
export type JobView<K extends JobKind = JobKind> = {
  id: string;
  kind: K;
  status: JobStatus;
  result: JobResults[K] | null;
  /** Solo con `failed`: texto que se puede enseñar. */
  error: string | null;
};

export const isJobKind = (value: unknown): value is JobKind => JOB_KINDS.includes(value as JobKind);

const STATUSES: readonly JobStatus[] = ["queued", "running", "done", "failed"];

/** ¿Sigue pendiente? (en cola o en marcha) */
export const isJobActive = (status: string): boolean => status === "queued" || status === "running";

/** `JOBS_ENABLED` definida y distinta de "0"/"false". */
export function jobsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.JOBS_ENABLED ?? "").trim().toLowerCase();
  return raw !== "" && raw !== "0" && raw !== "false";
}

/** Lo que `claim_job()` escribe cuando un trabajo agota sus intentos muertos. */
export const JOB_EXHAUSTED = "attempts_exhausted";

/**
 * El texto que se guarda en `jobs.error`: el del error si está escrito para la
 * persona (`ValidationError`, `UserFacingError`, cuota), el genérico si no.
 * Misma tabla que `publicError`: la fila la lee el cliente.
 */
export function jobErrorText(error: unknown): string {
  const shown = publicError(error);
  return shown === error && error instanceof Error && error.message
    ? error.message
    : GENERIC_ERROR_MESSAGE;
}

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lee `jobs.input` con su forma. Lo escribió el servidor ya validado, pero
 * sale de un `jsonb`: si no encaja, el trabajo falla en vez de ejecutarse con
 * medio dato. Devuelve `null` si no vale.
 */
export function parseJobInput<K extends JobKind>(kind: K, input: unknown): JobInputs[K] | null {
  const raw = (input ?? {}) as Record<string, unknown>;
  const month = typeof raw.month === "string" && MONTH.test(raw.month) ? raw.month : null;
  const today = typeof raw.today === "string" && DAY.test(raw.today) ? raw.today : null;
  if (!month || !today) return null;
  if (kind === "plan_generate") {
    const cadence = asCadence(raw.cadence);
    return cadence ? ({ month, today, cadence } as JobInputs[K]) : null;
  }
  if (kind === "plan_reflow") {
    if (raw.scope !== "meals" && raw.scope !== "full") return null;
    return { month, today, scope: raw.scope } as JobInputs[K];
  }
  return { month, today } as JobInputs[K];
}

/**
 * ¿Piden lo mismo dos entradas del mismo tipo? Solo hay un trabajo activo por
 * persona y tipo, pero no todos valen por otro: rehacer el plan con la familia
 * (`full`) no es el recálculo de la despensa (`meals`), ni noviembre es
 * diciembre. `today` no cuenta: es cuándo se pidió, no qué.
 */
export function sameJobTarget(kind: JobKind, a: unknown, b: unknown): boolean {
  const target = (input: unknown) => {
    const parsed = parseJobInput(kind, input);
    return parsed ? JSON.stringify({ ...parsed, today: null }) : null;
  };
  const left = target(a);
  return left !== null && left === target(b);
}

/** La fila de `jobs`, como la ve la pantalla. `null` si no es un trabajo conocido. */
export function jobView(row: {
  id: string;
  kind: string;
  status: string;
  result: unknown;
  error: string | null;
}): JobView | null {
  if (!isJobKind(row.kind) || !STATUSES.includes(row.status as JobStatus)) return null;
  const status = row.status as JobStatus;
  return {
    id: row.id,
    kind: row.kind,
    status,
    result: status === "done" ? ((row.result ?? null) as JobView["result"]) : null,
    error:
      status !== "failed"
        ? null
        : !row.error || row.error === JOB_EXHAUSTED
          ? GENERIC_ERROR_MESSAGE
          : row.error,
  };
}
