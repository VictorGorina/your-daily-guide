import { describe, expect, it } from "bun:test";

import {
  isQueuedJob,
  JobFailedError,
  jobOutcome,
  type JobRowView,
  settleJob,
  waitForJob,
} from "./job-wait";

const row = (over: Partial<JobRowView> = {}): JobRowView => ({
  id: "j1",
  kind: "plan_generate",
  status: "running",
  result: null,
  error: null,
  ...over,
});

/** Lecturas en orden; la última se repite. Un `Error` simula que no hay red. */
function reads(...steps: (JobRowView | null | Error)[]) {
  let calls = 0;
  const read = async () => {
    const step = steps[Math.min(calls++, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    return step;
  };
  return { read, calls: () => calls };
}

/** Reloj de mentira: cada `sleep` adelanta el tiempo, sin esperar de verdad. */
function clock() {
  let t = 0;
  return { sleep: async (ms: number) => void (t += ms), now: () => t };
}

describe("isQueuedJob", () => {
  it("reconoce un { jobId } y nada más", () => {
    expect(isQueuedJob({ jobId: "j1" })).toBe(true);
    expect([{ firstPlan: true }, { jobId: 3 }, null, undefined, "j1"].map(isQueuedJob)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("jobOutcome", () => {
  it("en cola o en marcha sigue pendiente", () => {
    expect(jobOutcome(row({ status: "queued" }))).toEqual({ state: "pending" });
    expect(jobOutcome(row())).toEqual({ state: "pending" });
  });

  it("hecho trae su resultado", () => {
    expect(jobOutcome(row({ status: "done", result: { firstPlan: true } }))).toEqual({
      state: "done",
      result: { firstPlan: true },
    });
  });

  it("un fallo con texto para la persona lo enseña", () => {
    expect(jobOutcome(row({ status: "failed", error: "Has llegado al tope de hoy." }))).toEqual({
      state: "failed",
      message: "Has llegado al tope de hoy.",
    });
  });

  it("intentos agotados o sin texto: que la pantalla ponga el suyo", () => {
    expect(jobOutcome(row({ status: "failed", error: "attempts_exhausted" }))).toEqual({
      state: "failed",
      message: null,
    });
    expect(jobOutcome(row({ status: "failed" }))).toEqual({ state: "failed", message: null });
  });
});

describe("waitForJob", () => {
  it("sondea hasta que termina y devuelve el resultado", async () => {
    const { read, calls } = reads(
      row({ status: "queued" }),
      row(),
      row({ status: "done", result: { firstPlan: false } }),
    );
    expect(await waitForJob("j1", read, clock())).toEqual({ firstPlan: false });
    expect(calls()).toBe(3);
  });

  it("un trabajo fallido lanza con su texto", async () => {
    const { read } = reads(row(), row({ status: "failed", error: "Sin cuota." }));
    const error = await waitForJob("j1", read, clock()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobFailedError);
    expect((error as Error).message).toBe("Sin cuota.");
  });

  it("aguanta un corte de red y sigue", async () => {
    const { read } = reads(new Error("offline"), null, row({ status: "done", result: 1 }));
    expect(await waitForJob("j1", read, clock())).toBe(1);
  });

  it("si la fila no aparece varias veces seguidas, se rinde sin texto", async () => {
    const { read, calls } = reads(null);
    const error = await waitForJob("j1", read, { ...clock(), maxMisses: 3 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(JobFailedError);
    expect((error as Error).message).toBe("");
    expect(calls()).toBe(3);
  });

  it("no espera para siempre", async () => {
    const { read, calls } = reads(row());
    const wait = waitForJob("j1", read, { ...clock(), intervalMs: 1000, timeoutMs: 3000 });
    await expect(wait).rejects.toBeInstanceOf(JobFailedError);
    expect(calls()).toBe(4);
  });
});

describe("settleJob", () => {
  it("con el resultado en la respuesta no lee nada", async () => {
    const { read, calls } = reads(row());
    expect(await settleJob<unknown, unknown>({ firstPlan: true }, read)).toEqual({
      firstPlan: true,
    });
    expect(calls()).toBe(0);
  });

  it("con un jobId espera al trabajo", async () => {
    const { read } = reads(row({ status: "done", result: { fit: null } }));
    expect(await settleJob<unknown, unknown>({ jobId: "j1" }, read, clock())).toEqual({
      fit: null,
    });
  });
});
