import { afterEach, describe, expect, it, mock } from "bun:test";

import { afterResponse, resolveWaitUntil, VERCEL_REQUEST_CONTEXT } from "./after-response.server";

describe("resolveWaitUntil", () => {
  it("prefiere el waitUntil de la propia petición (el que pone Nitro)", () => {
    const fromRequest = mock(() => {});
    const fromContext = mock(() => {});
    const { via, waitUntil } = resolveWaitUntil(
      { waitUntil: fromRequest },
      { get: () => ({ waitUntil: fromContext }) },
    );
    expect(via).toBe("request");
    waitUntil!(Promise.resolve());
    expect(fromRequest).toHaveBeenCalledTimes(1);
    expect(fromContext).not.toHaveBeenCalled();
  });

  it("sin él, usa el contexto global de Vercel", () => {
    const fromContext = mock(() => {});
    const { via, waitUntil } = resolveWaitUntil(new Request("https://x.test/"), {
      get: () => ({ waitUntil: fromContext }),
    });
    expect(via).toBe("vercel-context");
    waitUntil!(Promise.resolve());
    expect(fromContext).toHaveBeenCalledTimes(1);
  });

  it("sin ninguno de los dos, lo dice: no hay nada que mantenga viva la función", () => {
    expect(resolveWaitUntil(undefined, undefined).via).toBe("none");
    expect(resolveWaitUntil({ waitUntil: "no" }, { get: () => ({}) }).via).toBe("none");
    expect(resolveWaitUntil({}, { get: () => undefined }).via).toBe("none");
    expect(resolveWaitUntil({}, {}).via).toBe("none");
  });

  it("llama al de la petición sobre la petición, como hace h3", () => {
    const request = {
      waitUntil(this: unknown) {
        expect(this).toBe(request);
      },
    };
    resolveWaitUntil(request, undefined).waitUntil!(Promise.resolve());
  });
});

describe("afterResponse", () => {
  const g = globalThis as Record<symbol, unknown>;
  afterEach(() => {
    delete g[VERCEL_REQUEST_CONTEXT];
  });

  it("pasa la promesa al waitUntil de la petición", () => {
    const waitUntil = mock(() => {});
    const request = Object.assign(new Request("https://x.test/"), { waitUntil });
    const work = Promise.resolve();
    expect(afterResponse(work, request)).toBe("request");
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it("fuera de una petición (tests, local) no lanza y dice que no hay puente", () => {
    expect(afterResponse(Promise.resolve())).toBe("none");
  });

  it("sin petición a mano, encuentra el contexto global de Vercel", () => {
    const waitUntil = mock(() => {});
    g[VERCEL_REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
    expect(afterResponse(Promise.resolve())).toBe("vercel-context");
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("si el waitUntil lanza, no tumba la petición", () => {
    const request = {
      waitUntil: () => {
        throw new Error("boom");
      },
    } as unknown as Request;
    expect(afterResponse(Promise.resolve(), request)).toBe("none");
  });
});
