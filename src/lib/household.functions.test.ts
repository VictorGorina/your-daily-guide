import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeTables } from "@/test/fake-supabase";

import { propagateLogToFamilyHandler } from "./household.functions";

// Ana y Bea comparten la comida todos los días. El lunes 21 ya pasó.
const DATE = "2026-09-21";
const everyDay = [0, 1, 2, 3, 4, 5, 6];
const member = (user_id: string, is_planner: boolean) => ({
  household_id: "h1",
  user_id,
  display_name: user_id,
  uses_app: true,
  is_planner,
  portion: 1,
  home_schedule: null,
});
const seed = (): FakeTables => ({
  household_members: [member("ana", true), member("bea", false)],
  households: [{ id: "h1", shared_slots: { desayuno: [], comida: everyDay, cena: [] } }],
  daily_logs: [
    {
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

describe("propagateLogToFamily (ticket 21)", () => {
  it("lo que Bea cambia a la vez en su día no se pierde", async () => {
    const tables = seed();
    let raced = false;
    const fake = createFakeSupabase(tables, {
      failOn: (op) => {
        if (raced || op.table !== "daily_logs" || op.op !== "update") return null;
        raced = true;
        const row = tables.daily_logs![0]!;
        row.habits = [
          { label: "Comida", done: false },
          { label: "Cena", done: true, status: "plan" },
        ];
        row.updated_at = "2026-09-21T20:00:05Z";
        return null;
      },
    });
    setFakeAdmin(fake.client);

    const out = await propagateLogToFamilyHandler({
      data: {
        date: DATE,
        habitLabel: "Comida",
        status: "distinto",
        actual: "Paella",
        today: "2026-09-26",
      },
      context: { supabase: fake.client, userId: "ana" },
    });

    expect(out).toEqual({ propagated: 1 });
    expect(tables.daily_logs![0]!.habits).toEqual([
      { label: "Comida", done: true, status: "distinto", actual: "Paella" },
      { label: "Cena", done: true, status: "plan" },
    ]);
  });

  it("un día que el otro miembro no abrió no se crea", async () => {
    const tables = seed();
    tables.daily_logs = [];
    const fake = createFakeSupabase(tables);
    setFakeAdmin(fake.client);
    const out = await propagateLogToFamilyHandler({
      data: { date: DATE, habitLabel: "Comida", status: "plan", today: "2026-09-26" },
      context: { supabase: fake.client, userId: "ana" },
    });
    expect(out).toEqual({ propagated: 0 });
    expect(fake.calls.some((c) => c.op === "update" || c.op === "insert")).toBe(false);
  });
});
