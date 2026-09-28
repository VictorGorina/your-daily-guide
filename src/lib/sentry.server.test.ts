import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import {
  buildEnvelope,
  captureServerEvent,
  captureServerException,
  parseDsn,
  stackFrames,
} from "./sentry.server";

describe("parseDsn", () => {
  it("saca la clave y la URL del envelope", () => {
    expect(parseDsn("https://abc123@o1.ingest.de.sentry.io/4507")).toEqual({
      key: "abc123",
      envelopeUrl: "https://o1.ingest.de.sentry.io/api/4507/envelope/",
    });
  });

  it("sin DSN, o uno roto, no hay destino", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("no es una url")).toBeNull();
    expect(parseDsn("https://o1.ingest.de.sentry.io/4507")).toBeNull();
  });
});

describe("stackFrames", () => {
  it("convierte la traza de V8 en frames, del más antiguo al más reciente", () => {
    const stack = [
      "Error: boom",
      "    at guardar (/var/task/chunks/plan.mjs:10:5)",
      "    at async handler (/var/task/chunks/api.mjs:20:7)",
      "    at /var/task/index.mjs:3:1",
    ].join("\n");
    expect(stackFrames(stack)).toEqual([
      { filename: "/var/task/index.mjs", lineno: 3, colno: 1 },
      { function: "async handler", filename: "/var/task/chunks/api.mjs", lineno: 20, colno: 7 },
      { function: "guardar", filename: "/var/task/chunks/plan.mjs", lineno: 10, colno: 5 },
    ]);
  });
});

describe("buildEnvelope", () => {
  it("tres líneas JSON: cabecera, item y evento", () => {
    const lines = buildEnvelope({ event_id: "e1", message: "x" }).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).event_id).toBe("e1");
    expect(JSON.parse(lines[1]!)).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]!).message).toBe("x");
  });
});

describe("envío", () => {
  const original = process.env.SENTRY_DSN;
  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
  });

  it("sin SENTRY_DSN no llama a nadie", () => {
    delete process.env.SENTRY_DSN;
    const fetchSpy = spyOn(globalThis, "fetch");
    captureServerException(new Error("boom"));
    captureServerEvent("error", "rate_limit_failopen", {});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("con DSN manda el evento ya limpio", async () => {
    process.env.SENTRY_DSN = "https://abc123@o1.ingest.de.sentry.io/4507";
    const fetchMock = mock(async () => new Response("{}"));
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchMock as never);
    captureServerEvent("error", "email_send_failed", {
      userId: "u-1",
      email: "ana@example.com",
      status: 422,
    });
    captureServerException(new Error("choque con ana@example.com"), { where: "apiPost" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.de.sentry.io/api/4507/envelope/");
    expect((init.headers as Record<string, string>)["x-sentry-auth"]).toContain(
      "sentry_key=abc123",
    );
    const bodies = fetchMock.mock.calls.map((c) =>
      String((c as unknown as [string, RequestInit])[1].body),
    );
    expect(bodies.join("")).not.toContain("ana@example.com");
    const event = JSON.parse(bodies[0]!.split("\n")[2]!);
    expect(event).toMatchObject({
      message: "email_send_failed",
      tags: { event: "email_send_failed" },
      user: { id: "u-1" },
    });
    expect(event.extra).toEqual({ userId: "u-1", email: "[redacted]", status: 422 });
    fetchSpy.mockRestore();
  });
});
