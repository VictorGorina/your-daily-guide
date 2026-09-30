import { describe, expect, mock, test } from "bun:test";

import { setFakeAdmin } from "@/test/admin";
import { createFakeSupabase, type FakeRow } from "@/test/fake-supabase";

// La sesión no es lo que se prueba aquí: cualquier petición es de "ana".
// `mock.module` vale para todo el proceso de `bun test`: el doble lleva todos
// los exports del módulo para no romper a otro test que lo importe después.
mock.module("@/lib/api-auth.server", () => ({
  getRequestUserId: async () => "ana",
  supabaseFromRequest: async () => null,
  unauthorized: () => new Response("Unauthorized", { status: 401 }),
}));

const { Route } = await import("./subscribe");

type Handler = (ctx: { request: Request }) => Promise<Response>;
const post = (Route.options as unknown as { server: { handlers: { POST: Handler } } }).server
  .handlers.POST;

const keys = { p256dh: "p".repeat(20), auth: "a".repeat(20) };
const call = (body: unknown) =>
  post({
    request: new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  });

describe("POST /api/push/subscribe (ticket 06)", () => {
  test("Edge (notify.windows.com) ya se puede suscribir", async () => {
    const fake = createFakeSupabase({ push_subscriptions: [] });
    setFakeAdmin(fake.client);
    const response = await call({
      endpoint: "https://wns2-par02p.notify.windows.com/w/?token=abcdefgh",
      keys,
    });
    expect(response.status).toBe(204);
    expect(fake.tables.push_subscriptions).toHaveLength(1);
  });

  test("un host que no es de push, o un cuerpo que no es JSON: 400 y nada guardado", async () => {
    const fake = createFakeSupabase({ push_subscriptions: [] });
    setFakeAdmin(fake.client);
    expect((await call({ endpoint: "https://evil.example/collect", keys })).status).toBe(400);
    expect((await call("no es json")).status).toBe(400);
    expect((await call({ endpoint: 42, keys })).status).toBe(400);
    expect(fake.tables.push_subscriptions).toHaveLength(0);
  });

  test("se quedan las 10 más recientes de la persona; las de otra no se tocan", async () => {
    const old: FakeRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `old${i}`,
      user_id: "ana",
      endpoint: `https://fcm.googleapis.com/fcm/send/old${i}`,
      p256dh: "p",
      auth: "a",
      created_at: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const other: FakeRow = {
      id: "bea1",
      user_id: "bea",
      endpoint: "https://fcm.googleapis.com/fcm/send/bea",
      p256dh: "p",
      auth: "a",
      created_at: "2026-01-01T00:00:00Z",
    };
    const fake = createFakeSupabase({ push_subscriptions: [...old, other] });
    setFakeAdmin(fake.client);
    // El doble no aplica el DEFAULT now() de created_at: la fila nueva queda sin
    // fecha y, por orden de texto, va primero en el orden descendente, como con
    // Postgres. Si el doble cambia cómo ordena lo que falta, revisar esto.
    const response = await call({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys });
    expect(response.status).toBe(204);
    const ana = fake.tables.push_subscriptions.filter((s) => s.user_id === "ana");
    expect(ana).toHaveLength(10);
    // La más antigua (old0) es la que sobra; la nueva y la de Bea siguen.
    expect(ana.map((s) => s.id)).not.toContain("old0");
    expect(ana.some((s) => s.endpoint === "https://fcm.googleapis.com/fcm/send/new")).toBe(true);
    expect(fake.tables.push_subscriptions.some((s) => s.id === "bea1")).toBe(true);
  });
});
