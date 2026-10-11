import { describe, expect, it } from "bun:test";

import { ValidationError } from "@/lib/validation-error";

import { enqueueOrRun } from "./enqueue.server";

const INPUT = { month: "2026-11", today: "2026-10-28", cadence: "semanal" } as const;

function setup(over: { enabled?: boolean; enqueue?: () => Promise<unknown> } = {}) {
  const log: string[] = [];
  const deps = {
    enabled: () => over.enabled ?? true,
    enqueue: async (userId: string, kind: string) => {
      log.push(`enqueue:${userId}:${kind}`);
      return ((await over.enqueue?.()) ?? { id: "j1", created: true, sameTarget: true }) as {
        id: string;
        created: boolean;
        sameTarget: boolean;
      };
    },
    kick: () => void log.push("kick"),
  };
  const call = (queued: boolean, precheck?: () => Promise<void>) =>
    enqueueOrRun(
      {
        queued,
        userId: "ana",
        kind: "plan_generate",
        input: INPUT,
        precheck,
        run: async () => {
          log.push("run");
          return { firstPlan: true };
        },
      },
      deps,
    );
  return { log, call };
}

describe("enqueueOrRun", () => {
  it("sin async: true hace el trabajo en la petición, como una build antigua espera", async () => {
    const { log, call } = setup();
    expect(await call(false)).toEqual({ firstPlan: true });
    expect(log).toEqual(["run"]);
  });

  it("sin JOBS_ENABLED tampoco encola, aunque se pida", async () => {
    const { log, call } = setup({ enabled: false });
    expect(await call(true)).toEqual({ firstPlan: true });
    expect(log).toEqual(["run"]);
  });

  it("encola con el userId de la sesión, arranca el trabajador y responde el jobId", async () => {
    const { log, call } = setup();
    expect(await call(true)).toEqual({ jobId: "j1" });
    expect(log).toEqual(["enqueue:ana:plan_generate", "kick"]);
  });

  it("con uno igual ya activo devuelve ese y no arranca otro trabajador", async () => {
    const { log, call } = setup({
      enqueue: async () => ({ id: "j0", created: false, sameTarget: true }),
    });
    expect(await call(true)).toEqual({ jobId: "j0" });
    expect(log).toEqual(["enqueue:ana:plan_generate"]);
  });

  it("si el activo pide otra cosa, hace el trabajo en línea", async () => {
    const { log, call } = setup({
      enqueue: async () => ({ id: "j0", created: false, sameTarget: false }),
    });
    expect(await call(true)).toEqual({ firstPlan: true });
    expect(log).toEqual(["enqueue:ana:plan_generate", "run"]);
  });

  it("si encolar falla, hace el trabajo en línea", async () => {
    const { log, call } = setup({
      enqueue: async () => {
        throw new Error("jobs.insert: timeout");
      },
    });
    expect(await call(true)).toEqual({ firstPlan: true });
    expect(log).toEqual(["enqueue:ana:plan_generate", "run"]);
  });

  it("lo que rechaza precheck no llega a la cola", async () => {
    const { log, call } = setup();
    const planned = async () => {
      throw new ValidationError("Noviembre ya tiene su plan.");
    };
    await expect(call(true, planned)).rejects.toThrow("ya tiene su plan");
    expect(log).toEqual([]);
  });

  it("precheck no corre si el trabajo va en línea (run hace las suyas)", async () => {
    const { log, call } = setup({ enabled: false });
    await call(true, async () => void log.push("precheck"));
    expect(log).toEqual(["run"]);
  });
});
