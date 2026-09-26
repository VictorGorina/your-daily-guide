import { describe, expect, it } from "bun:test";

import { redactFields } from "./log-redact";

describe("redactFields", () => {
  const userId = "5e38f97f-1234-4abc-8def-0123456789ab";

  it("tapa las claves prohibidas a cualquier profundidad y deja pasar userId", () => {
    const out = redactFields({
      userId,
      email: "ana@example.com",
      profile: { notes: "migrañas", health: { medications: "ibuprofeno" } },
      members: [{ name: "Ana", portion: 1 }, { name: "Luis" }],
    });
    expect(out).toEqual({
      userId,
      email: "[redacted]",
      profile: { notes: "[redacted]", health: { medications: "[redacted]" } },
      members: [{ name: "[redacted]", portion: 1 }, { name: "[redacted]" }],
    });
  });

  it("recorta los strings a 200 caracteres", () => {
    const out = redactFields({ error: "x".repeat(500) });
    expect((out.error as string).length).toBe(200);
  });

  it("no distingue mayúsculas en las claves", () => {
    expect(redactFields({ Authorization: "Bearer abc" })).toEqual({ Authorization: "[redacted]" });
  });

  it("conserva cuatro niveles de objetos anidados y corta el quinto", () => {
    const out = redactFields({ a: { b: { c: { d: { e: { f: 1 } } } } } });
    expect(out).toEqual({ a: { b: { c: { d: { e: "[depth]" } } } } });
  });

  it("un Error sale como texto, no como objeto vacío", () => {
    expect(redactFields({ error: new Error("boom") })).toEqual({ error: "Error: boom" });
  });

  it("no toca el objeto original", () => {
    const input = { email: "ana@example.com" };
    redactFields(input);
    expect(input.email).toBe("ana@example.com");
  });
});
