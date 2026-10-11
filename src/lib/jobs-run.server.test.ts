import { describe, expect, it } from "bun:test";

import type { JobRow } from "@/lib/jobs";
import { GENERIC_ERROR_MESSAGE } from "@/lib/public-error";
import { ValidationError } from "@/lib/validation-error";

import { type JobRunners, type JobStore, runNextJob } from "./jobs-run.server";

type Finished = { id: string; attempts: number; outcome: unknown };

function fakeStore(queue: JobRow[]) {
  const finished: Finished[] = [];
  const store: JobStore = {
    claim: async () => queue.shift() ?? null,
    finish: async (job, outcome) => {
      finished.push({ id: job.id, attempts: job.attempts, outcome });
    },
  };
  return { store, finished };
}

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  user_id: "ana",
  kind: "plan_generate",
  input: { month: "2026-11", today: "2026-10-28", cadence: "semanal" },
  status: "running",
  attempts: 1,
  ...over,
});

/** Runners que apuntan quién los llamó y con qué. */
function runners(over: Partial<JobRunners> = {}) {
  const calls: { kind: string; userId: string; input: unknown }[] = [];
  const all: JobRunners = {
    plan_generate: async (userId, input) => {
      calls.push({ kind: "plan_generate", userId, input });
      return { firstPlan: true };
    },
    plan_reflow: async (userId, input) => {
      calls.push({ kind: "plan_reflow", userId, input });
      return { scope: input.scope, summary: "Listo" };
    },
    plan_fit: async (userId, input) => {
      calls.push({ kind: "plan_fit", userId, input });
      return { fit: null };
    },
    ...over,
  };
  return { all, calls };
}

describe("runNextJob", () => {
  it("sin nada en la cola no hace nada", async () => {
    const { store, finished } = fakeStore([]);
    const { all, calls } = runners();
    expect(await runNextJob(store, all)).toEqual({ ran: false });
    expect(calls).toEqual([]);
    expect(finished).toEqual([]);
  });

  it("ejecuta el trabajo con el user_id de SU fila y guarda el resultado", async () => {
    const { store, finished } = fakeStore([job()]);
    const { all, calls } = runners();
    expect(await runNextJob(store, all)).toEqual({
      ran: true,
      id: "j1",
      kind: "plan_generate",
      status: "done",
    });
    expect(calls).toEqual([
      {
        kind: "plan_generate",
        userId: "ana",
        input: { month: "2026-11", today: "2026-10-28", cadence: "semanal" },
      },
    ]);
    expect(finished).toEqual([
      { id: "j1", attempts: 1, outcome: { status: "done", result: { firstPlan: true } } },
    ]);
  });

  it("un trabajo por llamada: el segundo se queda en la cola", async () => {
    const queue = [job(), job({ id: "j2", user_id: "bea" })];
    const { store } = fakeStore(queue);
    const { all, calls } = runners();
    await runNextJob(store, all);
    expect(calls).toHaveLength(1);
    expect(queue.map((j) => j.id)).toEqual(["j2"]);
  });

  it("cierra con el intento que reclamó, para no pisar a quien lo releve", async () => {
    const { store, finished } = fakeStore([job({ attempts: 2 })]);
    await runNextJob(store, runners().all);
    expect(finished[0]!.attempts).toBe(2);
  });

  it("un error escrito para la persona queda como fallido con su texto", async () => {
    const { store, finished } = fakeStore([job()]);
    const { all } = runners({
      plan_generate: async () => {
        throw new ValidationError("Noviembre ya tiene su plan.");
      },
    });
    expect((await runNextJob(store, all)).ran && "failed").toBe("failed");
    expect(finished[0]!.outcome).toEqual({
      status: "failed",
      error: "Noviembre ya tiene su plan.",
    });
  });

  it("un error interno queda como fallido con el texto genérico", async () => {
    const { store, finished } = fakeStore([job()]);
    const { all } = runners({
      plan_generate: async () => {
        throw new Error("PGRST301: JWT expired");
      },
    });
    await runNextJob(store, all);
    expect(finished[0]!.outcome).toEqual({ status: "failed", error: GENERIC_ERROR_MESSAGE });
  });

  it("una entrada que no encaja no llega al runner", async () => {
    const { store, finished } = fakeStore([job({ input: { month: "noviembre" } })]);
    const { all, calls } = runners();
    await runNextJob(store, all);
    expect(calls).toEqual([]);
    expect(finished[0]!.outcome).toEqual({ status: "failed", error: GENERIC_ERROR_MESSAGE });
  });

  it("un tipo desconocido falla sin ejecutar nada", async () => {
    const { store, finished } = fakeStore([job({ kind: "borrar_todo" })]);
    const { all, calls } = runners();
    await runNextJob(store, all);
    expect(calls).toEqual([]);
    expect(finished[0]!.outcome).toEqual({ status: "failed", error: GENERIC_ERROR_MESSAGE });
  });
});
