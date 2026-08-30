import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { safeInternalPath } from "./safe-next";

// safeInternalPath se apoya en window.location.origin; en bun test no hay window.
const ORIGIN = "https://app.example.com";
const prevWindow = (globalThis as { window?: unknown }).window;

beforeAll(() => {
  (globalThis as { window?: unknown }).window = { location: { origin: ORIGIN } };
});
afterAll(() => {
  (globalThis as { window?: unknown }).window = prevWindow;
});

describe("safeInternalPath", () => {
  it("acepta una ruta interna simple", () => {
    expect(safeInternalPath("/hoy")).toBe("/hoy");
  });

  it("conserva la query pero descarta el fragmento", () => {
    expect(safeInternalPath("/plan?mes=2026-08")).toBe("/plan?mes=2026-08");
    expect(safeInternalPath("/hoy#seccion")).toBe("/hoy");
  });

  it("rechaza vacío y undefined", () => {
    expect(safeInternalPath(undefined)).toBeUndefined();
    expect(safeInternalPath("")).toBeUndefined();
  });

  it("rechaza rutas protocol-relative y con barra invertida", () => {
    expect(safeInternalPath("//evil.com")).toBeUndefined();
    expect(safeInternalPath("/\\evil.com")).toBeUndefined();
  });

  it("rechaza URLs absolutas a otro origen", () => {
    expect(safeInternalPath("https://evil.com/phish")).toBeUndefined();
    expect(safeInternalPath("http://app.example.com/hoy")).toBeUndefined(); // no empieza por "/"
  });

  it("un ../ se resuelve pero se queda en el mismo origen", () => {
    const out = safeInternalPath("/../../etc/passwd");
    expect(out).toBe("/etc/passwd"); // mismo origen, sin escapar del host
  });
});
