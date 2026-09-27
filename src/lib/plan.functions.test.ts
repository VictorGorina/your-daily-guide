import { describe, expect, it, spyOn } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeOp, type FakeTables } from "@/test/fake-supabase";

import type { ShoppingList } from "./plan-shared";
import { toggleShoppingOwnedHandler } from "./shopping/state.server";

const MONTH = "2026-10";

const item = (name: string, ownedTrips?: Record<number, "fridge" | "store">) => ({
  name,
  qty: "1 kg",
  price_eur: 2,
  trip: 0,
  perishable: false,
  unit: "g" as const,
  weekQty: [250, 250, 250, 250],
  weekPrice: [0.5, 0.5, 0.5, 0.5],
  ...(ownedTrips ? { ownedTrips } : {}),
});

const list = (): ShoppingList => [
  { category: "Verdura", items: [item("Tomate"), item("Cebolla")] },
];

// Ana planifica y Bea no: la lista de la casa vive en la fila de Ana.
const seed = (): FakeTables => ({
  household_members: [
    { household_id: "h1", user_id: "ana", is_planner: true },
    { household_id: "h1", user_id: "bea", is_planner: false },
  ],
  monthly_plans: [
    {
      user_id: "ana",
      month: MONTH,
      plan: { weeks: [] },
      shopping: list(),
      updated_at: "2026-09-26T10:00:00Z",
    },
  ],
});

const shoppingOf = (tables: FakeTables) => tables.monthly_plans![0]!.shopping as ShoppingList;

/** Otra marca que llega entre la lectura y la escritura de la primera. */
const concurrentMark = (tables: FakeTables) => {
  let done = false;
  return (op: FakeOp) => {
    if (done || op.table !== "monthly_plans" || op.op !== "update") return null;
    done = true;
    const row = tables.monthly_plans![0]!;
    const shopping = structuredClone(row.shopping) as ShoppingList;
    shopping[0]!.items[1]!.ownedTrips = { 0: "fridge" };
    row.shopping = shopping;
    row.updated_at = "2026-09-26T10:00:05Z";
    return null;
  };
};

const mark = (userId: string, client: unknown, itemName = "Tomate") =>
  toggleShoppingOwnedHandler({
    data: { month: MONTH, itemName, trip: 0, source: "store" },
    context: { supabase: client, userId },
  });

describe("toggleShoppingOwned (ticket 21)", () => {
  it("dos marcas a la vez en la propia lista: se conservan las dos", async () => {
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentMark(tables) });
    setFakeAdmin(createFakeSupabase().client); // la propia fila no pasa por aquí

    const out = await mark("ana", fake.client);

    const items = shoppingOf(tables)[0]!.items;
    expect(items[0]!.ownedTrips).toEqual({ 0: "store" });
    expect(items[1]!.ownedTrips).toEqual({ 0: "fridge" });
    expect(out.shopping).toEqual(shoppingOf(tables));
  });

  it("un miembro que no planifica marca la lista de la casa con la clave de servicio", async () => {
    // Una sola BD: la sesión de Bea y `supabaseAdmin` ven las mismas tablas.
    const tables = seed();
    const fake = createFakeSupabase(tables, { failOn: concurrentMark(tables) });
    setFakeAdmin(fake.client);

    await mark("bea", fake.client);

    const items = shoppingOf(tables)[0]!.items;
    expect(items[0]!.ownedTrips).toEqual({ 0: "store" });
    expect(items[1]!.ownedTrips).toEqual({ 0: "fridge" });
    // Solo escribe el estado de compra, y en la fila de Ana.
    const updates = fake.calls.filter((c) => c.op === "update");
    expect(updates.every((u) => Object.keys(u.payload as object).join() === "shopping")).toBe(true);
    expect(updates.at(-1)!.filters).toContainEqual({ kind: "eq", column: "user_id", value: "ana" });
  });

  it("sin lista del mes, avisa en vez de escribir", async () => {
    const fake = createFakeSupabase({ household_members: [], monthly_plans: [] });
    setFakeAdmin(createFakeSupabase().client);
    const error = spyOn(console, "error").mockImplementation(() => {});
    await expect(mark("ana", fake.client)).rejects.toThrow(
      "Todavía no hay lista de la compra este mes",
    );
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
    error.mockRestore();
  });
});
