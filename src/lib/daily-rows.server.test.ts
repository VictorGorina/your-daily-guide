import { describe, expect, it } from "bun:test";

import { createFakeSupabase, type FakeOp, type FakeTables } from "@/test/fake-supabase";

import { patchDailyHabits } from "./daily-rows.server";

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
