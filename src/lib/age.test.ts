import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import { ageFromDOB, dobFromAge } from "./age";

afterEach(() => setSystemTime());

describe("ageFromDOB", () => {
  it("devuelve null sin fecha o con fecha inválida", () => {
    expect(ageFromDOB(null)).toBeNull();
    expect(ageFromDOB(undefined)).toBeNull();
    expect(ageFromDOB("no es una fecha")).toBeNull();
  });

  it("cuenta años cumplidos a fecha de hoy", () => {
    setSystemTime(new Date("2026-06-15T09:00:00Z"));
    expect(ageFromDOB("1996-06-15")).toBe(30); // cumple hoy
    expect(ageFromDOB("1996-06-16")).toBe(29); // cumple mañana, aún no
    expect(ageFromDOB("1996-06-14")).toBe(30); // cumplió ayer
  });

  it("devuelve null para una fecha de nacimiento futura", () => {
    setSystemTime(new Date("2026-06-15T09:00:00Z"));
    expect(ageFromDOB("2030-01-01")).toBeNull();
  });
});

describe("dobFromAge", () => {
  it("da una fecha ISO que ageFromDOB reconoce como esa edad", () => {
    setSystemTime(new Date("2026-06-15T09:00:00Z"));
    expect(dobFromAge(35)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ageFromDOB(dobFromAge(35))).toBe(35);
  });
});
