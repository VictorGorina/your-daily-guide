import { createFileRoute } from "@tanstack/react-router";

import { cronSecretMatches } from "@/lib/cron-secret.server";
import { runNextJob } from "@/lib/jobs-run.server";
import { jobStore } from "@/lib/jobs-store.server";
import { errorText, logEvent } from "@/lib/log.server";
import { planJobRunners } from "@/lib/plan/job-runners.server";

// El trabajador de la cola de trabajos largos (ticket 40 de la auditoría). Sin
// auth de usuario: lo llama `pg_cron` cada minuto si hay algo en la cola (ver
// supabase/migrations/20261011130000_jobs.sql) y quien encola, nada más
// responder. Mismo secreto compartido que `/api/cron/dispatch`.
//
// UN trabajo por llamada: generar un plan se lleva casi todo el presupuesto de
// la función (270 s de 300); el siguiente lo recoge el cron.
export const Route = createFileRoute("/api/jobs/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronSecretMatches(request.headers.get("x-cron-secret")))) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const summary = await runNextJob(jobStore, planJobRunners);
          return new Response(JSON.stringify(summary), {
            headers: { "content-type": "application/json" },
          });
        } catch (error) {
          // Reclamar o cerrar ha fallado (la base de datos): el trabajo sigue
          // "en marcha" con su cerrojo y `claim_job()` lo releva al caducar.
          logEvent("error", "job_worker_failed", { error: errorText(error) });
          return new Response("Error al ejecutar el trabajo", { status: 500 });
        }
      },
    },
  },
});
