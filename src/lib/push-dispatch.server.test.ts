import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOptions, type FakeRow } from "@/test/fake-supabase";

import { dispatchPush, dueDay, inWindow, pushDayFor } from "./push-dispatch.server";
import { EXPECTED_DUE, FIXTURE_NOW, PUSH_FIXTURE_PROFILES } from "./push-dispatch.fixtures";
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

const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe("inWindow — 30 minutos hacia atrás", () => {
  it("objetivo 08:00: a las 08:29 sí, a las 08:30 ya no, y nunca antes de la hora", () => {
    expect(inWindow(at("08:00"), at("08:00"))).toBe(true);
    expect(inWindow(at("08:00"), at("08:29"))).toBe(true);
    expect(inWindow(at("08:00"), at("08:30"))).toBe(false);
    expect(inWindow(at("08:00"), at("08:31"))).toBe(false);
    expect(inWindow(at("08:00"), at("07:59"))).toBe(false);
  });

  it("cruza la medianoche: 23:50 visto a las 00:10 sí, a las 00:20 no", () => {
    expect(inWindow(at("23:50"), at("00:10"))).toBe(true);
    expect(inWindow(at("23:50"), at("00:20"))).toBe(false);
    expect(inWindow(null, at("00:10"))).toBe(false);
  });
});

describe("pushDayFor — a qué día pertenece el aviso", () => {
  it("23:50 visto a las 00:10 es de ayer; 08:00 visto a las 08:10, de hoy", () => {
    expect(pushDayFor(at("23:50"), at("00:10"), "2026-10-02")).toBe("2026-10-01");
    expect(pushDayFor(at("08:00"), at("08:10"), "2026-10-02")).toBe("2026-10-02");
    expect(pushDayFor(at("08:00"), at("08:00"), "2026-10-01")).toBe("2026-10-01");
    expect(pushDayFor(at("23:50"), at("00:10"), "2026-10-01")).toBe("2026-09-30");
  });
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
        profile("antes", { morning_time: "07:30" }), // la ventana es (07:35, 08:05]
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

describe("dispatchPush — cruce de medianoche y marca atómica (ticket 07)", () => {
  // 22:10 UTC del 15 = 00:10 del 16 en Madrid.
  const AFTER_MIDNIGHT = new Date("2026-09-15T22:10:00Z");

  it("el repaso de las 23:50 visto a las 00:10 es del día anterior: lee y marca ese día", async () => {
    setSystemTime(AFTER_MIDNIGHT);
    const { fake, sent, run } = setup({
      profiles: [profile("ana", { evening_time: "23:50", tone: "exigente" })],
      push_subscriptions: [sub("ana")],
      daily_logs: [
        { user_id: "ana", log_date: "2026-09-15", habits: [{ done: false }] },
        { user_id: "ana", log_date: "2026-09-16", habits: [] },
      ],
    });
    await run();
    expect(sent[0]?.payload.body).toBe("Aún te queda 1 comida por registrar hoy.");
    expect(profileRow(fake.tables, "ana")?.evening_push_sent_on).toBe("2026-09-15");

    // Esa misma noche, a las 23:55, el repaso del 16 sale: el de ayer no lo gastó.
    setSystemTime(new Date("2026-09-16T21:55:00Z"));
    await run();
    expect(sent).toHaveLength(2);
    expect(profileRow(fake.tables, "ana")?.evening_push_sent_on).toBe("2026-09-16");
  });

  it("ya avisado ayer: el disparo de las 00:10 no repite el repaso de las 23:50", async () => {
    setSystemTime(AFTER_MIDNIGHT);
    const { sent, run } = setup({
      profiles: [profile("ana", { evening_time: "23:50", evening_push_sent_on: "2026-09-15" })],
      push_subscriptions: [sub("ana")],
    });
    await run();
    expect(sent).toEqual([]);
  });

  it("dos ejecuciones solapadas: solo la que reclama la fila envía", async () => {
    setSystemTime(new Date("2026-09-26T06:05:00Z"));
    const { fake, sent, run } = setup({
      profiles: [profile("ana", { morning_time: "08:00", evening_time: "08:00" })],
      push_subscriptions: [sub("ana")],
    });
    const summaries = await Promise.all([run(), run()]);
    // Mañana, noche y renovación: una vez cada uno, no dos.
    expect(sent).toHaveLength(3);
    expect(summaries.reduce((n, s) => n + s.sent, 0)).toBe(3);
    expect(profileRow(fake.tables, "ana")).toMatchObject({
      morning_push_sent_on: "2026-09-26",
      evening_push_sent_on: "2026-09-26",
      plan_renewal_push_sent_on: "2026-09-26",
    });
  });

  it("si falla el reclamo, no se envía y se registra", async () => {
    const { sent, run } = setup(
      {
        profiles: [profile("ana", { morning_time: "08:00" })],
        push_subscriptions: [sub("ana")],
      },
      undefined,
      { failOn: (op) => op.table === "profiles" && op.op === "update" },
    );
    const summary = await run();
    expect(sent).toEqual([]);
    expect(summary.errors).toBe(1);
    expect(loggedEvents(consoleError)).toContain("push_claim_failed");
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

  it("si falla la lectura de los días, nadie recibe el aviso ni queda marcado", async () => {
    const { fake, sent, run } = setup(
      {
        profiles: [
          profile("ana", { morning_time: "08:00" }),
          profile("bea", { evening_time: "08:00" }),
        ],
        push_subscriptions: [sub("ana"), sub("bea")],
      },
      undefined,
      { failOn: (op) => op.table === "daily_logs" },
    );
    const summary = await run();
    expect(sent).toEqual([]);
    expect(summary.errors).toBe(1);
    expect(profileRow(fake.tables, "ana")?.morning_push_sent_on).toBeNull();
    expect(profileRow(fake.tables, "bea")?.evening_push_sent_on).toBeNull();
    expect(loggedEvents(consoleError)).toContain("push_query_failed");
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

describe("dispatchPush — a escala (ticket 23)", () => {
  it("con la función SQL solo lee los perfiles que devuelve y usa su día", async () => {
    const selects: string[] = [];
    const { fake, sent, run } = setup(
      {
        profiles: [
          // La hora no cae en la ventana según el reloj de JS: manda la función.
          profile("ana", { morning_time: "03:00" }),
          profile("bea", { evening_time: "03:00" }),
          profile("carla", { morning_time: "08:00" }),
        ],
        push_subscriptions: [sub("ana"), sub("bea"), sub("carla")],
        daily_logs: [
          { user_id: "ana", log_date: "2026-09-14", guide: { meals: [{ idea: "Gachas" }] } },
          { user_id: "ana", log_date: "2026-09-15", guide: { meals: [{ idea: "Otro día" }] } },
        ],
      },
      undefined,
      {
        rpc: {
          due_push_profiles: () => [
            { id: "ana", kind: "morning", push_day: "2026-09-14" },
            { id: "bea", kind: "evening", push_day: "2026-09-15" },
          ],
        },
        failOn: (op) => {
          if (op.table === "profiles" && op.op === "select") {
            selects.push(op.filters.map((f) => f.kind).join(","));
          }
          return null;
        },
      },
    );
    const summary = await run();
    expect(summary).toMatchObject({ sent: 2, errors: 0 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/ana/1",
      "https://push.example/bea/1",
    ]);
    expect(sent.find((s) => s.endpoint.includes("ana"))?.payload.body).toBe("Hoy toca: Gachas");
    expect(profileRow(fake.tables, "ana")?.morning_push_sent_on).toBe("2026-09-14");
    expect(profileRow(fake.tables, "bea")?.evening_push_sent_on).toBe("2026-09-15");
    expect(profileRow(fake.tables, "carla")?.morning_push_sent_on).toBeNull();
    // Ningún recorrido de toda la tabla: solo la lectura por ids.
    expect(selects.filter((kinds) => !kinds.includes("in"))).toEqual([]);
    expect(loggedEvents(consoleWarn)).not.toContain("push_due_rpc_failed");
  });

  it("con la función SQL y nadie en la ventana no lee ninguna tabla", async () => {
    const { fake, sent, run } = setup(
      { profiles: [profile("ana", { morning_time: "08:00" })] },
      undefined,
      {
        rpc: { due_push_profiles: () => [] },
      },
    );
    await run();
    expect(sent).toEqual([]);
    expect(fake.calls.filter((op) => op.op !== "rpc")).toEqual([]);
  });

  it("sin la función SQL avisa en el log y recorre los perfiles con la regla de JS", async () => {
    const { sent, run } = setup({
      profiles: [profile("ana", { morning_time: "08:00" })],
      push_subscriptions: [sub("ana")],
    });
    await run();
    expect(sent).toHaveLength(1);
    expect(loggedEvents(consoleWarn)).toContain("push_due_rpc_failed");
  });

  it("más de 1.000 perfiles: los de la segunda página también reciben su aviso", async () => {
    const ids = Array.from({ length: 1005 }, (_, i) => `u${String(i).padStart(4, "0")}`);
    const { sent, run } = setup({
      profiles: ids.map((id) => profile(id, { morning_time: "08:00" })),
      push_subscriptions: [sub("u0000"), sub("u1004")],
    });
    const summary = await run();
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/u0000/1",
      "https://push.example/u1004/1",
    ]);
    expect(summary.skippedNoSubscription).toBe(1003);
  });

  it("en la última semana del mes la renovación sale aunque la función SQL no dé a nadie", async () => {
    setSystemTime(END_OF_MONTH);
    const { sent, run } = setup(
      { profiles: [profile("ana")], push_subscriptions: [sub("ana")] },
      undefined,
      { rpc: { due_push_profiles: () => [] } },
    );
    await run();
    expect(sent.map((s) => s.payload.url)).toEqual(["/plan?month=2026-10"]);
  });
});

describe("dueDay — perfiles de muestra en seis zonas horarias (ticket 23)", () => {
  // Los mismos perfiles y el mismo instante sirven para comparar a mano con
  // `due_push_profiles_at` en el SQL Editor (ver el ticket 23).
  it("da exactamente los avisos esperados", () => {
    setSystemTime(FIXTURE_NOW);
    const clockOf = (timeZone: string | null) => {
      const tz = timeZone ?? "Europe/Madrid";
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return {
        nowMinutes: num("hour") * 60 + num("minute"),
        today: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()),
      };
    };
    const got = PUSH_FIXTURE_PROFILES.flatMap((p) => {
      const clock = clockOf(p.timezone);
      return (["morning", "evening"] as const).flatMap((kind) => {
        const day = dueDay(p[`${kind}_time`], p[`${kind}_push_sent_on`], clock);
        return day ? [`${p.id}|${kind}|${day}`] : [];
      });
    });
    expect(got.sort()).toEqual([...EXPECTED_DUE].sort());
  });
});
