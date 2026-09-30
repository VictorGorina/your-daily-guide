import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOptions, type FakeRow } from "@/test/fake-supabase";

import { cleanPendingReservations } from "./day-reservation";
import type { SettleDayDeps } from "./day-settle.functions";
import { settleDayHandler } from "./day-settle.server";
import type { MealHabit, MonthlyPlan } from "./plan-shared";

const TODAY = "2026-09-10";
const NOW = new Date(`${TODAY}T10:00:00Z`);

let logs: string[];
let consoleError: ReturnType<typeof spyOn>;
let consoleWarn: ReturnType<typeof spyOn>;
const savedKey = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  setSystemTime(NOW);
  process.env.OPENROUTER_API_KEY = "test-key";
  logs = [];
  const capture = (line: unknown) => void logs.push(String(line));
  consoleError = spyOn(console, "error").mockImplementation(capture);
  consoleWarn = spyOn(console, "warn").mockImplementation(capture);
});
afterEach(() => {
  setSystemTime();
  process.env.OPENROUTER_API_KEY = savedKey;
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

const changed = (label: string, kcal: number): MealHabit => ({
  label,
  done: true,
  status: "distinto",
  plannedIdea: `${label} del plan`,
  actual: `${label} de verdad`,
  swapKcalDelta: kcal,
  swapCompensated: false,
});

const plan = (lunch: (week: number, day: number) => string): MonthlyPlan =>
  ({
    intro: "",
    focus: [],
    weeks: Array.from({ length: 5 }, (_, wi) => ({
      label: `Semana ${wi + 1}`,
      focus: "",
      breakfasts: ["Avena"],
      snacks: ["Fruta"],
      days: Array.from({ length: 7 }, (_, di) => ({
        day: String(di),
        lunch: lunch(wi, di),
        dinner: `Cena ${wi}-${di}`,
      })),
    })),
  }) as MonthlyPlan;

/** Día con un plato cambiado de +450 kcal (por encima de cualquier umbral). */
function setup(opts: FakeOptions & { habits?: MealHabit[]; adjustment?: unknown } = {}) {
  const log: FakeRow = {
    user_id: "u1",
    log_date: TODAY,
    habits: opts.habits ?? [changed("Comida", 450)],
    snacks: null,
    exercise: null,
    adjustment: opts.adjustment ?? null,
    updated_at: "2026-09-10T08:00:00Z",
  };
  const fake = createFakeSupabase(
    {
      daily_logs: [log],
      profiles: [{ id: "u1", goal_type: "mantener" }],
      monthly_plans: [{ id: "p1", user_id: "u1", month: TODAY.slice(0, 7) }],
      ai_spend: [],
    },
    {
      ...opts,
      rpc: { consume_rate_limit: () => [{ allowed: true, retry_after_seconds: 0 }] },
    },
  );
  setFakeAdmin(fake.client);
  return fake;
}

/** `reflowMeals` falso: cambia todas las comidas futuras, o lanza. */
function fakeReflow(fail?: Error) {
  const calls: unknown[] = [];
  const reflow: SettleDayDeps["reflow"] = async (opts) => {
    calls.push(opts);
    if (fail) throw fail;
    return {
      before: plan((w, d) => `Comida ${w}-${d}`),
      plan: plan((w, d) => `Comida ligera ${w}-${d}`),
      summary: "He aligerado tus comidas.",
      synced: 0,
      absorbedKcal: 450,
      partial: false,
    };
  };
  return { reflow, calls };
}

const run = (fake: ReturnType<typeof setup>, deps: SettleDayDeps) =>
  settleDayHandler(
    { data: { today: TODAY, changes: [] }, context: { supabase: fake.client, userId: "u1" } },
    deps,
  );

const dayRow = (fake: ReturnType<typeof setup>) => fake.tables.daily_logs![0]!;
const habitsOf = (fake: ReturnType<typeof setup>) => dayRow(fake).habits as MealHabit[];
const pendingOf = (fake: ReturnType<typeof setup>) =>
  cleanPendingReservations(dayRow(fake).adjustment);

describe("settleDayHandler — un solo asentamiento del día", () => {
  it("por encima del umbral: reserva, recoloca una vez y guarda el resultado", async () => {
    const fake = setup();
    const { reflow, calls } = fakeReflow();

    const result = await run(fake, { reflow });

    expect(calls).toHaveLength(1);
    expect(result.outcome).toBe("adjusted");
    expect(result.kcal).toBe(450);
    expect(habitsOf(fake)[0]!.swapCompensated).toBe(true);
    const record = dayRow(fake).adjustment as { lastOutcome: string; adjustment: { kcal: number } };
    expect(record.lastOutcome).toBe("adjusted");
    expect(record.adjustment.kcal).toBe(450);
  });

  it("si la recolocación falla, devuelve la reserva y relanza", async () => {
    const fake = setup();
    const { reflow } = fakeReflow(new Error("modelo caído"));

    await expect(run(fake, { reflow })).rejects.toThrow("modelo caído");

    expect(habitsOf(fake)[0]!.swapCompensated).toBe(false);
  });

  it("por debajo del umbral no reserva ni llama al modelo", async () => {
    const fake = setup({ habits: [changed("Comida", 60)] });
    const { reflow, calls } = fakeReflow();

    const result = await run(fake, { reflow });

    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe("below-threshold");
    expect(habitsOf(fake)[0]!.swapCompensated).toBe(false);
  });

  it("si la liberación también falla, lo registra (settle_release_failed)", async () => {
    // La liberación es la escritura que vuelve a poner `swapCompensated: false`.
    const fake = setup({
      failOn: (op) =>
        op.table === "daily_logs" &&
        op.op === "update" &&
        ((op.payload as { habits?: MealHabit[] })?.habits ?? []).some(
          (h) => h.swapCompensated === false,
        ),
    });
    const { reflow } = fakeReflow(new Error("modelo caído"));

    await expect(run(fake, { reflow })).rejects.toThrow("modelo caído");

    expect(events()).toContain("settle_release_failed");
    // La marca se queda: el siguiente asentamiento la devuelve al caducar.
    expect(pendingOf(fake).map((p) => p.reservation.total)).toEqual([450]);
  });
});

describe("settleDayHandler — la reserva caduca (ticket 22)", () => {
  const reservation = (total: number, labels = ["Comida"]) => ({
    labels,
    snackKcal: 0,
    exerciseKcal: 0,
    total,
    protein: 0,
  });
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
  const reservedHabit = (label: string, kcal: number): MealHabit => ({
    ...changed(label, kcal),
    swapCompensated: true,
  });

  it("mientras llama al modelo, la marca guarda lo reservado; el resultado la quita", async () => {
    const fake = setup();
    let during: ReturnType<typeof pendingOf> = [];
    const { reflow } = fakeReflow();
    const spy: SettleDayDeps["reflow"] = async (opts) => {
      during = pendingOf(fake);
      return reflow!(opts);
    };

    await run(fake, { reflow: spy });

    expect(during).toHaveLength(1);
    expect(during[0]!.reservation).toEqual(reservation(450));
    expect(during[0]!.since).toBe(NOW.toISOString());
    expect(pendingOf(fake)).toEqual([]);
  });

  it("una reserva caducada de otro asentamiento se devuelve y el día se asienta entero", async () => {
    const fake = setup({
      habits: [reservedHabit("Comida", 450)],
      adjustment: {
        adjustment: null,
        lastOutcome: null,
        pending: [{ id: "muerta", since: minutesAgo(6), reservation: reservation(450) }],
      },
    });
    const { reflow, calls } = fakeReflow();

    const result = await run(fake, { reflow });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ outcome: "adjusted", kcal: 450 });
    expect(pendingOf(fake)).toEqual([]);
    expect(events()).toContain("settle_reservation_expired");
  });

  it("una reserva en vuelo (2 min) no se toca: su desvío ya lo está asentando otro", async () => {
    const pending = [{ id: "viva", since: minutesAgo(2), reservation: reservation(450) }];
    const fake = setup({
      habits: [reservedHabit("Comida", 450)],
      adjustment: { adjustment: null, lastOutcome: null, pending },
    });
    const { reflow, calls } = fakeReflow();

    const result = await run(fake, { reflow });

    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe("nothing");
    expect(habitsOf(fake)[0]!.swapCompensated).toBe(true);
    expect(pendingOf(fake).map((p) => p.id)).toEqual(["viva"]);
  });

  it("guardar el resultado no borra la reserva en vuelo de otro", async () => {
    const fake = setup({
      habits: [reservedHabit("Cena", 300), changed("Comida", 450)],
      adjustment: {
        adjustment: null,
        lastOutcome: null,
        pending: [{ id: "otra", since: minutesAgo(1), reservation: reservation(300, ["Cena"]) }],
      },
    });
    const { reflow } = fakeReflow();

    const result = await run(fake, { reflow });

    expect(result).toMatchObject({ outcome: "adjusted", kcal: 450 });
    expect(pendingOf(fake).map((p) => p.id)).toEqual(["otra"]);
  });
});

describe("settleDayHandler — un lote reenviado no compensa dos veces (ticket 27, PERF-11)", () => {
  // El cliente guarda el lote en vuelo y, si la app se cerró sin respuesta, lo
  // reenvía. Casi siempre el servidor ya lo había asentado: el mismo desvío de
  // un plato ya compensado no puede volver a contar como pendiente.
  const resend = (fake: ReturnType<typeof setup>, kcalDelta: number, proteinDelta: number | null) =>
    settleDayHandler(
      {
        data: {
          today: TODAY,
          changes: [
            {
              label: "Comida",
              slot: "comida",
              dish: "Comida de verdad",
              plannedDish: "Comida del plan",
              kcalDelta,
              proteinDelta,
            },
          ],
        },
        context: { supabase: fake.client, userId: "u1" },
      },
      { reflow: fakeReflow().reflow },
    );
  const compensated = (protein?: number): MealHabit => ({
    ...changed("Comida", 450),
    swapCompensated: true,
    ...(protein != null ? { swapProteinDelta: protein } : {}),
  });

  it("el mismo desvío ya compensado se queda compensado y no recoloca", async () => {
    const fake = setup({ habits: [compensated()] });

    const result = await resend(fake, 450, null);

    expect(result.outcome).toBe("nothing");
    expect(habitsOf(fake)[0]!.swapCompensated).toBe(true);
  });

  it("también con la proteína: misma cifra, sigue compensado", async () => {
    const fake = setup({ habits: [compensated(-12)] });

    const result = await resend(fake, 450, -12);

    expect(result.outcome).toBe("nothing");
    expect(habitsOf(fake)[0]!.swapCompensated).toBe(true);
  });

  it("un desvío distinto sí se vuelve a asentar", async () => {
    const fake = setup({ habits: [compensated()] });

    const result = await resend(fake, 700, null);

    expect(result.outcome).toBe("adjusted");
    expect(habitsOf(fake)[0]!.swapKcalDelta).toBe(700);
  });

  it("otra proteína con las mismas kcal también se vuelve a asentar", async () => {
    const fake = setup({ habits: [compensated(-12)] });

    await resend(fake, 450, -30);

    expect(habitsOf(fake)[0]!.swapProteinDelta).toBe(-30);
  });
});
