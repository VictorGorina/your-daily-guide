import { supabase } from "@/integrations/supabase/client";
import { currentUserId } from "@/lib/auth-headers";
import { ACTIVE_JOB_STATUSES, JOB_COLUMNS, type JobRowView } from "@/lib/job-wait";

/**
 * Lee la fila de un trabajo de la cola (ticket 40). Directo a Supabase con la
 * sesión de la persona: `jobs` solo se deja leer, y solo la fila propia (RLS).
 * Es lo que `waitForJob` sondea cada 3 s, sin pasar por el servidor.
 */
export async function readJob(jobId: string): Promise<JobRowView | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data as JobRowView | null;
}

/**
 * El trabajo de ese tipo que la persona tiene en cola o en marcha, si lo hay
 * (como mucho uno: `jobs_one_active_idx`). Para retomarlo al volver a la
 * pantalla.
 */
export async function fetchActiveJob(kind: string): Promise<JobRowView | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("kind", kind)
    .in("status", ACTIVE_JOB_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as JobRowView | null;
}
