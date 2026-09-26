import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeRow } from "@/test/fake-supabase";

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
) {
  const fake = createFakeSupabase({
    profiles: [],
    push_subscriptions: [],
    monthly_plans: [],
    daily_logs: [],
    household_members: [],
    ...tables,
  });
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
beforeEach(() => {
  setSystemTime(MID_MONTH);
  consoleError = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  setSystemTime();
  consoleError.mockRestore();
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
