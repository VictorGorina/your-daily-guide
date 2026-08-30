import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import { madridTodayISO } from "./madrid-date";

afterEach(() => setSystemTime());

describe("madridTodayISO", () => {
  it("devuelve YYYY-MM-DD", () => {
    expect(madridTodayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // La razón de existir de la función: entre las 22:00–00:00 UTC, "hoy" en
  // Madrid ya es el día siguiente. UTC pelado se equivocaría aquí.
  it("cuenta como mañana lo que en UTC aún es hoy (invierno, CET = UTC+1)", () => {
    setSystemTime(new Date("2026-01-01T23:30:00Z"));
    expect(madridTodayISO()).toBe("2026-01-02");
  });

  it("cuenta como mañana lo que en UTC aún es hoy (verano, CEST = UTC+2)", () => {
    setSystemTime(new Date("2026-07-01T23:30:00Z"));
    expect(madridTodayISO()).toBe("2026-07-02");
  });

  it("coincide con UTC a mediodía", () => {
    setSystemTime(new Date("2026-03-10T12:00:00Z"));
    expect(madridTodayISO()).toBe("2026-03-10");
  });
});
