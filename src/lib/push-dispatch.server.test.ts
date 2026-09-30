import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOptions, type FakeRow } from "@/test/fake-supabase";

import { dispatchPush } from "./push-dispatch.server";
import type { PushPayload } from "./web-push.server";

// Mediados de mes (sin aviso de renovación): 06:05 UTC = 08:05 en Madrid.
const MID_MONTH = new Date("2026-09-15T06:05:00Z");
// Quedan 4 días de septiembre: toca avisar de preparar octubre.
const END_OF_MONTH = new Date("2026-09-26T06:05:00Z");

const profile = (id: string, over: FakeRow = {}): FakeRow => ({
  id,
  display_name: id === "ana" ? "Ana" : null,
  morning_time: "03:00",
  evening_time: "03:00",
  morning_push_sent_on: null,
  evening_push_sent_on: null,
  plan_renewal_push_sent_on: null,
  tone: null,
  timezone: "Europe/Madrid",
  onboarding_completed: true,
  ...over,
});

const sub = (user_id: string, n = 1): FakeRow => ({
  user_id,
  endpoint: `https://push.example/${user_id}/${n}`,
  p256dh: "p",
  auth: "a",
});

type Sent = { endpoint: string; payload: PushPayload };

function setup(
  tables: Record<string, FakeRow[]>,
  result: (endpoint: string) => unknown = () => "sent",
  opts: FakeOptions = {},
) {
  const fake = createFakeSupabase(
    {
      profiles: [],
      push_subscriptions: [],
      monthly_plans: [],
      daily_logs: [],
      household_members: [],
      ...tables,
    },
    opts,
  );
  setFakeAdmin(fake.client);
  const sent: Sent[] = [];
  const send = async (s: { endpoint: string }, payload: PushPayload) => {
    sent.push({ endpoint: s.endpoint, payload });
    const r = result(s.endpoint);
    if (r instanceof Error) throw r;
    return r as "sent" | "gone" | "failed";
  };
  return { fake, sent, run: () => dispatchPush({ send }) };
}

const profileRow = (tables: Record<string, FakeRow[]>, id: string) =>
  tables.profiles.find((p) => p.id === id);

let consoleError: ReturnType<typeof spyOn>;
let consoleWarn: ReturnType<typeof spyOn>;
beforeEach(() => {
  setSystemTime(MID_MONTH);
  consoleError = spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setSystemTime();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

const loggedEvents = (spy: ReturnType<typeof spyOn>) =>
  spy.mock.calls.map((call: unknown[]) => {
    try {
      return (JSON.parse(String(call[0])) as { event?: string }).event;
    } catch {
      return undefined;
    }
  });

describe("dispatchPush — resumen de la mañana", () => {
  it("envía a cada suscripción con el primer plato de la guía y marca el día", async () => {
    const { fake, sent, run } = setup({
      profiles: [profile("ana", { morning_time: "08:00" })],
      push_subscriptions: [sub("ana", 1), sub("ana", 2)],
      daily_logs: [
        {
          user_id: "ana",
          log_date: "2026-09-15",
          guide: { meals: [{ idea: "Tostada con tomate" }] },
        },
      ],
    });
    const summary = await run();
    expect(summary).toMatchObject({ sent: 2, gone: 0, failed: 0, errors: 0 });
    expect(sent.map((s) => s.endpoint)).toEqual([
      "https://push.example/ana/1",
      "https://push.example/ana/2",
    ]);
    expect(sent[0]?.payload).toEqual({
      title: "Buenos días, Ana",
      body: "Hoy toca: Tostada con tomate",
      url: "/hoy",
    });
    expect(profileRow(fake.tables, "ana")?.morning_push_sent_on).toBe("2026-09-15");
  });

  it("ya enviado hoy, fuera de la ventana o sin onboarding: nada", async () => {
    const { sent, run } = setup({
      profiles: [
        profile("hoy", { morning_time: "08:00", morning_push_sent_on: "2026-09-15" }),
        profile("tarde", { morning_time: "09:00" }),
        profile("antes", { morning_time: "07:40" }), // la ventana es (07:45, 08:05]
        profile("nuevo", { morning_time: "08:00", onboarding_completed: false }),
      ],
      push_subscriptions: [sub("hoy"), sub("tarde"), sub("antes"), sub("nuevo")],
    });
    await run();
    expect(sent).toEqual([]);
  });

  it("sin suscripciones cuenta como omitido, pero marca el día para no reintentar en bucle", async () => {
    const { fake, sent, run } = setup({
      profiles: [profile("ana", { morning_time: "08:00" })],
    });
    const summary = await run();
    expect(summary.skippedNoSubscription).toBe(1);
    expect(sent).toEqual([]);
    expect(profileRow(fake.tables, "ana")?.morning_push_sent_on).toBe("2026-09-15");
  });

  it("cada perfil con su reloj: en Tokio son las 15:05", async () => {
    const { fake, sent, run } = setup({
      profiles: [profile("kenji", { timezone: "Asia/Tokyo", evening_time: "15:00" })],
      push_subscriptions: [sub("kenji")],
    });
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.title).toBe("¿Cómo ha ido tu día?");
    expect(profileRow(fake.tables, "kenji")?.evening_push_sent_on).toBe("2026-09-15");
  });
});

describe("dispatchPush — resultado de cada envío", () => {
  it("gone borra la suscripción; failed la conserva; una excepción cuenta como error", async () => {
    const { fake, run } = setup(
      {
        profiles: [profile("ana", { morning_time: "08:00" })],
        push_subscriptions: [sub("ana", 1), sub("ana", 2), sub("ana", 3), sub("ana", 4)],
      },
      (endpoint) =>
        endpoint.endsWith("/1")
          ? "sent"
          : endpoint.endsWith("/2")
            ? "gone"
            : endpoint.endsWith("/3")
              ? "failed"
              : new Error("red caída"),
    );
    const summary = await run();
    expect(summary).toMatchObject({ sent: 1, gone: 1, failed: 1, errors: 1 });
    expect(fake.tables.push_subscriptions.map((s) => s.endpoint)).toEqual([
      "https://push.example/ana/1",
      "https://push.example/ana/3",
      "https://push.example/ana/4",
    ]);
  });
});

describe("dispatchPush — repaso de la noche", () => {
  const evening = (tone: string, habits: FakeRow[]) =>
    setup({
      profiles: [profile("ana", { evening_time: "08:00", tone })],
      push_subscriptions: [sub("ana")],
      daily_logs: [{ user_id: "ana", log_date: "2026-09-15", habits }],
    });

  it("tono relajado con el día completo: no se envía (contactar menos), pero se marca", async () => {
    const { fake, sent, run } = evening("relajado", [{ done: true }, { done: true }]);
    const summary = await run();
    expect(summary.skippedLowNeed).toBe(1);
    expect(sent).toEqual([]);
    expect(profileRow(fake.tables, "ana")?.evening_push_sent_on).toBe("2026-09-15");
  });

  it("tono exigente: cuenta las comidas que faltan", async () => {
    const { sent, run } = evening("exigente", [{ done: true }, { done: false }, { done: false }]);
    await run();
    expect(sent[0]?.payload.body).toBe("Aún te quedan 2 comidas por registrar hoy.");
  });
});

describe("dispatchPush — aviso de preparar el mes que viene", () => {
  beforeEach(() => setSystemTime(END_OF_MONTH));

  it("sin plan de octubre: avisa una vez con el enlace al mes que viene", async () => {
    const { fake, sent, run } = setup({
      profiles: [profile("ana")],
      push_subscriptions: [sub("ana")],
    });
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.url).toBe("/plan?month=2026-10");
    expect(sent[0]?.payload.title).toBe("Ana, es hora de preparar tu plan de octubre");
    expect(profileRow(fake.tables, "ana")?.plan_renewal_push_sent_on).toBe("2026-09-26");
  });

  it("con el plan ya generado, o ya avisado hoy: nada", async () => {
    const { sent, run } = setup({
      profiles: [profile("ana"), profile("bea", { plan_renewal_push_sent_on: "2026-09-26" })],
      push_subscriptions: [sub("ana"), sub("bea")],
      monthly_plans: [{ user_id: "ana", month: "2026-10" }],
    });
    await run();
    expect(sent).toEqual([]);
  });

  it("quien no planifica en su hogar recibe el aviso de sus comidas en solitario", async () => {
    const { sent, run } = setup({
      profiles: [profile("bea")],
      push_subscriptions: [sub("bea")],
      household_members: [
        { user_id: "ana", is_planner: true },
        { user_id: "bea", is_planner: false },
      ],
    });
    await run();
    expect(sent[0]?.payload.body).toContain("El menú de tu casa lo renueva quien planifica");
  });
});

describe("dispatchPush — fallos que no deben tumbar el envío (ticket 06)", () => {
  it("una zona horaria inválida usa el reloj de Madrid y no deja sin push a los demás", async () => {
    const { fake, sent, run } = setup({
      profiles: [
        profile("marte", { timezone: "Mars/Olympus", morning_time: "08:00" }),
        profile("ana", { morning_time: "08:00" }),
      ],
      push_subscriptions: [sub("marte"), sub("ana")],
    });
    const summary = await run();
    expect(summary.sent).toBe(2);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/ana/1",
      "https://push.example/marte/1",
    ]);
    expect(profileRow(fake.tables, "marte")?.morning_push_sent_on).toBe("2026-09-15");
    expect(loggedEvents(consoleWarn)).toContain("push_bad_timezone");
  });

  it("si falla la consulta de suscripciones, no se envía ni se marca nada", async () => {
    const { fake, sent, run } = setup(
      {
        profiles: [profile("ana", { morning_time: "08:00" })],
        push_subscriptions: [sub("ana")],
      },
      undefined,
      { failOn: (op) => op.table === "push_subscriptions" && op.op === "select" },
    );
    const summary = await run();
    expect(sent).toEqual([]);
    expect(summary.errors).toBe(1);
    expect(profileRow(fake.tables, "ana")?.morning_push_sent_on).toBeNull();
    expect(loggedEvents(consoleError)).toContain("push_query_failed");
  });

  it("si falla la consulta de planes, no hay aviso de renovación ni se marca", async () => {
    setSystemTime(END_OF_MONTH);
    const { fake, sent, run } = setup(
      {
        profiles: [profile("ana")],
        push_subscriptions: [sub("ana")],
        monthly_plans: [{ user_id: "ana", month: "2026-10" }],
      },
      undefined,
      { failOn: (op) => op.table === "monthly_plans" },
    );
    await run();
    expect(sent).toEqual([]);
    expect(profileRow(fake.tables, "ana")?.plan_renewal_push_sent_on).toBeNull();
    expect(loggedEvents(consoleError)).toContain("push_query_failed");
  });

  it("si falla la lectura del día de un perfil, ese perfil no se envía ni se marca", async () => {
    const { fake, sent, run } = setup(
      {
        profiles: [
          profile("ana", { morning_time: "08:00" }),
          profile("bea", { morning_time: "08:00" }),
        ],
        push_subscriptions: [sub("ana"), sub("bea")],
      },
      undefined,
      {
        failOn: (op) =>
          op.table === "daily_logs" &&
          op.filters.some((f) => f.kind === "eq" && f.column === "user_id" && f.value === "ana"),
      },
    );
    const summary = await run();
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/bea/1"]);
    expect(summary.errors).toBe(1);
    expect(profileRow(fake.tables, "ana")?.morning_push_sent_on).toBeNull();
    expect(profileRow(fake.tables, "bea")?.morning_push_sent_on).toBe("2026-09-15");
  });

  it("las consultas por user_id van en grupos de 100 como mucho", async () => {
    setSystemTime(END_OF_MONTH);
    const ids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    const inSizes: number[] = [];
    const { sent, run } = setup(
      {
        profiles: ids.map((id) => profile(id)),
        push_subscriptions: ids.map((id) => sub(id)),
        monthly_plans: [{ user_id: "u0", month: "2026-10" }],
      },
      undefined,
      {
        failOn: (op) => {
          for (const f of op.filters) {
            if (f.kind === "in" && f.column === "user_id") inSizes.push(f.value.length);
          }
          return null;
        },
      },
    );
    await run();
    expect(sent).toHaveLength(149);
    expect(inSizes.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(100);
  });
});
