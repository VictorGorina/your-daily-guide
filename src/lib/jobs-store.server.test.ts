import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import {
  createFakeSupabase as createFake,
  type FakeOp,
  type FakeOptions,
  type FakeTables,
} from "@/test/fake-supabase";

import { enqueueJob, jobStore } from "./jobs-store.server";

/** El doble, puesto como `supabaseAdmin`: es el único cliente del almacén. */
function createFakeSupabase(tables?: FakeTables, opts?: FakeOptions) {
  const fake = createFake(tables, opts);
  setFakeAdmin(fake.client);
  return fake;
}

const NOV = { month: "2026-11", today: "2026-10-28", cadence: "semanal" } as const;

const row = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  user_id: "ana",
  kind: "plan_generate",
  input: NOV,
  status: "running",
  attempts: 1,
  result: null,
  error: null,
  locked_at: "2026-10-28T10:00:00Z",
  created_at: "2026-10-28T10:00:00Z",
  updated_at: "2026-10-28T10:00:00Z",
  ...over,
});

/** El índice único `jobs_one_active_idx`, que el doble no tiene. */
const uniqueActive = (tables: FakeTables) => (op: FakeOp) => {
  if (op.table !== "jobs" || op.op !== "insert") return null;
  const incoming = op.payload as { user_id: string; kind: string };
  const clash = (tables.jobs ?? []).some(
    (j) =>
      j.user_id === incoming.user_id &&
      j.kind === incoming.kind &&
      (j.status === "queued" || j.status === "running"),
  );
  return clash ? { code: "23505", message: "duplicate key value" } : null;
};

describe("jobStore.claim", () => {
  it("devuelve la fila que reclama claim_job()", async () => {
    const fake = createFakeSupabase({}, { rpc: { claim_job: () => [row()] } });
    expect(await jobStore.claim()).toMatchObject({ id: "j1", user_id: "ana", attempts: 1 });
    expect(fake.calls.map((c) => `${c.op}:${c.table}`)).toEqual(["rpc:claim_job"]);
  });

  it("sin nada que reclamar, null", async () => {
    createFakeSupabase({}, { rpc: { claim_job: () => [] } });
    expect(await jobStore.claim()).toBeNull();
  });

  it("si la base de datos falla, lanza (el trabajador responde 500 y el cron reintenta)", async () => {
    createFakeSupabase({}, { failOn: (op) => op.op === "rpc" });
    await expect(jobStore.claim()).rejects.toThrow("claim_job");
  });
});

describe("jobStore.finish", () => {
  it("cierra el trabajo con su resultado y suelta el cerrojo", async () => {
    const tables: FakeTables = { jobs: [row()] };
    createFakeSupabase(tables);
    await jobStore.finish(
      { id: "j1", attempts: 1 },
      { status: "done", result: { firstPlan: true } },
    );
    expect(tables.jobs![0]).toMatchObject({
      status: "done",
      result: { firstPlan: true },
      error: null,
      locked_at: null,
    });
  });

  it("un fallo guarda el texto y ningún resultado", async () => {
    const tables: FakeTables = { jobs: [row()] };
    createFakeSupabase(tables);
    await jobStore.finish({ id: "j1", attempts: 1 }, { status: "failed", error: "Sin cuota." });
    expect(tables.jobs![0]).toMatchObject({ status: "failed", error: "Sin cuota.", result: null });
  });

  it("un intento dado por muerto que acaba tarde no pisa al que lo relevó", async () => {
    const tables: FakeTables = { jobs: [row({ attempts: 2 })] };
    createFakeSupabase(tables);
    await jobStore.finish({ id: "j1", attempts: 1 }, { status: "failed", error: "Tarde." });
    expect(tables.jobs![0]).toMatchObject({ status: "running", attempts: 2, error: null });
  });

  it("no reabre un trabajo que ya agotó sus intentos", async () => {
    const tables: FakeTables = {
      jobs: [row({ status: "failed", error: "attempts_exhausted", attempts: 3 })],
    };
    createFakeSupabase(tables);
    await jobStore.finish({ id: "j1", attempts: 3 }, { status: "done", result: {} });
    expect(tables.jobs![0]).toMatchObject({ status: "failed", error: "attempts_exhausted" });
  });

  it("solo toca su fila", async () => {
    const tables: FakeTables = { jobs: [row(), row({ id: "j2", user_id: "bea" })] };
    createFakeSupabase(tables);
    await jobStore.finish({ id: "j1", attempts: 1 }, { status: "done", result: {} });
    expect(tables.jobs![1]).toMatchObject({ id: "j2", status: "running" });
  });
});

describe("enqueueJob", () => {
  it("deja el trabajo en la cola con el user_id que recibe", async () => {
    const tables: FakeTables = { jobs: [] };
    createFakeSupabase(tables, { failOn: uniqueActive(tables) });
    const out = await enqueueJob("ana", "plan_generate", NOV);
    expect(out).toMatchObject({ created: true, sameTarget: true });
    expect(tables.jobs).toEqual([{ user_id: "ana", kind: "plan_generate", input: NOV }]);
  });

  it("con uno activo del mismo tipo devuelve ese, sin insertar otro", async () => {
    const tables: FakeTables = { jobs: [row({ status: "queued" })] };
    createFakeSupabase(tables, { failOn: uniqueActive(tables) });
    expect(await enqueueJob("ana", "plan_generate", { ...NOV, today: "2026-10-29" })).toEqual({
      id: "j1",
      created: false,
      sameTarget: true,
    });
    expect(tables.jobs).toHaveLength(1);
  });

  it("avisa si el activo pide otra cosa (rehacer no es recalcular la despensa)", async () => {
    const meals = { month: "2026-10", today: "2026-10-11", scope: "meals" } as const;
    const tables: FakeTables = { jobs: [row({ kind: "plan_reflow", input: meals })] };
    createFakeSupabase(tables, { failOn: uniqueActive(tables) });
    expect(await enqueueJob("ana", "plan_reflow", { ...meals, scope: "full" })).toEqual({
      id: "j1",
      created: false,
      sameTarget: false,
    });
  });

  it("el activo que busca es el de ESA persona y ESE tipo", async () => {
    const tables: FakeTables = {
      jobs: [
        row({ id: "de-bea", user_id: "bea" }),
        row({ id: "otro-tipo", kind: "plan_fit", input: { month: "2026-11", today: NOV.today } }),
        row({ id: "terminado", status: "done" }),
      ],
    };
    // Ninguno de esos tres estorba a Ana: el suyo entra.
    const fake = createFakeSupabase(tables, { failOn: uniqueActive(tables) });
    expect((await enqueueJob("ana", "plan_generate", NOV)).created).toBe(true);

    // Y cuando sí choca, la lectura del activo va filtrada por persona y tipo.
    tables.jobs!.at(-1)!.id = "de-ana";
    tables.jobs!.at(-1)!.status = "queued";
    expect((await enqueueJob("ana", "plan_generate", NOV)).id).toBe("de-ana");
    const read = fake.calls.filter((c) => c.op === "select" && c.columns.includes("input")).at(-1)!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "user_id", value: "ana" },
        { kind: "eq", column: "kind", value: "plan_generate" },
        { kind: "in", column: "status", value: ["queued", "running"] },
      ]),
    );
  });

  it("si el activo termina entre el choque y la lectura, el segundo intento entra", async () => {
    const tables: FakeTables = { jobs: [row()] };
    let first = true;
    createFakeSupabase(tables, {
      failOn: (op) => {
        const clash = uniqueActive(tables)(op);
        if (clash && first) {
          first = false;
          tables.jobs![0]!.status = "done";
        }
        return clash;
      },
    });
    expect((await enqueueJob("ana", "plan_generate", NOV)).created).toBe(true);
  });

  it("un fallo de la base de datos lanza: quien llama trabaja en línea", async () => {
    createFakeSupabase({ jobs: [] }, { failOn: (op) => op.op === "insert" });
    await expect(enqueueJob("ana", "plan_generate", NOV)).rejects.toThrow("jobs.insert");
  });
});
