import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

// La cola de trabajos largos de punta a punta (ticket 40 de la auditoría),
// contra el Postgres local: el índice único, `claim_job()` y la política RLS
// de `jobs` son los de verdad, que es lo que los tests con el doble no ven.
// El trabajo es el barato: el plan de Ana (`supabase/seed.sql`) no lleva
// `targetsVersion`, así que su ajuste termina en `{ fit: null }` sin IA.

const es = JSON.parse(readFileSync(new URL("../src/locales/es.json", import.meta.url), "utf8")) as {
  auth: { emailLabel: string; passwordPlaceholder: string; signIn: string };
};

type JobRow = { kind: string; status: string; result: unknown; error: string | null };

test("un trabajo encolado lo ejecuta el trabajador y Ana lee su fila", async ({ page }) => {
  await page.goto("/auth");
  await page.getByLabel(es.auth.emailLabel).fill("ana@peppers.test");
  await page.getByLabel(es.auth.passwordPlaceholder).fill("peppers-local-1");
  await page.getByRole("button", { name: es.auth.signIn, exact: true }).click();
  await page.waitForURL("**/hoy");

  const out = await page.evaluate(
    async ({ supabaseUrl, anonKey }) => {
      const key = Object.keys(localStorage).find(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
      );
      const token = (
        JSON.parse(localStorage.getItem(key ?? "") ?? "{}") as { access_token?: string }
      ).access_token;
      const today = new Date().toISOString().slice(0, 10);
      const fit = async (extra: Record<string, unknown>) => {
        const res = await fetch("/api/v1/plan/fit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ month: today.slice(0, 7), today, ...extra }),
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      };

      // Con `async: true` responde el trabajo, no el resultado.
      const queued = await fit({ async: true });
      const jobId = String(queued.body.jobId ?? "");

      // La pantalla lee la fila con la sesión de la persona (RLS), como `readJob`.
      const read = async (id: string) => {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/jobs?select=kind,status,result,error&id=eq.${id}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
        );
        return ((await res.json()) as JobRow[])[0] ?? null;
      };
      let row: JobRow | null = null;
      for (let i = 0; i < 40; i++) {
        row = await read(jobId);
        if (row && (row.status === "done" || row.status === "failed")) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Sin `async`, lo de siempre: el resultado en la respuesta.
      const inline = await fit({});
      return { queued, row, inline };
    },
    {
      supabaseUrl: process.env.E2E_SUPABASE_URL ?? "",
      anonKey: process.env.E2E_SUPABASE_ANON_KEY ?? "",
    },
  );

  expect(out.queued.status).toBe(200);
  expect(Object.keys(out.queued.body)).toEqual(["jobId"]);
  expect(out.row).toEqual({ kind: "plan_fit", status: "done", result: { fit: null }, error: null });
  expect(out.inline).toEqual({ status: 200, body: { fit: null } });
});
