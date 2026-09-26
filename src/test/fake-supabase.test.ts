import { describe, expect, it } from "bun:test";

import { testAdmin, useFakeAdmin } from "./admin";
import { createFakeSupabase, type FakeTables } from "./fake-supabase";

// El doble es la base de los tests de servidor: si miente, mienten todos.
// Cada operación se prueba contra lo que haría PostgREST.

const seed = (): FakeTables => ({
  members: [
    { id: "m1", household_id: "h1", user_id: "u1", is_planner: true, portion: 1 },
    { id: "m2", household_id: "h1", user_id: null, is_planner: false, portion: 0.5 },
    { id: "m3", household_id: "h2", user_id: "u3", is_planner: true, portion: 1.2 },
  ],
  plans: [
    { user_id: "u1", month: "2026-09", plan: { a: 1 }, updated_at: "2026-09-01T00:00:00.000Z" },
    { user_id: "u1", month: "2026-10", plan: { a: 2 }, updated_at: "2026-09-01T00:00:00.000Z" },
  ],
});

type Row = Record<string, unknown>;

describe("select", () => {
  it("proyecta solo las columnas pedidas, como PostgREST", async () => {
    const { db } = createFakeSupabase(seed());
    const { data } = await db.from("members").select("user_id, is_planner").eq("id", "m1");
    expect(data).toEqual([{ user_id: "u1", is_planner: true }]);
  });

  it("`*`, un alias y un embebido", async () => {
    const { db } = createFakeSupabase(seed());
    const all = await db.from("members").select("*").eq("id", "m2");
    expect((all.data as Row[])[0]).toEqual(seed().members[1]);
    const alias = await db.from("members").select("who:user_id").eq("id", "m1");
    expect(alias.data).toEqual([{ who: "u1" }]);
    const embedded = await db.from("members").select("id, households(name)").eq("id", "m1");
    expect((embedded.data as Row[])[0]).toEqual(seed().members[0]);
  });

  it("filtros: eq, neq, in, is, gt(e), lt(e), not, or, match, filter", async () => {
    const { db } = createFakeSupabase(seed());
    const ids = async (q: PromiseLike<{ data: unknown }>) =>
      ((await q).data as Row[]).map((r) => r.id);
    const members = () => db.from("members").select("id");
    expect(await ids(members().eq("household_id", "h1"))).toEqual(["m1", "m2"]);
    // neq, como en SQL, no casa con NULL.
    expect(await ids(members().neq("user_id", "u1"))).toEqual(["m3"]);
    expect(await ids(members().in("user_id", ["u1", "u3"]))).toEqual(["m1", "m3"]);
    expect(await ids(members().is("user_id", null))).toEqual(["m2"]);
    expect(await ids(members().gte("portion", 1))).toEqual(["m1", "m3"]);
    expect(await ids(members().gt("portion", 1))).toEqual(["m3"]);
    expect(await ids(members().lt("portion", 1))).toEqual(["m2"]);
    expect(await ids(members().lte("portion", 1))).toEqual(["m1", "m2"]);
    expect(await ids(members().not("user_id", "is", null))).toEqual(["m1", "m3"]);
    expect(await ids(members().or("user_id.is.null,household_id.eq.h2"))).toEqual(["m2", "m3"]);
    expect(await ids(members().match({ household_id: "h1", is_planner: true }))).toEqual(["m1"]);
    expect(await ids(members().filter("user_id", "in", "(u3)"))).toEqual(["m3"]);
  });

  it("order, limit y range", async () => {
    const { db } = createFakeSupabase(seed());
    const byPortion = await db
      .from("members")
      .select("id")
      .order("portion", { ascending: false })
      .limit(2);
    expect(byPortion.data).toEqual([{ id: "m3" }, { id: "m1" }]);
    const page = await db.from("members").select("id").order("id").range(1, 2);
    expect(page.data).toEqual([{ id: "m2" }, { id: "m3" }]);
  });

  it("single y maybeSingle devuelven el PGRST116 de verdad", async () => {
    const { db } = createFakeSupabase(seed());
    const one = await db.from("members").select("id").eq("id", "m1").single();
    expect(one).toMatchObject({ data: { id: "m1" }, error: null });
    const none = await db.from("members").select("id").eq("id", "zz").single();
    expect(none.error?.code).toBe("PGRST116");
    const maybeNone = await db.from("members").select("id").eq("id", "zz").maybeSingle();
    expect(maybeNone).toMatchObject({ data: null, error: null });
    // Dos filas en un maybeSingle: lo que provoca la policy del hogar (CLAUDE.md, RLS).
    const two = await db.from("plans").select("month").eq("user_id", "u1").maybeSingle();
    expect(two.error?.code).toBe("PGRST116");
  });

  it("count exacto con head", async () => {
    const { db } = createFakeSupabase(seed());
    const res = await db
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("household_id", "h1");
    expect(res.count).toBe(2);
    expect(res.data).toBeNull();
  });

  it("una tabla que no existe en el seed se lee vacía", async () => {
    const { db } = createFakeSupabase({});
    expect((await db.from("nada").select("id")).data).toEqual([]);
  });
});

describe("escrituras", () => {
  it("insert añade y, con select, devuelve lo insertado", async () => {
    const { db, tables } = createFakeSupabase(seed());
    const res = await db
      .from("members")
      .insert({ id: "m4", household_id: "h2", user_id: "u4" })
      .select("id")
      .single();
    expect(res.data).toEqual({ id: "m4" });
    expect(tables.members).toHaveLength(4);
  });

  it("update solo toca las filas filtradas y avanza updated_at", async () => {
    const { db, tables } = createFakeSupabase(seed());
    const before = tables.plans[0].updated_at as string;
    const res = await db
      .from("plans")
      .update({ plan: { a: 9 } })
      .eq("user_id", "u1")
      .eq("month", "2026-09")
      .select("plan, updated_at");
    const rows = res.data as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0].plan).toEqual({ a: 9 });
    expect((rows[0].updated_at as string) > before).toBe(true);
    expect(tables.plans[1].plan).toEqual({ a: 2 });
  });

  it("updated_at es estrictamente creciente aunque dos escrituras caigan en el mismo ms", async () => {
    const { db, tables } = createFakeSupabase(seed());
    await db.from("plans").update({ x: 1 }).eq("month", "2026-09");
    const first = tables.plans[0].updated_at as string;
    await db.from("plans").update({ x: 2 }).eq("month", "2026-09");
    expect((tables.plans[0].updated_at as string) > first).toBe(true);
  });

  it("un CAS por updated_at deja fuera a la segunda escritura", async () => {
    const { db } = createFakeSupabase(seed());
    const read = "2026-09-01T00:00:00.000Z";
    const cas = () =>
      db
        .from("plans")
        .update({ plan: {} })
        .eq("month", "2026-09")
        .eq("updated_at", read)
        .select("month");
    expect(((await cas()).data as Row[]).length).toBe(1);
    expect(((await cas()).data as Row[]).length).toBe(0);
  });

  it("sin select, una escritura devuelve data null", async () => {
    const { db } = createFakeSupabase(seed());
    const res = await db.from("members").update({ portion: 2 }).eq("id", "m1");
    expect(res).toMatchObject({ data: null, error: null });
  });

  it("upsert con onConflict funde o inserta; ignoreDuplicates no pisa", async () => {
    const { db, tables } = createFakeSupabase(seed());
    await db.from("plans").upsert(
      [
        { user_id: "u1", month: "2026-09", plan: { a: 7 } },
        { user_id: "u2", month: "2026-09", plan: { a: 8 } },
      ],
      { onConflict: "user_id,month" },
    );
    expect(tables.plans).toHaveLength(3);
    expect(tables.plans[0].plan).toEqual({ a: 7 });
    await db.from("plans").upsert(
      { user_id: "u2", month: "2026-09", plan: { a: 0 } },
      {
        onConflict: "user_id,month",
        ignoreDuplicates: true,
      },
    );
    expect(tables.plans[2].plan).toEqual({ a: 8 });
  });

  it("delete quita las filas filtradas", async () => {
    const { db, tables } = createFakeSupabase(seed());
    await db.from("members").delete().eq("household_id", "h1");
    expect(tables.members.map((r) => r.id)).toEqual(["m3"]);
  });
});

describe("rpc, auth y registro", () => {
  it("rpc llama al manejador; sin manejador, error", async () => {
    const { db } = createFakeSupabase(
      {},
      { rpc: { sumar: (args) => (args.a as number) + (args.b as number) } },
    );
    expect(await db.rpc("sumar", { a: 1, b: 2 })).toMatchObject({
      data: 3,
      error: null,
    });
    const missing = await db.rpc("otra");
    expect(missing.error?.code).toBe("PGRST202");
  });

  it("auth.admin.deleteUser queda en el registro con el id", async () => {
    const { db, calls } = createFakeSupabase();
    await db.auth.admin.deleteUser("u9");
    expect(calls).toEqual([
      { table: "auth.users", op: "auth.deleteUser", columns: [], filters: [], payload: "u9" },
    ]);
  });

  it("calls registra tabla, operación, columnas, filtros y payload", async () => {
    const { db, calls } = createFakeSupabase(seed());
    await db.from("members").select("id").eq("household_id", "h1");
    await db.from("members").update({ portion: 3 }).in("id", ["m1"]);
    expect(calls).toEqual([
      {
        table: "members",
        op: "select",
        columns: ["id"],
        filters: [{ kind: "eq", column: "household_id", value: "h1" }],
      },
      {
        table: "members",
        op: "update",
        columns: [],
        filters: [{ kind: "in", column: "id", value: ["m1"] }],
        payload: { portion: 3 },
      },
    ]);
  });

  it("failOn devuelve el error en la operación que cumple la condición", async () => {
    const { db, tables } = createFakeSupabase(seed(), {
      failOn: (op) =>
        op.columns.includes("feeding_stage")
          ? { code: "42703", message: "no existe" }
          : op.op === "delete",
    });
    const missingColumn = await db.from("members").select("id, feeding_stage");
    expect(missingColumn.error?.code).toBe("42703");
    expect((await db.from("members").select("id")).error).toBeNull();
    const del = await db.from("members").delete().eq("id", "m1");
    expect(del.error?.message).toContain("fallo forzado");
    expect(tables.members).toHaveLength(3);
  });
});

describe("supabaseAdmin en los tests", () => {
  it("sin useFakeAdmin, tocarlo lanza (nunca llega a producción)", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    expect(() => supabaseAdmin.from("profiles")).toThrow("useFakeAdmin");
    expect(testAdmin).toBe(supabaseAdmin as object);
  });

  it("con useFakeAdmin, lee del doble", async () => {
    const fake = createFakeSupabase(seed());
    useFakeAdmin(fake.client);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as unknown as typeof fake.db)
      .from("members")
      .select("id")
      .eq("id", "m3");
    expect(data).toEqual([{ id: "m3" }]);
  });
});
