import { describe, expect, it } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase } from "@/test/fake-supabase";

import { deleteAccountHandler } from "./account.server";

describe("deleteAccount", () => {
  it("borra en Auth el usuario de la sesión y después sus cuotas", async () => {
    const fake = createFakeSupabase({
      rate_limits: [
        { subject: "user:u-sesion", bucket: "chat" },
        { subject: "user:otra", bucket: "chat" },
      ],
    });
    setFakeAdmin(fake.client);
    expect(await deleteAccountHandler({ context: { userId: "u-sesion" } })).toEqual({ ok: true });
    expect(fake.calls.map((c) => c.op)).toEqual(["auth.deleteUser", "delete"]);
    // `rate_limits` no tiene user_id (no cae en cascada): se borra por su subject.
    expect(fake.tables.rate_limits).toEqual([{ subject: "user:otra", bucket: "chat" }]);
  });

  it("si no se pueden borrar las cuotas, la cuenta ya está borrada: no lanza", async () => {
    const fake = createFakeSupabase(
      { rate_limits: [] },
      { failOn: (op) => op.table === "rate_limits" },
    );
    setFakeAdmin(fake.client);
    expect(await deleteAccountHandler({ context: { userId: "u" } })).toEqual({ ok: true });
  });

  it("nunca con un id que mande el cliente", async () => {
    const fake = createFakeSupabase();
    setFakeAdmin(fake.client);
    await deleteAccountHandler({
      data: { userId: "otra-persona" },
      context: { userId: "u-sesion" },
    } as never);
    expect(fake.calls[0]?.payload).toBe("u-sesion");
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
