import { describe, expect, it } from "bun:test";

import {
  deadlineIn,
  hasTimeFor,
  MIN_STEP_MS,
  REQUEST_BUDGET_MS,
  requestDeadline,
  stepTimeout,
} from "./deadline";

describe("deadline — presupuesto de tiempo por petición", () => {
  it("cuenta hacia atrás y no baja de cero", () => {
    const d = deadlineIn(10_000, 1_000);
    expect(d.at).toBe(11_000);
    expect(d.remaining(1_000)).toBe(10_000);
    expect(d.remaining(8_000)).toBe(3_000);
    expect(d.remaining(20_000)).toBe(0);
  });

  it("el de una petición deja 30 s de margen bajo los 300 de Vercel", () => {
    expect(REQUEST_BUDGET_MS).toBe(270_000);
    expect(requestDeadline(0).at).toBe(270_000);
  });

  it("un paso usa su timeout si cabe y lo que queda (menos el margen) si no", () => {
    const d = deadlineIn(100_000, 0);
    expect(stepTimeout(60_000, d, 5_000, 0)).toBe(60_000);
    expect(stepTimeout(60_000, d, 5_000, 50_000)).toBe(45_000);
    expect(stepTimeout(60_000, d, 5_000, 99_000)).toBe(-4_000);
  });

  it("sin presupuesto, el timeout de siempre (también infinito)", () => {
    expect(stepTimeout(60_000, undefined)).toBe(60_000);
    expect(stepTimeout(Infinity, undefined)).toBe(Infinity);
    expect(stepTimeout(Infinity, deadlineIn(30_000, 0), 5_000, 0)).toBe(25_000);
  });

  it("un paso no empieza con menos de 10 s", () => {
    expect(hasTimeFor(MIN_STEP_MS)).toBe(true);
    expect(hasTimeFor(MIN_STEP_MS - 1)).toBe(false);
    expect(hasTimeFor(-4_000)).toBe(false);
    expect(hasTimeFor(Infinity)).toBe(true);
  });
});
