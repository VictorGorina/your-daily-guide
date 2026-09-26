import { describe, expect, it } from "bun:test";

import { createFakeSupabase, type FakeOptions, type FakeTables } from "@/test/fake-supabase";

import { householdContext, householdPlannerId } from "./household.server";

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
    expect(ctx.text).toContain("Leo: no le gusta el pescado");
    expect(ctx.text).toContain("Mía (triturados");
    expect(ctx.text).toContain("solo lo cambia Ana");
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

  it("es una sola consulta a household_members", async () => {
    const { fake, run } = plannerOf("bea");
    await run();
    expect(fake.calls.map((c) => [c.table, c.op])).toEqual([["household_members", "select"]]);
  });
});
