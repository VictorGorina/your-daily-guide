import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOptions, type FakeTables } from "@/test/fake-supabase";

import { RateLimitError } from "./rate-limit-error";
import {
  checkEmailRateLimit,
  enforceAiSpendCap,
  enforceUserRateLimit,
  recordAiSpend,
  resetAnonymousCache,
  resetGlobalSpendCache,
} from "./rate-limit.server";

// Topes de hoy (`AI_SPEND_CAPS`): 0,75 $/día y 5 $/mes, en UTC.
const NOW = new Date("2026-09-26T12:00:00Z");

let logs: string[];
let consoleError: ReturnType<typeof spyOn>;
let consoleWarn: ReturnType<typeof spyOn>;
beforeEach(() => {
  setSystemTime(NOW);
  resetAnonymousCache();
  logs = [];
  const capture = (line: unknown) => void logs.push(String(line));
  consoleError = spyOn(console, "error").mockImplementation(capture);
  consoleWarn = spyOn(console, "warn").mockImplementation(capture);
});
afterEach(() => {
  setSystemTime();
  // Que una cuenta anónima de aquí no lo siga siendo en otro archivo de tests.
  resetAnonymousCache();
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
      anonymousUsers: opts.anonymousUsers,
      rpc: {
        consume_rate_limit: () => [opts.quota ?? { allowed: true, retry_after_seconds: 0 }],
        record_ai_spend: () => null,
        ...opts.rpc,
      },
    },
  );
  setFakeAdmin(fake.client);
  return fake;
}

const spent = (
  user_id: string,
  day: string,
  cost_usd: number | string,
  month_only_usd: number | string = 0,
) => ({
  user_id,
  day,
  cost_usd,
  month_only_usd,
});

describe("enforceAiSpendCap", () => {
  it("por debajo de los topes deja pasar", async () => {
    fakeWith([spent("u1", "2026-09-26", 0.2), spent("u1", "2026-09-10", 1)]);
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
  });

  it("lee solo el gasto de esa persona y desde el día 1 del mes UTC", async () => {
    const fake = fakeWith();
    await enforceAiSpendCap("u1");
    expect(fake.calls.find((c) => c.table === "ai_spend")).toMatchObject({
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

describe("topes de una cuenta anónima (ticket 29): 0,30 $/día y 2 $/mes", () => {
  const anon = { anonymousUsers: ["demo"] };

  it("lo que a una cuenta le cabe en el día, a una anónima no", async () => {
    fakeWith([spent("u1", "2026-09-26", 0.35), spent("demo", "2026-09-26", 0.35)], anon);
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
    const error = await enforceAiSpendCap("demo").catch((e: unknown) => e);
    expect((error as RateLimitError).scope).toBe("day");
    expect(logs.some((l) => l.includes('"anonymous":true'))).toBe(true);
  });

  it("generar su plan (solo mensual) le cabe aunque pase del diario", async () => {
    fakeWith([spent("demo", "2026-09-26", 1.5, 1.4)], anon);
    await expect(enforceAiSpendCap("demo", "generar el plan", "month")).resolves.toBeUndefined();
    await expect(enforceUserRateLimit("demo", "chat")).resolves.toBeUndefined();
  });

  it("el mensual corta a los 2 $, también lo que solo mide el mes", async () => {
    fakeWith([spent("demo", "2026-09-26", 0.1), spent("demo", "2026-09-05", 1.95)], anon);
    const error = await enforceAiSpendCap("demo", "calcular un plato", "month").catch(
      (e: unknown) => e,
    );
    expect((error as RateLimitError).scope).toBe("month");
  });

  it("pregunta a Auth una vez y lo recuerda en la instancia", async () => {
    const fake = fakeWith([], anon);
    await enforceAiSpendCap("demo");
    await enforceUserRateLimit("demo", "chat");
    expect(fake.calls.filter((c) => c.op === "auth.getUserById")).toHaveLength(1);
  });

  it("si Auth falla, topes normales y anon_lookup_failed (sin guardarlo)", async () => {
    const fake = fakeWith([spent("demo", "2026-09-26", 0.35)], {
      ...anon,
      failOn: (op) => op.op === "auth.getUserById",
    });
    await expect(enforceAiSpendCap("demo")).resolves.toBeUndefined();
    await expect(enforceAiSpendCap("demo")).resolves.toBeUndefined();
    expect(events()).toEqual(["anon_lookup_failed", "anon_lookup_failed"]);
    expect(fake.calls.filter((c) => c.op === "auth.getUserById")).toHaveLength(2);
  });
});

describe("disyuntor global de gasto (ticket 14)", () => {
  const savedThreshold = process.env.AI_GLOBAL_DAILY_USD;
  beforeEach(() => {
    resetGlobalSpendCache();
    process.env.AI_GLOBAL_DAILY_USD = "10";
  });
  afterEach(() => {
    if (savedThreshold === undefined) delete process.env.AI_GLOBAL_DAILY_USD;
    else process.env.AI_GLOBAL_DAILY_USD = savedThreshold;
  });

  /** Doble cuyo `ai_spend_total_today` devuelve `total` (como texto, igual que `numeric`). */
  const withTotal = (total: number | string, opts: FakeOptions = {}) =>
    fakeWith([], { ...opts, rpc: { ai_spend_total_today: () => String(total), ...opts.rpc } });
  const totalCalls = (fake: ReturnType<typeof fakeWith>) =>
    fake.calls.filter((c) => c.table === "ai_spend_total_today").length;

  it("sin la variable está apagado: ni siquiera consulta el total", async () => {
    delete process.env.AI_GLOBAL_DAILY_USD;
    const fake = withTotal(1_000);
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
    expect(totalCalls(fake)).toBe(0);
  });

  it("con el gasto de todos por debajo del umbral deja pasar", async () => {
    withTotal(9.5);
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
  });

  it("al llegar al umbral corta a cualquiera con alcance 'global' y lo registra", async () => {
    withTotal(10);
    const error = await enforceAiSpendCap("u1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).scope).toBe("global");
    // Hasta la medianoche UTC (NOW = 12:00).
    expect((error as RateLimitError).retryAfterSeconds).toBe(12 * 3600);
    expect(events()).toContain("spend_global_tripped");
  });

  it("corta también la descomposición de platos (capScope 'month'): es un interruptor", async () => {
    withTotal(10);
    const error = await enforceAiSpendCap("u1", "calcular", "month").catch((e: unknown) => e);
    expect((error as RateLimitError).scope).toBe("global");
  });

  it("enforceUserRateLimit corta en la entrada, antes de hacer trabajo", async () => {
    withTotal(10);
    const error = await enforceUserRateLimit("u1", "chat").catch((e: unknown) => e);
    expect((error as RateLimitError).scope).toBe("global");
  });

  it("si la consulta falla, deja pasar y lo registra como spend_global_failopen", async () => {
    withTotal(10, { failOn: (op) => op.table === "ai_spend_total_today" });
    await expect(enforceAiSpendCap("u1")).resolves.toBeUndefined();
    expect(events()).toContain("spend_global_failopen");
  });

  it("consulta el total como mucho una vez por minuto en cada instancia", async () => {
    const fake = withTotal(1);
    await enforceAiSpendCap("u1");
    await enforceAiSpendCap("u2");
    expect(totalCalls(fake)).toBe(1);
    setSystemTime(new Date(NOW.getTime() + 61_000));
    await enforceAiSpendCap("u1");
    expect(totalCalls(fake)).toBe(2);
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

  it("el día de generar el plan, lo que solo mide el mensual no deja sin coach", async () => {
    // 1,34 USD el mismo día, 1,20 de ellos de generar el plan y sus platos.
    fakeWith([spent("u1", "2026-09-26", 1.34, 1.2)]);
    await expect(enforceUserRateLimit("u1", "chat")).resolves.toBeUndefined();
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
        payload: { _user_id: "u1", _cost_usd: 0.0014, _month_only: false },
      }),
    ]);
  });

  it("con capScope month lo apunta también como gasto de solo-mes", async () => {
    const fake = fakeWith();
    await recordAiSpend("u1", 0.2, "month");
    expect(fake.calls).toEqual([
      expect.objectContaining({
        table: "record_ai_spend",
        payload: { _user_id: "u1", _cost_usd: 0.2, _month_only: true },
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

  describe("alias e IP (ticket 29)", () => {
    const quotaCalls = (fake: ReturnType<typeof fakeWith>) =>
      fake.calls.map((c) => c.payload as { _subject: string; _bucket: string; _limit: number });

    it("los alias del mismo buzón gastan la misma cuota", async () => {
      const fake = fakeWith();
      await checkEmailRateLimit("ana+1@gmail.com", "signup-confirm");
      await checkEmailRateLimit("a.n.a+2@googlemail.com", "signup-confirm");
      const [first, second] = quotaCalls(fake);
      expect(second?._subject).toBe(first?._subject);
    });

    it("con IP cuenta también por IP, hasheada y en su propio bucket", async () => {
      const fake = fakeWith();
      await checkEmailRateLimit("ana@example.com", "password-reset", "203.0.113.7");
      const calls = quotaCalls(fake);
      expect(calls.map((c) => c._bucket).sort()).toEqual(["auth-email-ip", "password-reset"]);
      const byIp = calls.find((c) => c._bucket === "auth-email-ip");
      expect(byIp?._subject).toMatch(/^ip:[0-9a-f]{64}$/);
      expect(byIp?._limit).toBe(20);
      expect(JSON.stringify(fake.calls)).not.toContain("203.0.113.7");
    });

    it("la IP es la misma cuota para el alta y el restablecimiento", async () => {
      const fake = fakeWith();
      await checkEmailRateLimit("ana@example.com", "password-reset", "203.0.113.7");
      await checkEmailRateLimit("luis@example.com", "signup-confirm", "203.0.113.7");
      const byIp = quotaCalls(fake).filter((c) => c._bucket === "auth-email-ip");
      expect(byIp).toHaveLength(2);
      expect(byIp[1]?._subject).toBe(byIp[0]?._subject);
    });

    it("una IP agotada corta aunque el correo sea nuevo, y deja auth_ip_quota_reached", async () => {
      fakeWith([], {
        rpc: {
          consume_rate_limit: (args) => [
            { allowed: args._bucket !== "auth-email-ip", retry_after_seconds: 60 },
          ],
        },
      });
      expect(await checkEmailRateLimit("nuevo@example.com", "signup-confirm", "203.0.113.7")).toBe(
        false,
      );
      expect(events()).toEqual(["auth_ip_quota_reached"]);
    });

    it("sin IP solo cuenta el correo", async () => {
      const fake = fakeWith();
      await checkEmailRateLimit("ana@example.com", "password-reset", null);
      expect(quotaCalls(fake).map((c) => c._bucket)).toEqual(["password-reset"]);
    });
  });

  describe("con RATE_LIMIT_SALT (ticket 30, SEC-DB-16)", () => {
    const previous = process.env.RATE_LIMIT_SALT;
    afterEach(() => {
      if (previous === undefined) delete process.env.RATE_LIMIT_SALT;
      else process.env.RATE_LIMIT_SALT = previous;
    });
    const subjectFor = async (email: string) => {
      const fake = fakeWith();
      await checkEmailRateLimit(email, "password-reset");
      return (fake.calls[0]?.payload as { _subject: string })._subject;
    };

    it("el hash lleva sal: probar correos sin la sal no lo revierte", async () => {
      delete process.env.RATE_LIMIT_SALT;
      const plain = await subjectFor("ana@example.com");
      process.env.RATE_LIMIT_SALT = "s".repeat(64);
      const salted = await subjectFor("ana@example.com");
      expect(salted).toMatch(/^email:[0-9a-f]{64}$/);
      expect(salted).not.toBe(plain);
      // Estable con la misma sal (si no, la cuota no contaría nada).
      expect(await subjectFor(" ANA@example.com")).toBe(salted);
      process.env.RATE_LIMIT_SALT = "t".repeat(64);
      expect(await subjectFor("ana@example.com")).not.toBe(salted);
    });
  });
});
