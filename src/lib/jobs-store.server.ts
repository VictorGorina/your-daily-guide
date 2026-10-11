import type { Json } from "@/integrations/supabase/types";

import { type JobInputs, type JobKind, type JobRow, sameJobTarget } from "@/lib/jobs";
import type { JobStore } from "@/lib/jobs-run.server";
import { errorText } from "@/lib/log.server";

/**
 * La cola de trabajos largos sobre la tabla `jobs` (ticket 40 de la auditoría).
 *
 * Todo va con `supabaseAdmin`: `authenticated` solo puede LEER su fila, así
 * que crear, reclamar y cerrar un trabajo es cosa del servidor. Se salta RLS:
 * el `userId` de `enqueueJob` es siempre el del JWT (`context.userId`).
 */

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

const ACTIVE = ["queued", "running"];

/** El almacén que usa el trabajador (`runNextJob`). */
export const jobStore: JobStore = {
  async claim() {
    const client = await admin();
    const { data, error } = await client.rpc("claim_job");
    if (error) throw new Error(`claim_job: ${errorText(error)}`);
    const row = (data ?? [])[0];
    return row ? (row satisfies JobRow) : null;
  },

  async finish(job, outcome) {
    const client = await admin();
    const { error } = await client
      .from("jobs")
      .update({
        status: outcome.status,
        result: outcome.status === "done" ? ((outcome.result ?? null) as Json) : null,
        error: outcome.status === "failed" ? outcome.error : null,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      // Solo el intento que lo reclamó: si este se dio por muerto y otro lo
      // relevó (`attempts` + 1), o ya agotó los intentos, no cambia nada.
      .eq("status", "running")
      .eq("attempts", job.attempts);
    if (error) throw new Error(`jobs.finish: ${errorText(error)}`);
  },
};

export type Enqueued = {
  id: string;
  /** `false`: ya había uno activo de ese tipo y se devuelve ese. */
  created: boolean;
  /** Con `created: false`, si el que había pide lo mismo (`sameJobTarget`). */
  sameTarget: boolean;
};

/**
 * Deja un trabajo en la cola. Solo hay uno activo por persona y tipo (índice
 * único `jobs_one_active_idx`): si choca, devuelve el que hay, y `sameTarget`
 * dice si sirve a quien encola. Lanza si la base de datos falla: quien llama
 * hace entonces el trabajo en línea.
 */
export async function enqueueJob<K extends JobKind>(
  userId: string,
  kind: K,
  input: JobInputs[K],
): Promise<Enqueued> {
  const client = await admin();
  // Dos vueltas: si el activo termina entre el choque y la lectura, ya no
  // estorba y el segundo `insert` entra.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: inserted, error } = await client
      .from("jobs")
      .insert({ user_id: userId, kind, input: input as Json })
      .select("id")
      .single();
    if (!error && inserted) return { id: inserted.id, created: true, sameTarget: true };
    if ((error as { code?: string } | null)?.code !== "23505") {
      throw new Error(`jobs.insert: ${errorText(error)}`);
    }

    const { data: active, error: readError } = await client
      .from("jobs")
      .select("id, input")
      .eq("user_id", userId)
      .eq("kind", kind)
      .in("status", ACTIVE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) throw new Error(`jobs.active: ${errorText(readError)}`);
    if (active) {
      return {
        id: active.id,
        created: false,
        sameTarget: sameJobTarget(kind, active.input, input),
      };
    }
  }
  throw new Error("jobs.insert: choca con un trabajo activo que no aparece");
}
