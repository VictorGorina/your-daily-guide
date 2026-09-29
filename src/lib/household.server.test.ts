import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOptions, type FakeTables } from "@/test/fake-supabase";

import {
  householdContext,
  householdMealTargets,
  householdPlannerId,
  sharedMealPortionsByDate,
  syncSharedMeals,
} from "./household.server";
import type { MonthlyPlan } from "./plan-shared";

// Tres hogares en las mismas tablas. En producción la RLS solo deja ver las
// filas del propio hogar; el doble no tiene RLS y devuelve todas, así que estos
// tests fijan además que el código se queda con las de su hogar por su cuenta.
const everyDay = [0, 1, 2, 3, 4, 5, 6];
const seed = (): FakeTables => ({
  household_members: [
    // h1: Ana planifica, Bea tiene cuenta y no planifica, la abuela no tiene app.
    {
      household_id: "h1",
      user_id: "ana",
      display_name: "Ana",
      uses_app: true,
      is_planner: true,
      portion: 1,
      home_schedule: null,
    },
    {
      household_id: "h1",
      user_id: "bea",
      display_name: "Bea",
      uses_app: true,
      is_planner: false,
      portion: "1", // `numeric` llega como texto
      home_schedule: null,
    },
    {
      household_id: "h1",
      user_id: null,
      display_name: "Abuela",
      uses_app: false,
      is_planner: false,
      portion: 0.8,
      home_schedule: null,
    },
    // h2: Carlos, solo.
    {
      household_id: "h2",
      user_id: "carlos",
      display_name: "Carlos",
      uses_app: true,
      is_planner: true,
      portion: 1.2,
      home_schedule: null,
    },
    // h3: el hueco de quien planifica sigue sin reclamar.
    {
      household_id: "h3",
      user_id: null,
      display_name: "Dani",
      uses_app: true,
      is_planner: true,
      portion: 1,
      home_schedule: null,
    },
    {
      household_id: "h3",
      user_id: "eva",
      display_name: "Eva",
      uses_app: true,
      is_planner: false,
      portion: 1,
      home_schedule: null,
    },
  ],
  households: [
    { id: "h1", shared_slots: { desayuno: [], comida: everyDay, cena: [5, 6] } },
    { id: "h2", shared_slots: { desayuno: [], comida: [], cena: [] } },
    { id: "h3", shared_slots: { desayuno: [], comida: [], cena: [] } },
  ],
  household_children: [
    {
      household_id: "h1",
      id: "leo",
      name: "Leo",
      age: 6,
      allergies: "frutos secos",
      appetite: null,
      notes: "no le gusta el pescado",
      portion: 0.5,
      home_schedule: null,
      feeding_stage: "mesa",
    },
    {
      household_id: "h1",
      id: "mia",
      name: "Mía",
      age: 0,
      allergies: null,
      appetite: null,
      notes: null,
      portion: 0.3,
      home_schedule: null,
      feeding_stage: "triturados",
    },
    {
      household_id: "h2",
      id: "otro",
      name: "Otro",
      age: 9,
      allergies: null,
      appetite: null,
      notes: null,
      portion: 0.6,
      home_schedule: null,
      feeding_stage: "mesa",
    },
  ],
});

const contextFor = (userId: string, opts?: FakeOptions) => {
  const fake = createFakeSupabase(seed(), opts);
  return { fake, run: () => householdContext(fake.client, userId) };
};

describe("householdContext", () => {
  it("sin hogar: el contexto vacío", async () => {
    const ctx = await contextFor("nadie").run();
    expect(ctx.householdId).toBeNull();
    expect(ctx.plannerId).toBeNull();
    expect(ctx.members).toEqual([]);
    expect(ctx.text).toBe("Vive sin hogar compartido configurado.");
  });

  it("solo los miembros y los niños de su hogar", async () => {
    const { fake, run } = contextFor("bea");
    const ctx = await run();
    expect(ctx.householdId).toBe("h1");
    expect(ctx.plannerId).toBe("ana");
    expect(ctx.members.map((m) => m.displayName)).toEqual(["Ana", "Bea", "Abuela"]);
    expect(ctx.members[1]?.portion).toBe(1);
    expect(ctx.children.map((c) => c.name)).toEqual(["Leo", "Mía"]);
    // Los niños se piden ya filtrados por hogar en la consulta.
    const kidsQuery = fake.calls.find((c) => c.table === "household_children");
    expect(kidsQuery?.filters).toEqual([{ kind: "eq", column: "household_id", value: "h1" }]);
    // Y los miembros también: su fila por `user_id`, el resto por hogar (PERF-05).
    const memberQueries = fake.calls.filter((c) => c.table === "household_members");
    expect(memberQueries.map((c) => c.filters)).toEqual([
      [{ kind: "eq", column: "user_id", value: "bea" }],
      [{ kind: "eq", column: "household_id", value: "h1" }],
    ]);
  });

  it("sin horarios individuales, las comidas compartidas son las heredadas del hogar", async () => {
    const ctx = await contextFor("ana").run();
    expect(ctx.sharedSlots).toEqual({ desayuno: [], comida: everyDay, cena: [5, 6] });
  });

  it("raciones: adultos + niños que comen de la mesa; el bebé de triturados no suma", async () => {
    const ctx = await contextFor("ana").run();
    // 1 (Ana) + 1 (Bea) + 0,8 (Abuela) + 0,5 (Leo). Mía (triturados) va aparte.
    expect(ctx.servings).toEqual({
      shared: { desayuno: 0, comida: 3.3, cena: 3.3 },
      plannerSolo: 1,
    });
  });

  it("el texto para el coach lleva la mesa, los niños y sus notas", async () => {
    const ctx = await contextFor("ana").run();
    expect(ctx.text).toContain("«Leo»: «no le gusta el pescado»");
    expect(ctx.text).toContain("«Mía» (triturados");
    expect(ctx.text).toContain("solo lo cambia «Ana»");
  });

  it("un hogar sin quien planifica con cuenta: plannerId null", async () => {
    const ctx = await contextFor("eva").run();
    expect(ctx.householdId).toBe("h3");
    expect(ctx.plannerId).toBeNull();
  });

  it("si falta una columna opcional (migración sin aplicar), reintenta sin ella en vez de vaciar el contexto", async () => {
    const missing = (column: string) => ({
      code: "42703",
      message: `column ${column} does not exist`,
    });
    const { fake, run } = contextFor("bea", {
      failOn: (op) =>
        op.columns.includes("feeding_stage")
          ? missing("feeding_stage")
          : op.table === "household_members" && op.columns.includes("home_schedule")
            ? missing("home_schedule")
            : null,
    });
    const ctx = await run();
    expect(ctx.members.map((m) => m.displayName)).toEqual(["Ana", "Bea", "Abuela"]);
    // Sin `feeding_stage`, todos los niños cuentan como `mesa` (el default).
    expect(ctx.children.map((c) => c.stage)).toEqual(["mesa", "mesa"]);
    // De más a menos columnas: [home_schedule, feeding_stage] → [home_schedule].
    const kidsColumns = fake.calls
      .filter((c) => c.table === "household_children")
      .map((c) => c.columns.slice(7));
    expect(kidsColumns).toEqual([["home_schedule", "feeding_stage"], ["home_schedule"]]);
  });
});

describe("householdPlannerId", () => {
  const plannerOf = (userId: string) => {
    const fake = createFakeSupabase(seed());
    return { fake, run: () => householdPlannerId(fake.client, userId) };
  };

  it("un miembro que no planifica recibe a quien planifica en su hogar", async () => {
    expect(await plannerOf("bea").run()).toBe("ana");
  });

  it("quien planifica, y quien vive solo, se reciben a sí mismos", async () => {
    expect(await plannerOf("ana").run()).toBe("ana");
    expect(await plannerOf("carlos").run()).toBe("carlos");
  });

  it("sin hogar, o con el hueco de quien planifica sin reclamar: null", async () => {
    expect(await plannerOf("nadie").run()).toBeNull();
    expect(await plannerOf("eva").run()).toBeNull();
  });

  it("lee su fila y después solo las de su hogar, nunca la tabla entera (PERF-05)", async () => {
    const { fake, run } = plannerOf("bea");
    await run();
    expect(fake.calls.map((c) => [c.table, c.filters])).toEqual([
      ["household_members", [{ kind: "eq", column: "user_id", value: "bea" }]],
      ["household_members", [{ kind: "eq", column: "household_id", value: "h1" }]],
    ]);
  });

  it("sin hogar, una sola consulta", async () => {
    const { fake, run } = plannerOf("nadie");
    await run();
    expect(fake.calls).toHaveLength(1);
  });
});

describe("syncSharedMeals", () => {
  // Octubre entero es futuro respecto al 26 de septiembre: se copian todas las
  // celdas compartidas (en h1, la comida todos los días y la cena sáb/dom).
  const MONTH = "2026-10";
  const TODAY = "2026-09-26";
  const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const planOf = (who: string): MonthlyPlan => ({
    intro: who,
    focus: [],
    weeks: [
      {
        label: "Semana 1",
        focus: "",
        breakfasts: ["Avena"],
        snacks: ["Fruta"],
        days: DAYS.map((day, di) => ({
          day,
          lunch: `Comida ${who} ${di}`,
          dinner: `Cena ${who} ${di}`,
        })),
      },
    ],
  });
  const withPlans = (bea: Record<string, unknown> = {}): FakeTables => ({
    ...seed(),
    monthly_plans: [
      { user_id: "ana", month: MONTH, plan: planOf("Ana"), updated_at: "2026-09-26T10:00:00Z" },
      {
        user_id: "bea",
        month: MONTH,
        plan: planOf("Bea"),
        confirmed_at: null,
        updated_at: "2026-09-26T10:00:00Z",
        ...bea,
      },
    ],
  });
  const beaPlan = (tables: FakeTables) =>
    tables.monthly_plans!.find((r) => r.user_id === "bea")!.plan as MonthlyPlan;

  it("copia al miembro los platos compartidos y deja los suyos", async () => {
    const fake = createFakeSupabase(withPlans());
    setFakeAdmin(fake.client);
    const out = await syncSharedMeals({
      supabase: fake.client,
      userId: "ana",
      month: MONTH,
      today: TODAY,
    });

    expect(out).toEqual({ synced: 1 });
    const days = beaPlan(fake.tables).weeks[0]!.days;
    expect(days[2]!.lunch).toBe("Comida Ana 2");
    expect(days[2]!.dinner).toBe("Cena Bea 2"); // cena del miércoles: no se comparte
    expect(days[5]!.dinner).toBe("Cena Ana 5");
  });

  it("si el miembro cambia una comida suya a mitad, se reconstruye sobre su versión", async () => {
    const tables = withPlans();
    let raced = false;
    const fake = createFakeSupabase(tables, {
      failOn: (op) => {
        if (raced || op.table !== "monthly_plans" || op.op !== "update") return null;
        raced = true;
        const row = tables.monthly_plans!.find((r) => r.user_id === "bea")!;
        const plan = structuredClone(row.plan) as MonthlyPlan;
        plan.weeks[0]!.days[2]!.dinner = "Tortilla que puso Bea";
        plan.weeks[0]!.days[2]!.pinned = ["cena"];
        row.plan = plan;
        row.updated_at = "2026-09-26T10:00:05Z";
        return null;
      },
    });
    setFakeAdmin(fake.client);
    const out = await syncSharedMeals({
      supabase: fake.client,
      userId: "ana",
      month: MONTH,
      today: TODAY,
    });

    expect(out).toEqual({ synced: 1 });
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(2);
    const day = beaPlan(tables).weeks[0]!.days[2]!;
    expect(day.dinner).toBe("Tortilla que puso Bea");
    expect(day.pinned).toEqual(["cena"]);
    expect(day.lunch).toBe("Comida Ana 2");
  });

  it("un plan ya confirmado no se toca", async () => {
    const fake = createFakeSupabase(withPlans({ confirmed_at: "2026-09-20T10:00:00Z" }));
    setFakeAdmin(fake.client);
    const out = await syncSharedMeals({
      supabase: fake.client,
      userId: "ana",
      month: MONTH,
      today: TODAY,
    });
    expect(out).toEqual({ synced: 0 });
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });
});

describe("con el hogar ya leído (ticket 17, PERF-10)", () => {
  // Dos adultos con cuenta en h1, con datos de sobra para `energyTargets`.
  const adult = (id: string, sex: string, weight: number) => ({
    id,
    sex,
    age: 35,
    height_cm: 170,
    current_weight_kg: weight,
    daily_activity: "sentado",
  });
  const withProfiles = (): FakeTables => ({
    ...seed(),
    profiles: [adult("ana", "mujer", 62), adult("bea", "hombre", 80)],
  });
  const memberReads = (fake: ReturnType<typeof createFakeSupabase>) =>
    fake.calls.filter((c) => c.table === "household_members").length;

  it("householdMealTargets: mismo resultado y ninguna lectura más del hogar", async () => {
    const fresh = createFakeSupabase(withProfiles());
    setFakeAdmin(fresh.client);
    const before = await householdMealTargets(fresh.client, "ana");
    expect(before.comida?.kcal).toBeGreaterThan(0);

    const reuse = createFakeSupabase(withProfiles());
    setFakeAdmin(reuse.client);
    const home = await householdContext(reuse.client, "ana");
    const readsForContext = memberReads(reuse);
    expect(await householdMealTargets(reuse.client, "ana", home)).toEqual(before);
    expect(memberReads(reuse)).toBe(readsForContext);
  });

  it("sharedMealPortionsByDate: mismo resultado y ninguna lectura más del hogar", async () => {
    const saturday = "2026-10-03";
    const fresh = createFakeSupabase(withProfiles());
    setFakeAdmin(fresh.client);
    const before = (await sharedMealPortionsByDate(fresh.client, "ana"))(saturday);
    expect(before.cena?.factor).toBeGreaterThan(0);

    const reuse = createFakeSupabase(withProfiles());
    setFakeAdmin(reuse.client);
    const home = await householdContext(reuse.client, "ana");
    const readsForContext = memberReads(reuse);
    expect((await sharedMealPortionsByDate(reuse.client, "ana", home))(saturday)).toEqual(before);
    expect(memberReads(reuse)).toBe(readsForContext);
  });
});
