import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import { clampClientToday, DEFAULT_TZ, zonedMinutesNow, zonedTodayISO } from "./zoned-date";

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

// SEC-S-11: el «hoy» lo manda el cliente y decide qué días son pasado. Solo se
// acepta una fecha que exista ahora mismo en alguna zona real (UTC−12 a UTC+14).
describe("clampClientToday", () => {
  it("a las 23:30 UTC acepta el mismo día (UTC−12) y el siguiente (UTC+14)", () => {
    setSystemTime(new Date("2026-09-26T23:30:00Z"));
    expect(clampClientToday("2026-09-26")).toBe("2026-09-26");
    expect(clampClientToday("2026-09-27")).toBe("2026-09-27");
  });

  it("a las 00:30 UTC acepta el día anterior (UTC−12)", () => {
    setSystemTime(new Date("2026-09-26T00:30:00Z"));
    expect(clampClientToday("2026-09-25")).toBe("2026-09-25");
  });

  it("una fecha que hoy no existe en ninguna zona cae a la del servidor", () => {
    setSystemTime(new Date("2026-09-26T23:30:00Z"));
    const server = zonedTodayISO();
    expect(clampClientToday("2026-09-28")).toBe(server);
    // A las 23:30 UTC ya no es día 25 en ninguna parte.
    expect(clampClientToday("2026-09-25")).toBe(server);
    expect(clampClientToday("2026-10-26")).toBe(server);
    expect(clampClientToday("2025-09-26")).toBe(server);
  });

  it("basura o nada cae a la del servidor, en la zona que se pida", () => {
    setSystemTime(new Date("2026-09-26T23:30:00Z"));
    expect(clampClientToday(undefined)).toBe(zonedTodayISO());
    expect(clampClientToday("mañana")).toBe(zonedTodayISO());
    expect(clampClientToday("2026-09-26T00:00")).toBe(zonedTodayISO());
    expect(clampClientToday(20260926)).toBe(zonedTodayISO());
    expect(clampClientToday(null, "America/Mexico_City")).toBe("2026-09-26");
  });
});
