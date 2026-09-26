import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { useFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOptions, type FakeTables } from "@/test/fake-supabase";

import { RateLimitError } from "./rate-limit-error";
import {
  checkEmailRateLimit,
  enforceAiSpendCap,
  enforceUserRateLimit,
  recordAiSpend,
} from "./rate-limit.server";

// Topes de hoy (`AI_SPEND_CAPS`): 0,75 $/día y 5 $/mes, en UTC.
const NOW = new Date("2026-09-26T12:00:00Z");

let logs: string[];
let consoleError: ReturnType<typeof spyOn>;
let consoleWarn: ReturnType<typeof spyOn>;
beforeEach(() => {
  setSystemTime(NOW);
  logs = [];
  const capture = (line: unknown) => void logs.push(String(line));
  consoleError = spyOn(console, "error").mockImplementation(capture);
  consoleWarn = spyOn(console, "warn").mockImplementation(capture);
});
afterEach(() => {
  setSystemTime();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

const events = () =>
  logs.flatMap((line) => {
    try {
      return [(JSON.parse(line) as { event: string }).event];
    } catch {
      return [];
    }
  });

/** Doble con `ai_spend` y una cuota que deja pasar (o lo que diga `quota`). */
function fakeWith(
  spend: FakeTables["ai_spend"] = [],
  opts: FakeOptions & { quota?: { allowed: boolean; retry_after_seconds: number } } = {},
) {
  const fake = createFakeSupabase(
    { ai_spend: spend },
    {
      failOn: opts.failOn,
      rpc: {
        consume_rate_limit: () => [opts.quota ?? { allowed: true, retry_after_seconds: 0 }],
        record_ai_spend: () => null,
        ...opts.rpc,
      },
    },
  );
  useFakeAdmin(fake.client);
  return fake;
}

const spent = (user_id: string, day: string, cost_usd: number | string) => ({
  user_id,
  day,
  cost_usd,
});

describe("enforceAiSpendCap", () => {
  it("por debajo de los topes deja pasar", async () => {
    fakeWith([spent("u1", "2026-09-26", 0.2), spent("u1", "2026-09-10", 1)]);
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
  });

  it("lee solo el gasto de esa persona y desde el día 1 del mes UTC", async () => {
    const fake = fakeWith();
    await enforceAiSpendCap("u1");
    expect(fake.calls[0]).toMatchObject({
      table: "ai_spend",
      op: "select",
      filters: [
        { kind: "eq", column: "user_id", value: "u1" },
        { kind: "gte", column: "day", value: "2026-09-01" },
      ],
    });
  });

  it("el tope diario corta con RateLimitError de alcance 'day'", async () => {
    fakeWith([spent("u1", "2026-09-26", "0.80")]); // `numeric` llega como texto
    const error = await enforceAiSpendCap("u1", "usar el coach").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).scope).toBe("day");
    expect(events()).toContain("spend_cap_reached");
  });

  it("el gasto de otra persona no cuenta", async () => {
    fakeWith([spent("u2", "2026-09-26", 3)]);
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
  });

  it("con capScope 'month', el tope diario no corta (descomposición de platos, D13)…", async () => {
    fakeWith([spent("u1", "2026-09-26", 0.8)]);
    await expect(enforceAiSpendCap("u1", "calcular un plato", "month")).resolves.toBeUndefined();
  });

  it("…pero el mensual sí", async () => {
    fakeWith([spent("u1", "2026-09-26", 0.1), spent("u1", "2026-09-05", 5)]);
    const error = await enforceAiSpendCap("u1", "calcular un plato", "month").catch(
      (e: unknown) => e,
    );
    expect((error as RateLimitError).scope).toBe("month");
  });

  it("si la lectura falla, deja pasar y lo registra como spend_cap_failopen", async () => {
    fakeWith([spent("u1", "2026-09-26", 9)], { failOn: (op) => op.table === "ai_spend" });
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
    expect(events()).toEqual(["spend_cap_failopen"]);
  });
});

describe("enforceUserRateLimit", () => {
  it("cuenta por `user:<id>` en el bucket pedido", async () => {
    const fake = fakeWith();
    await enforceUserRateLimit("u1", "chat");
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.payload).toEqual({
      _subject: "user:u1",
      _bucket: "chat",
      _limit: 60,
      _window_seconds: 3600,
    });
  });

  it("cuota agotada → RateLimitError con la espera de la BD", async () => {
    fakeWith([], { quota: { allowed: false, retry_after_seconds: 600 } });
    const error = await enforceUserRateLimit("u1", "chat").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBe(600);
  });

  it("con el tope de gasto pasado, manda el de gasto aunque la cuota horaria deje", async () => {
    fakeWith([spent("u1", "2026-09-26", 1)]);
    const error = await enforceUserRateLimit("u1", "chat").catch((e: unknown) => e);
    expect((error as RateLimitError).scope).toBe("day");
  });

  it("si la cuota falla en la BD, deja pasar y lo registra como rate_limit_failopen", async () => {
    fakeWith([], { failOn: (op) => op.op === "rpc" });
    await expect(enforceUserRateLimit("u1", "chat")).resolves.toBeUndefined();
    expect(events()).toContain("rate_limit_failopen");
  });
});

describe("recordAiSpend", () => {
  it("suma el coste con record_ai_spend", async () => {
    const fake = fakeWith();
    await recordAiSpend("u1", 0.0014);
    expect(fake.calls).toEqual([
      expect.objectContaining({
        table: "record_ai_spend",
        op: "rpc",
        payload: { _user_id: "u1", _cost_usd: 0.0014 },
      }),
    ]);
  });

  it("un coste nulo o no positivo no escribe nada", async () => {
    const fake = fakeWith();
    await recordAiSpend("u1", 0);
    await recordAiSpend("u1", Number.NaN);
    expect(fake.calls).toEqual([]);
  });

  it("si la escritura falla, no lanza y deja spend_record_failed", async () => {
    fakeWith([], { failOn: (op) => op.table === "record_ai_spend" });
    await expect(recordAiSpend("u1", 0.01)).resolves.toBeUndefined();
    expect(events()).toEqual(["spend_record_failed"]);
  });
});

describe("checkEmailRateLimit", () => {
  it("cuenta por el hash del correo normalizado: la dirección nunca llega a la BD", async () => {
    const fake = fakeWith();
    await checkEmailRateLimit("  Ana@Example.com ", "password-reset");
    await checkEmailRateLimit("ana@example.com", "password-reset");
    const subjects = fake.calls.map((c) => (c.payload as { _subject: string })._subject);
    expect(subjects[0]).toMatch(/^email:[0-9a-f]{64}$/);
    expect(subjects[1]).toBe(subjects[0]);
    expect(JSON.stringify(fake.calls)).not.toContain("example.com");
  });

  it("devuelve si pasa en vez de lanzar", async () => {
    fakeWith([], { quota: { allowed: false, retry_after_seconds: 60 } });
    expect(await checkEmailRateLimit("ana@example.com", "password-reset")).toBe(false);
  });
});
