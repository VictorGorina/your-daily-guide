import { describe, expect, it } from "bun:test";

import { createFakeSupabase, type FakeOp, type FakeTables } from "@/test/fake-supabase";

import { patchDailyHabits, updateDailyLogCas } from "./daily-rows.server";

type Habit = { label: string; done: boolean };
const DATE = "2026-09-21";

const seed = (): FakeTables => ({
  daily_logs: [
    {
      id: "l1",
      user_id: "bea",
      log_date: DATE,
      habits: [
        { label: "Comida", done: false },
        { label: "Cena", done: false },
      ],
      updated_at: "2026-09-21T20:00:00Z",
    },
  ],
});

/** Antes de las primeras `n` escrituras, otra marca la cena (y mueve `updated_at`). */
const concurrentDinner = (tables: FakeTables, n: number) => {
  let left = n;
  return (op: FakeOp) => {
    if (op.op !== "update" || left <= 0) return null;
    left--;
    const row = tables.daily_logs![0]!;
    row.habits = (row.habits as Habit[]).map((h) =>
      h.label === "Cena" ? { ...h, done: true } : h,
    );
    row.updated_at = `2026-09-21T20:00:0${n - left}Z`;
    return null;
  };
};

const markLunch = (habits: Habit[]) =>
  habits.map((h) => (h.label === "Comida" ? { ...h, done: true } : h));

describe("patchDailyHabits", () => {
  it("si otra escritura se cruza, se aplica sobre lo nuevo y se conservan las dos", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentDinner(tables, 1) });
    const out = await patchDailyHabits<Habit>(fake.client, "bea", DATE, markLunch);
    expect(out).toEqual([
      { label: "Comida", done: true },
      { label: "Cena", done: true },
    ]);
    expect(tables.daily_logs![0]!.habits).toEqual(out);
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(2);
  });

  it("con tres choques seguidos, lanza", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentDinner(tables, 3) });
    await expect(patchDailyHabits<Habit>(fake.client, "bea", DATE, markLunch)).rejects.toThrow(
      "No hemos podido guardar el cambio de comida",
    );
  });

  it("sin día, o sin nada que escribir, no escribe", async () => {
    const fake = createFakeSupabase(seed());
    expect(await patchDailyHabits<Habit>(fake.client, "bea", "2026-09-20", markLunch)).toBeNull();
    expect(await patchDailyHabits<Habit>(fake.client, "bea", DATE, () => null)).toBeNull();
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });
});

type SnackRow = { snacks: { entries: string[] } | null; updated_at: string };
const addChips = (latest: SnackRow | null) => ({
  snacks: { entries: [...(latest?.snacks?.entries ?? []), "chips"] },
});
const OPTS = { exhaustedMessage: "No hemos podido guardar el picoteo." };

describe("updateDailyLogCas", () => {
  it("escribe solo las columnas del patch, con la guarda sobre updated_at", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables);
    const out = await updateDailyLogCas<SnackRow>(
      fake.client,
      "bea",
      DATE,
      "snacks",
      addChips,
      OPTS,
    );
    expect(out).toMatchObject({ patch: { snacks: { entries: ["chips"] } }, attempts: 1 });
    expect(out.latest?.updated_at).toBe("2026-09-21T20:00:00Z");
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.payload).toEqual({ snacks: { entries: ["chips"] } });
    expect(update.filters).toContainEqual({
      kind: "eq",
      column: "updated_at",
      value: "2026-09-21T20:00:00Z",
    });
    // `habits` sigue ahí: la escritura no toca lo que no está en el patch.
    expect(tables.daily_logs![0]!.habits).toHaveLength(2);
  });

  it("pide updated_at aunque no esté en las columnas, y no lo duplica si está", async () => {
    const fake = createFakeSupabase(seed());
    await updateDailyLogCas(fake.client, "bea", DATE, "snacks", () => null, OPTS);
    await updateDailyLogCas(fake.client, "bea", DATE, "snacks, updated_at", () => null, OPTS);
    const selects = fake.calls.filter((c) => c.op === "select").map((c) => c.columns);
    expect(selects).toEqual([
      ["snacks", "updated_at"],
      ["snacks", "updated_at"],
    ]);
  });

  it("si otra escritura se cruza, reconstruye sobre lo nuevo", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentDinner(tables, 2) });
    const seen: string[] = [];
    const out = await updateDailyLogCas(
      fake.client,
      "bea",
      DATE,
      "habits",
      (latest) => {
        seen.push(latest.updated_at);
        return { habits: markLunch(latest.habits as Habit[]) };
      },
      OPTS,
    );
    expect(out.attempts).toBe(3);
    expect(seen).toEqual(["2026-09-21T20:00:00Z", "2026-09-21T20:00:01Z", "2026-09-21T20:00:02Z"]);
    expect(tables.daily_logs![0]!.habits).toEqual([
      { label: "Comida", done: true },
      { label: "Cena", done: true },
    ]);
  });

  it("con tres choques seguidos, lanza el mensaje de quien llama", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentDinner(tables, 3) });
    await expect(
      updateDailyLogCas<SnackRow>(fake.client, "bea", DATE, "snacks", addChips, OPTS),
    ).rejects.toThrow("No hemos podido guardar el picoteo.");
  });

  it("sin fila (y sin create), no escribe ni llama a rebuild", async () => {
    const fake = createFakeSupabase(seed());
    let called = false;
    const out = await updateDailyLogCas(
      fake.client,
      "bea",
      "2026-09-20",
      "snacks",
      () => {
        called = true;
        return {};
      },
      OPTS,
    );
    expect(out).toEqual({ patch: null, latest: null, attempts: 1 });
    expect(called).toBe(false);
    expect(fake.calls.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
  });

  it("con create, inserta la fila del día con lo que devuelve rebuild(null)", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables);
    const out = await updateDailyLogCas<SnackRow>(
      fake.client,
      "bea",
      "2026-09-22",
      "snacks",
      addChips,
      { ...OPTS, create: true },
    );
    expect(out).toEqual({ patch: { snacks: { entries: ["chips"] } }, latest: null, attempts: 1 });
    const created = tables.daily_logs!.find((r) => r.log_date === "2026-09-22")!;
    expect(created).toMatchObject({ user_id: "bea", snacks: { entries: ["chips"] } });
  });

  it("con create, si el cliente creó la fila a la vez (23505), relee y actualiza", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, {
      failOn: (op) => {
        if (op.op !== "insert") return null;
        tables.daily_logs!.push({
          id: "l2",
          user_id: "bea",
          log_date: "2026-09-22",
          habits: [],
          snacks: { entries: ["aceitunas"] },
          updated_at: "2026-09-22T10:00:00Z",
        });
        return { code: "23505", message: "duplicate key" };
      },
    });
    const out = await updateDailyLogCas<SnackRow>(
      fake.client,
      "bea",
      "2026-09-22",
      "snacks",
      addChips,
      { ...OPTS, create: true },
    );
    expect(out.attempts).toBe(2);
    expect(out.latest?.updated_at).toBe("2026-09-22T10:00:00Z");
    const row = tables.daily_logs!.find((r) => r.log_date === "2026-09-22")!;
    expect(row.snacks).toEqual({ entries: ["aceitunas", "chips"] });
  });

  it("un error que no es 23505 al crear, o al leer, se relanza", async () => {
    const insertFails = createFakeSupabase(seed(), {
      failOn: (op) => (op.op === "insert" ? { code: "42501", message: "rls" } : null),
    });
    await expect(
      updateDailyLogCas(insertFails.client, "bea", "2026-09-22", "snacks", addChips, {
        ...OPTS,
        create: true,
      }),
    ).rejects.toMatchObject({ code: "42501" });

    const readFails = createFakeSupabase(seed(), {
      failOn: (op) => (op.op === "select" ? { code: "42703", message: "no existe" } : null),
    });
    await expect(
      updateDailyLogCas(readFails.client, "bea", DATE, "adjustment", () => null, OPTS),
    ).rejects.toMatchObject({ code: "42703" });
  });
});
