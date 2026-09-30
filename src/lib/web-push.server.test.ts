import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import { sendPushNotification } from "./web-push.server";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

let keys: { p256dh: string; auth: string };
const previousVapid = process.env.VAPID_PRIVATE_KEY;
const payload = { title: "t", body: "b", url: "/hoy" };

beforeAll(async () => {
  // Clave VAPID y suscripción de verdad (P-256), para que `buildPushHTTPRequest`
  // llegue a construir la petición y el test alcance el `fetch`.
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ]);
  process.env.VAPID_PRIVATE_KEY = JSON.stringify(
    await crypto.subtle.exportKey("jwk", vapid.privateKey),
  );
  const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  keys = {
    p256dh: b64url(await crypto.subtle.exportKey("raw", client.publicKey)),
    auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
});

afterAll(() => {
  if (previousVapid === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = previousVapid;
});

let fetchSpy: ReturnType<typeof spyOn>;
let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  fetchSpy?.mockRestore();
  warn.mockRestore();
});

describe("sendPushNotification (ticket 06)", () => {
  test("un endpoint que no es de un servicio de push no se pide: gone, para que se borre", async () => {
    fetchSpy = spyOn(globalThis, "fetch");
    const result = await sendPushNotification(
      { endpoint: "https://evil.example/collect", keys },
      payload,
    );
    expect(result).toBe("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("con un servicio de push válido sí se pide, con un tiempo máximo", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    const result = await sendPushNotification(
      { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys },
      payload,
    );
    expect(result).toBe("sent");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("tiempo agotado o red caída: failed (la suscripción se conserva) y push_timeout", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const result = await sendPushNotification(
      { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys },
      payload,
    );
    expect(result).toBe("failed");
    const events = warn.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])).event);
    expect(events).toContain("push_timeout");
  });
});
