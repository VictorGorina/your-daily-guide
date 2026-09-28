import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { createFakeSupabase, type FakeOp, type FakeTables } from "@/test/fake-supabase";

import {
  CAS_RETRY_PAUSE_MS,
  PLAN_CAS_EXHAUSTED_MESSAGE,
  type PlanRowCas,
  updatePlanRowCas,
} from "./plan-rows.server";

const MONTH = "2026-09";

const seed = (): FakeTables => ({
  monthly_plans: [
    {
      user_id: "u1",
      month: MONTH,
      plan: { dishes: ["IA"] },
      shopping: [],
      updated_at: "2026-09-26T10:00:00.000Z",
    },
    // Otra persona, mismo mes: nunca se toca.
    { user_id: "u2", month: MONTH, plan: { dishes: [] }, updated_at: "2026-09-26T10:00:00.000Z" },
  ],
});

/** `failOn` que, justo antes de las primeras `n` escrituras CAS, hace de otra
 *  escritura que llega entretanto: cambia la fila y su `updated_at`. */
const concurrentWriter = (tables: FakeTables, n: number) => {
  let left = n;
  return (op: FakeOp) => {
    if (op.op !== "update" || left <= 0) return null;
    left--;
    const row = tables.monthly_plans!.find((r) => r.user_id === "u1")!;
    const dishes = (row.plan as { dishes: string[] }).dishes;
    row.plan = { dishes: [...dishes, `a mano ${n - left}`] };
    row.updated_at = `2026-09-26T10:00:0${n - left}.000Z`;
    return null;
  };
};

const addDish = (latest: PlanRowCas) => ({
  plan: { dishes: [...(latest.plan as { dishes: string[] }).dishes, "nuevo"] },
});

describe("updatePlanRowCas", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  it("sin nadie en medio, escribe a la primera y con la guarda de versión", async () => {
    const fake = createFakeSupabase(seed());
    const out = await updatePlanRowCas(fake.client, "u1", MONTH, "plan", addDish);

    expect(out.attempts).toBe(1);
    expect(fake.tables.monthly_plans![0]!.plan).toEqual({ dishes: ["IA", "nuevo"] });
    expect(fake.tables.monthly_plans![1]!.plan).toEqual({ dishes: [] });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.filters).toContainEqual({
      kind: "eq",
      column: "updated_at",
      value: "2026-09-26T10:00:00.000Z",
    });
    // Pide `updated_at` aunque quien llama no lo nombre.
    expect(fake.calls[0]!.columns).toEqual(["plan", "updated_at"]);
  });

  it("si alguien escribe entretanto, relee y reconstruye sobre la versión nueva", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentWriter(tables, 1) });
    const seen: unknown[] = [];
    const out = await updatePlanRowCas(fake.client, "u1", MONTH, "plan, updated_at", (latest) => {
      seen.push(latest.plan);
      return addDish(latest);
    });

    expect(out.attempts).toBe(2);
    expect(seen).toEqual([{ dishes: ["IA"] }, { dishes: ["IA", "a mano 1"] }]);
    // Lo que se escribió entretanto sobrevive.
    expect(tables.monthly_plans![0]!.plan).toEqual({ dishes: ["IA", "a mano 1", "nuevo"] });
    expect(warn).not.toHaveBeenCalled();
  });

  it("con cuatro choques seguidos, al quinto intento escribe", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentWriter(tables, 4) });
    const out = await updatePlanRowCas(fake.client, "u1", MONTH, "plan", addDish);

    expect(out.attempts).toBe(5);
    expect(tables.monthly_plans![0]!.plan).toEqual({
      dishes: ["IA", "a mano 1", "a mano 2", "a mano 3", "a mano 4", "nuevo"],
    });
  });

  it("espera un poco antes de reintentar, para no chocar otra vez en el mismo instante", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentWriter(tables, 1) });
    const start = performance.now();
    await updatePlanRowCas(fake.client, "u1", MONTH, "plan", addDish);

    expect(performance.now() - start).toBeGreaterThanOrEqual(CAS_RETRY_PAUSE_MS.min - 1);
  });

  it("con cinco choques seguidos, lanza y lo deja en el log", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentWriter(tables, 5) });

    await expect(updatePlanRowCas(fake.client, "u1", MONTH, "plan", addDish)).rejects.toThrow(
      PLAN_CAS_EXHAUSTED_MESSAGE,
    );
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(5);
    expect(tables.monthly_plans![0]!.plan).toEqual({
      dishes: ["IA", "a mano 1", "a mano 2", "a mano 3", "a mano 4", "a mano 5"],
    });
    const line = JSON.parse(String(warn.mock.calls[0]![0]));
    expect(line).toMatchObject({ level: "warn", event: "plan_cas_exhausted", month: MONTH });
  });

  it("si `rebuild` no tiene nada que escribir, no escribe", async () => {
    const fake = createFakeSupabase(seed());
    const out = await updatePlanRowCas(fake.client, "u1", MONTH, "plan", () => null);
    expect(out).toMatchObject({ patch: null, attempts: 1 });
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("sin fila del mes no escribe ni llama a `rebuild`", async () => {
    const fake = createFakeSupabase(seed());
    let called = false;
    const out = await updatePlanRowCas(fake.client, "u1", "2026-10", "plan", () => {
      called = true;
      return { plan: {} };
    });
    expect(out).toEqual({ patch: null, latest: null, attempts: 1 });
    expect(called).toBe(false);
  });

  it("un error de la base de datos se propaga sin reintentar", async () => {
    const fake = createFakeSupabase(seed(), {
      failOn: (op) => (op.op === "update" ? { message: "boom" } : null),
    });
    await expect(updatePlanRowCas(fake.client, "u1", MONTH, "plan", addDish)).rejects.toMatchObject(
      { message: "boom" },
    );
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(1);
  });
});
