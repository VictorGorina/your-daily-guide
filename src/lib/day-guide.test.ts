import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeTables } from "@/test/fake-supabase";

import { cleanDayGuideInput, DAY_GUIDE_MAX_CHARS, DAY_HABITS_MAX } from "./day-guide";
import { saveDayGuideHandler } from "./day-guide.server";

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const guide = () => ({
  intro: "Hola",
  calories: "2000 kcal",
  macros: "",
  behaviors: ["Bebe agua"],
  mealMacros: [
    {
      moment: "Comida",
      idea: "Lentejas",
      kcal: 500,
      protein_g: 30,
      carbs_g: 60,
      fat_g: 12,
      fiber_g: 9,
      status: "calculado",
    },
  ],
});

describe("cleanDayGuideInput", () => {
  it("sin fecha es hoy, y la guía pasa por las reglas de lectura de la fila", () => {
    const out = cleanDayGuideInput({
      today: TODAY,
      guide: { ...guide(), intro: 7, mealMacros: [...guide().mealMacros, { moment: "Cena" }] },
    });
    expect(out.date).toBe(TODAY);
    expect(out.guide.intro).toBe("");
    // Un plato sin cifras no se guarda como si las tuviera.
    expect(out.guide.mealMacros).toHaveLength(1);
    expect(out).not.toHaveProperty("habits");
  });

  it("acepta un día pasado y rechaza uno que no ha llegado o mal escrito", () => {
    expect(cleanDayGuideInput({ today: TODAY, date: "2026-01-05", guide: guide() }).date).toBe(
      "2026-01-05",
    );
    for (const date of [day(3), "ayer", 20260105, null]) {
      expect(() => cleanDayGuideInput({ today: TODAY, date, guide: guide() })).toThrow();
    }
  });

  it("el `today` del cliente no adelanta el calendario", () => {
    expect(() => cleanDayGuideInput({ today: "2099-01-01", date: day(5), guide: guide() })).toThrow(
      "todavía no ha llegado",
    );
  });

  it("sin guía, o con algo que no es un objeto, no hay nada que guardar", () => {
    for (const bad of [undefined, null, "texto", [guide()]]) {
      expect(() => cleanDayGuideInput({ today: TODAY, guide: bad })).toThrow("Falta la guía");
    }
  });

  it("las comidas, si vienen, se limpian; si no son una lista o son demasiadas, se rechazan", () => {
    const out = cleanDayGuideInput({
      today: TODAY,
      guide: guide(),
      habits: [{ label: "Comida", done: 1, status: "raro" }, { done: true }],
    });
    expect(out.habits).toEqual([{ label: "Comida", done: false }]);
    const many = Array.from({ length: DAY_HABITS_MAX + 1 }, (_, i) => ({ label: `c${i}` }));
    for (const habits of ["Comida", many]) {
      expect(() => cleanDayGuideInput({ today: TODAY, guide: guide(), habits })).toThrow(
        "no son válidas",
      );
    }
  });

  it("una guía desmesurada no se guarda", () => {
    const big = { ...guide(), intro: "a".repeat(DAY_GUIDE_MAX_CHARS) };
    expect(() => cleanDayGuideInput({ today: TODAY, guide: big })).toThrow("demasiado grande");
  });
});

describe("saveDayGuide", () => {
  const seed = (): FakeTables => ({
    daily_logs: [
      {
        id: "l1",
        user_id: "bea",
        log_date: TODAY,
        guide: null,
        habits: [{ label: "Comida", done: false }],
        snacks: { entries: ["chips"] },
        updated_at: "2026-10-01T10:00:00Z",
      },
      {
        id: "l2",
        user_id: "ana",
        log_date: TODAY,
        guide: { intro: "la de Ana" },
        habits: [],
        updated_at: "2026-10-01T10:00:00Z",
      },
    ],
  });
  const save = (userId: string, input: Record<string, unknown>) =>
    saveDayGuideHandler({ data: cleanDayGuideInput(input), context: { userId } });

  it("escribe solo `guide`, y solo en la fila de quien llama", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables);
    setFakeAdmin(fake.client);

    expect(await save("bea", { today: TODAY, guide: guide() })).toEqual({ saved: true });

    const [bea, ana] = tables.daily_logs!;
    expect((bea!.guide as { intro: string }).intro).toBe("Hola");
    expect(bea!.snacks).toEqual({ entries: ["chips"] });
    expect(bea!.habits).toEqual([{ label: "Comida", done: false }]);
    expect(ana!.guide).toEqual({ intro: "la de Ana" });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(Object.keys(update.payload as object)).toEqual(["guide"]);
    for (const call of fake.calls) {
      expect(call.filters).toContainEqual({ kind: "eq", column: "user_id", value: "bea" });
    }
  });

  it("con comidas, van en la misma escritura", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables);
    setFakeAdmin(fake.client);
    await save("bea", {
      today: TODAY,
      guide: guide(),
      habits: [{ label: "Comida", done: false, wasIdea: "Lentejas" }],
    });
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(tables.daily_logs![0]!.habits).toEqual([
      { label: "Comida", done: false, wasIdea: "Lentejas" },
    ]);
  });

  it("un día sin fila no se crea", async () => {
    const fake = createFakeSupabase(seed());
    setFakeAdmin(fake.client);
    expect(await save("bea", { today: TODAY, date: "2026-01-05", guide: guide() })).toEqual({
      saved: false,
    });
    expect(fake.calls.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
  });
});
