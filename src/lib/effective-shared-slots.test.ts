import { describe, expect, it } from "bun:test";

import { effectiveSharedSlots } from "./effective-shared-slots";
import type { HomeSchedule } from "./household-shared";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const NONE: HomeSchedule = { desayuno: [], comida: [], cena: [] };
const LEGACY: HomeSchedule = { desayuno: [], comida: ALL, cena: ALL };
const noTuesdayDinner: HomeSchedule = { ...LEGACY, cena: ALL.filter((d) => d !== 1) };

describe("effectiveSharedSlots", () => {
  it("sin ningún horario, la columna del hogar tal cual", () => {
    const slots = effectiveSharedSlots(
      LEGACY,
      [
        { isPlanner: true, homeSchedule: null },
        { isPlanner: false, homeSchedule: null },
      ],
      [],
    );
    expect(slots).toEqual(LEGACY);
  });

  it("si quien no planifica no cena en casa el martes, esa cena deja de ser compartida", () => {
    const slots = effectiveSharedSlots(
      LEGACY,
      [
        { isPlanner: true, homeSchedule: LEGACY },
        { isPlanner: false, homeSchedule: noTuesdayDinner },
      ],
      [],
    );
    expect(slots.cena).toEqual([0, 2, 3, 4, 5, 6]);
    expect(slots.comida).toEqual(ALL);
  });

  it("quien no ha puesto su horario hereda la columna, no «nunca en casa»", () => {
    // El planificador sin horario: si contara como vacío, no habría ninguna
    // comida compartida en todo el hogar.
    const slots = effectiveSharedSlots(
      LEGACY,
      [
        { isPlanner: true, homeSchedule: null },
        { isPlanner: false, homeSchedule: noTuesdayDinner },
      ],
      [],
    );
    expect(slots.cena).toEqual([0, 2, 3, 4, 5, 6]);
  });

  it("basta con el horario de un niño para derivar", () => {
    const slots = effectiveSharedSlots(
      LEGACY,
      [{ isPlanner: true, homeSchedule: null }],
      [{ homeSchedule: { ...NONE, cena: [4] }, stage: "mesa" }],
    );
    expect(slots).toEqual({ desayuno: [], comida: [], cena: [4] });
  });

  it("un bebé que aún no come de la mesa no hace compartida una comida del planificador", () => {
    const slots = effectiveSharedSlots(
      LEGACY,
      [{ isPlanner: true, homeSchedule: LEGACY }],
      [{ homeSchedule: LEGACY, stage: "pecho" }],
    );
    expect(slots).toEqual(NONE);
  });
});
