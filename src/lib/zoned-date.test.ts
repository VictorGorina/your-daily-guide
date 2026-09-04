import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import { DEFAULT_TZ, zonedMinutesNow, zonedTodayISO } from "./zoned-date";

afterEach(() => setSystemTime());

describe("zonedTodayISO", () => {
  it("devuelve YYYY-MM-DD", () => {
    expect(zonedTodayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // La razón de existir de la función: entre las 22:00–00:00 UTC, "hoy" en
  // Madrid ya es el día siguiente. UTC pelado se equivocaría aquí. Sin argumento
  // el comportamiento es el de antes (Europe/Madrid).
  it("por defecto Madrid: cuenta como mañana lo que en UTC aún es hoy (invierno)", () => {
    setSystemTime(new Date("2026-01-01T23:30:00Z"));
    expect(zonedTodayISO()).toBe("2026-01-02");
    expect(zonedTodayISO(DEFAULT_TZ)).toBe("2026-01-02");
  });

  it("por defecto Madrid: cuenta como mañana lo que en UTC aún es hoy (verano)", () => {
    setSystemTime(new Date("2026-07-01T23:30:00Z"));
    expect(zonedTodayISO()).toBe("2026-07-02");
  });

  it("hacia el oeste, todavía es el día anterior tras la medianoche UTC", () => {
    setSystemTime(new Date("2026-01-02T02:30:00Z"));
    expect(zonedTodayISO("America/New_York")).toBe("2026-01-01"); // UTC-5 en invierno
    expect(zonedTodayISO("America/Mexico_City")).toBe("2026-01-01");
    expect(zonedTodayISO("Europe/Madrid")).toBe("2026-01-02");
  });

  it("hacia el este, ya es el día siguiente antes de la medianoche UTC", () => {
    setSystemTime(new Date("2026-03-09T16:00:00Z"));
    expect(zonedTodayISO("Asia/Tokyo")).toBe("2026-03-10"); // UTC+9
  });
});

describe("zonedMinutesNow", () => {
  it("convierte la hora de pared a minutos desde medianoche, por zona", () => {
    // 10:00 UTC = 12:00 CEST en Madrid = 06:00 EDT en Nueva York
    setSystemTime(new Date("2026-06-01T10:00:00Z"));
    expect(zonedMinutesNow("Europe/Madrid")).toBe(12 * 60);
    expect(zonedMinutesNow("America/New_York")).toBe(6 * 60);
    expect(zonedMinutesNow()).toBe(12 * 60);
  });
});
