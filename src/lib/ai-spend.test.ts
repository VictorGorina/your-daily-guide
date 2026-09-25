import { describe, expect, it } from "bun:test";

import {
  ABORTED_CALL_OUTPUT_TOKENS,
  abortedCallCostUsd,
  callCostUsd,
  COACH_MODEL_USD_PER_MTOK,
  decideSpendCap,
  DISH_MODEL_USD_PER_MTOK,
  PLAN_MODEL_USD_PER_MTOK,
  spendCapBlocks,
  utcDayISO,
  utcMonthStartISO,
} from "./ai-spend";

const caps = { dailyUsd: 0.25, monthlyUsd: 3 };

describe("callCostUsd", () => {
  it("usa el coste que factura OpenRouter cuando llega", () => {
    expect(
      callCostUsd({
        usage: { inputTokens: { total: 1_000_000 }, outputTokens: { total: 1_000_000 } },
        providerMetadata: { openrouter: { usage: { cost: 0.00135 } } },
      }),
    ).toBe(0.00135);
  });

  it("se fía de un coste 0 reportado en vez de estimar", () => {
    expect(
      callCostUsd({
        usage: { inputTokens: { total: 5000 }, outputTokens: { total: 500 } },
        providerMetadata: { openrouter: { usage: { cost: 0 } } },
      }),
    ).toBe(0);
  });

  it("estima con los tokens si falta el coste, para no dejar la llamada fuera del tope", () => {
    const estimate = callCostUsd({
      usage: { inputTokens: { total: 2000 }, outputTokens: { total: 400 } },
      providerMetadata: { openrouter: { usage: {} } },
    });
    expect(estimate).toBeCloseTo(
      (2000 * COACH_MODEL_USD_PER_MTOK.input + 400 * COACH_MODEL_USD_PER_MTOK.output) / 1e6,
      12,
    );
  });

  it("ignora un coste que no es un número válido y estima", () => {
    const usage = { inputTokens: { total: 1000 }, outputTokens: { total: 0 } };
    const expected = (1000 * COACH_MODEL_USD_PER_MTOK.input) / 1e6;
    expect(callCostUsd({ usage, providerMetadata: { openrouter: { usage: { cost: -1 } } } })).toBe(
      expected,
    );
    expect(
      callCostUsd({ usage, providerMetadata: { openrouter: { usage: { cost: "0.5" } } } }),
    ).toBe(expected);
  });

  it("sin uso ni coste cuenta 0, nunca NaN", () => {
    expect(callCostUsd({})).toBe(0);
    expect(callCostUsd({ usage: { inputTokens: { total: undefined } } })).toBe(0);
  });

  it("estima al precio de PLAN_MODEL cuando la llamada fue con ese modelo", () => {
    const usage = { inputTokens: { total: 2000 }, outputTokens: { total: 400 } };
    const estimate = callCostUsd(
      { usage, providerMetadata: { openrouter: { usage: {} } } },
      "google/gemini-2.5-pro",
    );
    expect(estimate).toBeCloseTo(
      (2000 * PLAN_MODEL_USD_PER_MTOK.input + 400 * PLAN_MODEL_USD_PER_MTOK.output) / 1e6,
      12,
    );
  });

  it("un modelId desconocido cae al precio más caro conocido, no al de coach", () => {
    const usage = { inputTokens: { total: 1_000_000 }, outputTokens: { total: 0 } };
    const knownExpensive = callCostUsd(
      { usage, providerMetadata: { openrouter: { usage: {} } } },
      "google/gemini-2.5-pro",
    );
    const unknown = callCostUsd(
      { usage, providerMetadata: { openrouter: { usage: {} } } },
      "algun-modelo-nuevo-sin-precio",
    );
    expect(unknown).toBe(knownExpensive);
  });
});

describe("abortedCallCostUsd", () => {
  it("cuenta la salida supuesta al precio del modelo de la llamada", () => {
    expect(abortedCallCostUsd("openai/gpt-5")).toBeCloseTo(
      (ABORTED_CALL_OUTPUT_TOKENS * DISH_MODEL_USD_PER_MTOK.output) / 1e6,
      12,
    );
  });

  it("no se queda por debajo de lo que cuesta de verdad un lote de platos", () => {
    // La llamada más cara medida el 2026-09-24: 4 platos, 0,043 $.
    expect(abortedCallCostUsd("openai/gpt-5")).toBeGreaterThan(0.043);
  });

  it("un modelo sin precio conocido tampoco sale gratis", () => {
    expect(abortedCallCostUsd("algun-modelo-nuevo-sin-precio")).toBeGreaterThan(0);
  });
});

describe("utcDayISO / utcMonthStartISO", () => {
  it("corta el día en UTC, no en la hora local del servidor", () => {
    // 00:30 en Madrid (verano) sigue siendo el día anterior en UTC.
    const now = new Date("2026-09-15T22:30:00Z");
    expect(utcDayISO(now)).toBe("2026-09-15");
    expect(utcMonthStartISO(now)).toBe("2026-09-01");
  });
});

describe("decideSpendCap", () => {
  const now = new Date("2026-09-15T18:00:00Z");

  it("deja pasar por debajo de los dos topes y suma lo gastado", () => {
    const decision = decideSpendCap(
      [
        { day: "2026-09-15", cost_usd: 0.1 },
        { day: "2026-09-02", cost_usd: 1.2 },
      ],
      caps,
      now,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.daySpentUsd).toBeCloseTo(0.1);
    expect(decision.monthSpentUsd).toBeCloseTo(1.3);
  });

  it("deja pasar la llamada que cruza el tope: se mira lo ya gastado, no lo que costará", () => {
    expect(decideSpendCap([{ day: "2026-09-15", cost_usd: 0.2499 }], caps, now).allowed).toBe(true);
  });

  it("corta al llegar justo al tope diario y espera hasta la medianoche UTC", () => {
    const decision = decideSpendCap([{ day: "2026-09-15", cost_usd: 0.25 }], caps, now);
    expect(decision).toMatchObject({ allowed: false, scope: "day", retryAfterSeconds: 6 * 3600 });
  });

  it("lo gastado otros días del mes no cuenta para el tope diario", () => {
    const decision = decideSpendCap(
      [
        { day: "2026-09-14", cost_usd: 0.9 },
        { day: "2026-09-15", cost_usd: 0.05 },
      ],
      caps,
      now,
    );
    expect(decision.allowed).toBe(true);
  });

  it("corta al llegar al tope mensual y espera hasta el día 1 del mes que viene", () => {
    const decision = decideSpendCap(
      [
        { day: "2026-09-01", cost_usd: 1.5 },
        { day: "2026-09-10", cost_usd: 1.5 },
      ],
      caps,
      now,
    );
    // Del 15-09 18:00 al 01-10 00:00 UTC: 15 días y 6 horas.
    expect(decision).toMatchObject({
      allowed: false,
      scope: "month",
      retryAfterSeconds: 15 * 86400 + 6 * 3600,
    });
  });

  it("con los dos topes pasados manda el mensual: esperar a mañana no serviría", () => {
    const decision = decideSpendCap(
      [
        { day: "2026-09-01", cost_usd: 2.9 },
        { day: "2026-09-15", cost_usd: 0.3 },
      ],
      caps,
      now,
    );
    expect(decision).toMatchObject({ allowed: false, scope: "month" });
  });

  it("en diciembre el mes siguiente es enero del año que viene", () => {
    const decision = decideSpendCap(
      [{ day: "2026-12-31", cost_usd: 3 }],
      caps,
      new Date("2026-12-31T23:00:00Z"),
    );
    expect(decision).toMatchObject({ allowed: false, scope: "month", retryAfterSeconds: 3600 });
  });

  it("ignora filas de otro mes y costes no válidos", () => {
    const decision = decideSpendCap(
      [
        { day: "2026-08-31", cost_usd: 10 },
        { day: "2026-09-15", cost_usd: "abc" },
        { day: "2026-09-15", cost_usd: -4 },
      ],
      caps,
      now,
    );
    expect(decision).toMatchObject({ allowed: true, daySpentUsd: 0, monthSpentUsd: 0 });
  });

  it("acepta el numeric de Postgres como texto", () => {
    const decision = decideSpendCap([{ day: "2026-09-15", cost_usd: "0.30000000" }], caps, now);
    expect(decision).toMatchObject({ allowed: false, scope: "day" });
  });

  it("un tope Infinity no corta nunca", () => {
    const decision = decideSpendCap(
      [{ day: "2026-09-15", cost_usd: 99 }],
      { dailyUsd: Infinity, monthlyUsd: Infinity },
      now,
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("spendCapBlocks — la descomposición de platos no la corta el tope diario (D13)", () => {
  const now = new Date("2026-09-15T18:00:00Z");
  const overDay = decideSpendCap([{ day: "2026-09-15", cost_usd: 0.3 }], caps, now);
  const overMonth = decideSpendCap([{ day: "2026-09-02", cost_usd: 3 }], caps, now);
  const ok = decideSpendCap([], caps, now);

  it("con el alcance normal, cortan los dos topes", () => {
    expect(spendCapBlocks(overDay, "day")).toBe(true);
    expect(spendCapBlocks(overMonth, "day")).toBe(true);
    expect(spendCapBlocks(ok, "day")).toBe(false);
  });

  it("con `month`, el tope diario deja pasar y el mensual sigue cortando", () => {
    expect(spendCapBlocks(overDay, "month")).toBe(false);
    expect(spendCapBlocks(overMonth, "month")).toBe(true);
    expect(spendCapBlocks(ok, "month")).toBe(false);
  });
});
