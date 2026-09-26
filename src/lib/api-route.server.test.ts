import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { apiPost } from "./api-route.server";
import { RateLimitError } from "./rate-limit-error";
import { ValidationError } from "./validation-error";

// `apiPost` es por donde la app móvil llega a cada server function: fija qué
// código HTTP ve el cliente para cada tipo de error.

const post = (body?: string, contentType = "application/json") =>
  new Request("http://localhost/api/v1/x", {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : {},
    body,
  });

const failWith = (error: unknown) =>
  apiPost(async () => {
    throw error;
  });

let consoleError: ReturnType<typeof spyOn>;
beforeEach(() => {
  consoleError = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe("apiPost", () => {
  it("pasa el JSON como `data` y devuelve el resultado con 200", async () => {
    let received: unknown;
    const handler = apiPost(async ({ data }) => {
      received = data;
      return { ok: true };
    });
    const res = await handler({ request: post(JSON.stringify({ month: "2026-09" })) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(received).toEqual({ month: "2026-09" });
  });

  it("sin content-type JSON, `data` llega undefined", async () => {
    let received: unknown = "sin llamar";
    const handler = apiPost(async ({ data }) => {
      received = data;
      return null;
    });
    await handler({ request: post("hola", "text/plain") });
    expect(received).toBeUndefined();
  });

  it("JSON no válido → 400 sin llamar a la función", async () => {
    let called = false;
    const handler = apiPost(async () => {
      called = true;
      return null;
    });
    const res = await handler({ request: post("{no es json") });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "JSON no válido" });
    expect(called).toBe(false);
  });

  it("sin sesión (Unauthorized…) → 401 para que el cliente reautentique", async () => {
    const res = await failWith(new Error("Unauthorized: No authorization header provided"))({
      request: post("{}"),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized: No authorization header provided" });
  });

  it("cuota agotada → 429 con retry-after", async () => {
    const error = new RateLimitError(90, "usar el coach");
    const res = await failWith(error)({ request: post("{}") });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect(await res.json()).toEqual({ error: error.message });
  });

  it("ValidationError → 400 con su mensaje, para enseñarlo en pantalla", async () => {
    const res = await failWith(new ValidationError("Mes no válido"))({ request: post("{}") });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Mes no válido" });
  });

  it("cualquier otro error → 500 genérico, sin filtrar el mensaje interno", async () => {
    const res = await failWith(new Error("duplicate key value violates unique constraint"))({
      request: post("{}"),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("No hemos podido completar la acción. Inténtalo de nuevo.");
    expect(consoleError).toHaveBeenCalled();
  });

  it("algo lanzado que no es un Error también sale como 500", async () => {
    const res = await failWith("texto suelto")({ request: post("{}") });
    expect(res.status).toBe(500);
  });
});
