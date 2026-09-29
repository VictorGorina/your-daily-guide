import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeRow } from "@/test/fake-supabase";

import { foodByKey } from "./nutrition";
import { ensureExtraFoods } from "./usda.server";

// Caché de `foods_extra` con caducidad (ticket 17, PERF-09). La caché es del
// módulo: cada test arranca un día después del anterior, así que la del test
// previo ya está caducada. Claves inventadas: el registro es del proceso.

const row = (key: string): FakeRow => ({
  key,
  label: key,
  aliases: [],
  category: "verdura",
  kcal: 30,
  protein_g: 1,
  carbs_g: 5,
  fat_g: 0,
  fiber_g: 2,
});

let day = 0;
const startOfTest = () => new Date(Date.UTC(2030, 0, 1) + ++day * 86_400_000).getTime();
const reads = (fake: ReturnType<typeof createFakeSupabase>) =>
  fake.calls.filter((c) => c.table === "foods_extra" && c.op === "select").length;

afterEach(() => setSystemTime());

describe("ensureExtraFoods", () => {
  it("tras un fallo reintenta a los 30 s, no antes", async () => {
    const t0 = startOfTest();
    let fail = true;
    const fake = createFakeSupabase(
      { foods_extra: [row("zq-usda-reintento")] },
      { failOn: (op) => op.table === "foods_extra" && fail },
    );
    setFakeAdmin(fake.client);

    setSystemTime(t0);
    await ensureExtraFoods();
    expect(foodByKey("zq-usda-reintento")).toBeNull();

    fail = false;
    setSystemTime(t0 + 29_000);
    await ensureExtraFoods();
    expect(reads(fake)).toBe(1);
    expect(foodByKey("zq-usda-reintento")).toBeNull();

    setSystemTime(t0 + 30_000);
    await ensureExtraFoods();
    expect(reads(fake)).toBe(2);
    expect(foodByKey("zq-usda-reintento")?.kcal).toBe(30);
  });

  it("con éxito no relee en 10 min; después llega lo que añadió otra instancia", async () => {
    const t0 = startOfTest();
    const fake = createFakeSupabase({ foods_extra: [row("zq-usda-primera")] });
    setFakeAdmin(fake.client);

    setSystemTime(t0);
    await Promise.all([ensureExtraFoods(), ensureExtraFoods()]);
    expect(reads(fake)).toBe(1);
    expect(foodByKey("zq-usda-primera")).not.toBeNull();

    fake.tables.foods_extra!.push(row("zq-usda-otra-instancia"));
    setSystemTime(t0 + 10 * 60_000 - 1);
    await ensureExtraFoods();
    expect(reads(fake)).toBe(1);
    expect(foodByKey("zq-usda-otra-instancia")).toBeNull();

    setSystemTime(t0 + 10 * 60_000);
    await ensureExtraFoods();
    expect(reads(fake)).toBe(2);
    expect(foodByKey("zq-usda-otra-instancia")).not.toBeNull();
  });
});
