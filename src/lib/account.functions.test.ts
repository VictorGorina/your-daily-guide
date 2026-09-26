import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase } from "@/test/fake-supabase";

import { deleteAccountHandler } from "./account.functions";

describe("deleteAccount", () => {
  it("borra en Auth el usuario de la sesión", async () => {
    const fake = createFakeSupabase();
    setFakeAdmin(fake.client);
    expect(await deleteAccountHandler({ context: { userId: "u-sesion" } })).toEqual({ ok: true });
    expect(fake.calls.map((c) => [c.op, c.payload])).toEqual([["auth.deleteUser", "u-sesion"]]);
  });

  it("nunca con un id que mande el cliente", async () => {
    const fake = createFakeSupabase();
    setFakeAdmin(fake.client);
    await deleteAccountHandler({
      data: { userId: "otra-persona" },
      context: { userId: "u-sesion" },
    } as never);
    expect(fake.calls.map((c) => c.payload)).toEqual(["u-sesion"]);
  });

  it("si Auth falla, lanza con su mensaje", async () => {
    const fake = createFakeSupabase(
      {},
      { failOn: (op) => (op.op === "auth.deleteUser" ? { message: "User not found" } : null) },
    );
    setFakeAdmin(fake.client);
    await expect(deleteAccountHandler({ context: { userId: "u" } })).rejects.toThrow(
      "User not found",
    );
  });
});
