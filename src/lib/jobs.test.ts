import { describe, expect, it } from "bun:test";

import { GENERIC_ERROR_MESSAGE } from "@/lib/public-error";
import { RateLimitError } from "@/lib/rate-limit-error";
import { UserFacingError, ValidationError } from "@/lib/validation-error";

import {
  isJobActive,
  JOB_EXHAUSTED,
  jobErrorText,
  jobsEnabled,
  jobView,
  parseJobInput,
  sameJobTarget,
} from "./jobs";

describe("jobsEnabled", () => {
  it("sin la variable, o con 0/false, la cola está apagada", () => {
    expect(jobsEnabled({})).toBe(false);
    expect(jobsEnabled({ JOBS_ENABLED: "" })).toBe(false);
    expect(jobsEnabled({ JOBS_ENABLED: "0" })).toBe(false);
    expect(jobsEnabled({ JOBS_ENABLED: " False " })).toBe(false);
  });
  it("con cualquier otro valor, encendida", () => {
    expect(jobsEnabled({ JOBS_ENABLED: "1" })).toBe(true);
    expect(jobsEnabled({ JOBS_ENABLED: "true" })).toBe(true);
  });
});

describe("jobErrorText", () => {
  it("un error escrito para la persona conserva su texto", () => {
    expect(jobErrorText(new ValidationError("Octubre ya tiene su plan."))).toBe(
      "Octubre ya tiene su plan.",
    );
    expect(jobErrorText(new UserFacingError("No hemos podido guardar el plan del mes."))).toBe(
      "No hemos podido guardar el plan del mes.",
    );
  });
  it("la cuota agotada también", () => {
    const quota = new RateLimitError(120, "generar el plan");
    expect(jobErrorText(quota)).toBe(quota.message);
  });
  it("cualquier otro error sale con el texto genérico, sin su detalle", () => {
    const pg = Object.assign(new Error("duplicate key value violates unique constraint"), {
      details: "Key (user_id)=(…)",
    });
    expect(jobErrorText(pg)).toBe(GENERIC_ERROR_MESSAGE);
    expect(jobErrorText("texto suelto")).toBe(GENERIC_ERROR_MESSAGE);
    expect(jobErrorText(null)).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("parseJobInput", () => {
  it("plan_generate: mes, hoy y una cadencia válida", () => {
    expect(
      parseJobInput("plan_generate", { month: "2026-11", today: "2026-10-28", cadence: "semanal" }),
    ).toEqual({ month: "2026-11", today: "2026-10-28", cadence: "semanal" });
    expect(
      parseJobInput("plan_generate", { month: "2026-11", today: "2026-10-28", cadence: "x" }),
    ).toBeNull();
  });
  it("plan_reflow: el alcance es meals o full", () => {
    expect(
      parseJobInput("plan_reflow", { month: "2026-10", today: "2026-10-11", scope: "full" }),
    ).toEqual({ month: "2026-10", today: "2026-10-11", scope: "full" });
    expect(parseJobInput("plan_reflow", { month: "2026-10", today: "2026-10-11" })).toBeNull();
  });
  it("plan_fit: solo mes y hoy; lo que sobre no pasa", () => {
    expect(
      parseJobInput("plan_fit", { month: "2026-10", today: "2026-10-11", user_id: "otra" }),
    ).toEqual({ month: "2026-10", today: "2026-10-11" });
  });
  it("sin mes o sin fecha bien formados no vale", () => {
    expect(parseJobInput("plan_fit", { month: "2026-1", today: "2026-10-11" })).toBeNull();
    expect(parseJobInput("plan_fit", { month: "2026-10", today: "hoy" })).toBeNull();
    expect(parseJobInput("plan_fit", null)).toBeNull();
    expect(parseJobInput("plan_fit", "2026-10")).toBeNull();
  });
});

describe("jobView", () => {
  const row = { id: "j1", kind: "plan_generate", status: "queued", result: null, error: null };
  it("en cola o en marcha: sin resultado ni error", () => {
    expect(jobView(row)).toEqual({
      id: "j1",
      kind: "plan_generate",
      status: "queued",
      result: null,
      error: null,
    });
    expect(jobView({ ...row, status: "running", result: { firstPlan: true } })?.result).toBeNull();
  });
  it("terminado: su resultado", () => {
    expect(jobView({ ...row, status: "done", result: { firstPlan: true } })?.result).toEqual({
      firstPlan: true,
    });
  });
  it("fallido: su texto, o el genérico si agotó los intentos o no hay texto", () => {
    expect(jobView({ ...row, status: "failed", error: "Octubre ya tiene su plan." })?.error).toBe(
      "Octubre ya tiene su plan.",
    );
    expect(jobView({ ...row, status: "failed", error: JOB_EXHAUSTED })?.error).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(jobView({ ...row, status: "failed", error: null })?.error).toBe(GENERIC_ERROR_MESSAGE);
  });
  it("un tipo o un estado que no se conoce no se enseña", () => {
    expect(jobView({ ...row, kind: "otro" })).toBeNull();
    expect(jobView({ ...row, status: "raro" })).toBeNull();
  });
});

describe("isJobActive", () => {
  it("en cola y en marcha cuentan como pendientes", () => {
    expect(["queued", "running", "done", "failed"].map(isJobActive)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("sameJobTarget", () => {
  const meals = { month: "2026-10", today: "2026-10-11", scope: "meals" };

  it("la misma petición otro día es la misma", () => {
    expect(sameJobTarget("plan_reflow", meals, { ...meals, today: "2026-10-12" })).toBe(true);
  });

  it("otro alcance, otro mes u otra cadencia no lo son", () => {
    expect(sameJobTarget("plan_reflow", meals, { ...meals, scope: "full" })).toBe(false);
    expect(sameJobTarget("plan_reflow", meals, { ...meals, month: "2026-11" })).toBe(false);
    const nov = { month: "2026-11", today: "2026-10-28", cadence: "semanal" };
    expect(sameJobTarget("plan_generate", nov, { ...nov, cadence: "mensual" })).toBe(false);
  });

  it("una entrada que no se puede leer no vale por ninguna", () => {
    expect(sameJobTarget("plan_fit", null, null)).toBe(false);
    expect(sameJobTarget("plan_fit", { month: "x" }, { month: "x" })).toBe(false);
  });
});
