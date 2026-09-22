import { describe, expect, it } from "bun:test";

import type { MealChange } from "./plan-shared";
import {
  cleanDaySnacks,
  pendingSnackKcal,
  scaleSnackMacros,
  snackTotals,
  withSnack,
  withoutSnack,
  type DaySnacks,
  type SnackEntry,
} from "./snacks";

const entry = (id: string, kcal: number, protein = 0): SnackEntry => ({
  id,
  text: `picoteo ${id}`,
  at: "2026-09-16T11:00:00.000Z",
  kcal,
  protein_g: protein,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  source: "lookup",
});

// ---------------------------------------------------------------------------
// Libro de cuentas: lo pendiente es Σ kcal − compensatedKcal
// ---------------------------------------------------------------------------

describe("pendingSnackKcal", () => {
  it("sin picoteo no hay nada pendiente", () => {
    expect(pendingSnackKcal(null)).toBe(0);
    expect(pendingSnackKcal(undefined)).toBe(0);
  });

  it("dos picoteos pequeños se suman", () => {
    const day = withSnack(withSnack(null, entry("a", 150)), entry("b", 120));
    expect(pendingSnackKcal(day)).toBe(270);
  });

  it("lo ya compensado no vuelve a contar", () => {
    const day: DaySnacks = { entries: [entry("a", 300)], compensatedKcal: 300 };
    expect(pendingSnackKcal(day)).toBe(0);
    expect(pendingSnackKcal(withSnack(day, entry("b", 80)))).toBe(80);
  });

  it("borrar un picoteo ya compensado deja un pendiente negativo", () => {
    const day: DaySnacks = { entries: [entry("a", 500), entry("b", 90)], compensatedKcal: 590 };
    expect(pendingSnackKcal(withoutSnack(day, "a"))).toBe(-500);
  });
});

describe("withSnack / withoutSnack", () => {
  it("no muta el original y conserva el libro de cuentas", () => {
    const day: DaySnacks = { entries: [entry("a", 100)], compensatedKcal: 100 };
    const next = withSnack(day, entry("b", 50));
    expect(day.entries).toHaveLength(1);
    expect(next.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(next.compensatedKcal).toBe(100);
    expect(withoutSnack(next, "a").entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("borrar un id que no existe no cambia nada", () => {
    const day: DaySnacks = { entries: [entry("a", 100)], compensatedKcal: 0 };
    expect(withoutSnack(day, "zzz").entries).toHaveLength(1);
  });
});

describe("snackTotals", () => {
  it("suma todas las macros", () => {
    const day = withSnack(withSnack(null, entry("a", 175, 6)), entry("b", 90, 1));
    expect(snackTotals(day)).toEqual({
      kcal: 265,
      protein_g: 7,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: 0,
    });
    expect(snackTotals(null).kcal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cleanDaySnacks — lectura defensiva de la columna JSON
// ---------------------------------------------------------------------------

describe("cleanDaySnacks", () => {
  it("devuelve null para vacío o basura", () => {
    expect(cleanDaySnacks(null)).toBeNull();
    expect(cleanDaySnacks("x")).toBeNull();
    expect(cleanDaySnacks({ entries: [] })).toBeNull();
  });

  it("descarta entradas sin id o sin texto y acota las cifras", () => {
    const day = cleanDaySnacks({
      entries: [
        { id: "a", text: " almendras ", kcal: "175.4", protein_g: -3, source: "raro" },
        { id: "", text: "sin id", kcal: 10 },
        { id: "c", text: "", kcal: 10 },
        { id: "d", text: "atracón", kcal: 99999, source: "manual" },
      ],
      compensatedKcal: "200",
      lastOutcome: "no-existe",
    });
    expect(day?.entries.map((e) => e.id)).toEqual(["a", "d"]);
    expect(day?.entries[0]).toMatchObject({
      text: "almendras",
      kcal: 175,
      protein_g: 0,
      source: "lookup",
    });
    expect(day?.entries[1]?.kcal).toBe(3000);
    expect(day?.entries[1]?.source).toBe("manual");
    expect(day?.compensatedKcal).toBe(200);
    expect(day?.lastOutcome).toBeNull();
  });

  it("conserva un libro de cuentas sin entradas (se borró todo tras compensar)", () => {
    const day = cleanDaySnacks({ entries: [], compensatedKcal: 400, lastOutcome: "adjusted" });
    expect(day).not.toBeNull();
    expect(pendingSnackKcal(day)).toBe(-400);
  });
});

// ---------------------------------------------------------------------------
// scaleSnackMacros — corregir la cifra a mano
// ---------------------------------------------------------------------------

describe("scaleSnackMacros", () => {
  it("escala el resto de macros en la misma proporción", () => {
    const estimate = { kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, fiber_g: 2 };
    expect(scaleSnackMacros(estimate, 100)).toEqual({
      kcal: 100,
      protein_g: 5,
      carbs_g: 10,
      fat_g: 4,
      fiber_g: 1,
    });
  });

  it("sin cifra calculada solo hay kcal", () => {
    expect(scaleSnackMacros(null, 250)).toEqual({
      kcal: 250,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: 0,
    });
    expect(
      scaleSnackMacros({ kcal: 0, protein_g: 3, carbs_g: 0, fat_g: 0, fiber_g: 0 }, 50).protein_g,
    ).toBe(0);
  });
});
