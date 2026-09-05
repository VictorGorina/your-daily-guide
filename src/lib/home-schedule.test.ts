import { describe, expect, test } from "bun:test";

import {
  deriveSharedSlots,
  EMPTY_SCHEDULE,
  isEffectivelyShared,
  servingsForMealDay,
  whoIsHome,
  type HomeSchedule,
} from "./household-shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const plannerSchedule: HomeSchedule = {
  desayuno: [0, 1, 2, 3, 4], // L-V
  comida: [0, 1, 2, 3, 4],
  cena: [0, 1, 2, 3, 4, 5, 6], // todos los días
};

const partnerSchedule: HomeSchedule = {
  desayuno: [0, 1, 2, 3, 4],
  comida: [0, 2, 4], // solo L, X, V
  cena: [0, 1, 2, 3, 4, 5, 6],
};

const kidSchedule: HomeSchedule = {
  desayuno: [0, 1, 2, 3, 4],
  comida: [0, 1, 2, 3, 4],
  cena: [0, 1, 2, 3, 4, 5, 6],
};

const planner = {
  id: "p1",
  displayName: "Víctor",
  portion: 1,
  isPlanner: true,
  homeSchedule: plannerSchedule,
};

const partner = {
  id: "p2",
  displayName: "Ana",
  portion: 1,
  isPlanner: false,
  homeSchedule: partnerSchedule,
};

const child = {
  id: "c1",
  name: "Lucía",
  portion: 0.5,
  homeSchedule: kidSchedule,
};

// ---------------------------------------------------------------------------
// whoIsHome
// ---------------------------------------------------------------------------
describe("whoIsHome", () => {
  test("lunes comida: todos en casa", () => {
    const result = whoIsHome([planner, partner], [child], "comida", 0);
    expect(result.people).toHaveLength(3);
    expect(result.totalPortions).toBe(2.5);
  });

  test("martes comida: partner fuera", () => {
    const result = whoIsHome([planner, partner], [child], "comida", 1);
    expect(result.people).toHaveLength(2);
    expect(result.people.map((p) => p.displayName)).toEqual(["Víctor", "Lucía"]);
    expect(result.totalPortions).toBe(1.5);
  });

  test("sábado comida: nadie en casa (planner solo L-V)", () => {
    const result = whoIsHome([planner, partner], [child], "comida", 5);
    expect(result.people).toHaveLength(0);
    expect(result.totalPortions).toBe(0);
  });

  test("sábado cena: planificador + partner + niño", () => {
    const result = whoIsHome([planner, partner], [child], "cena", 5);
    expect(result.people).toHaveLength(3);
    expect(result.totalPortions).toBe(2.5);
  });

  test("miembro sin schedule: no está en casa", () => {
    const noSched = { ...partner, homeSchedule: null };
    const result = whoIsHome([planner, noSched], [], "comida", 0);
    expect(result.people).toHaveLength(1);
    expect(result.totalPortions).toBe(1);
  });

  test("nadie en casa devuelve array vacío", () => {
    // Planner's comida is L-V (0-4), so Saturday (5) is empty
    const result = whoIsHome([planner], [], "comida", 5);
    expect(result.people).toHaveLength(0);
    expect(result.totalPortions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isEffectivelyShared
// ---------------------------------------------------------------------------
describe("isEffectivelyShared", () => {
  test("lunes comida: planner + partner + kid → shared", () => {
    expect(isEffectivelyShared([planner, partner], [child], "comida", 0)).toBe(true);
  });

  test("martes comida: planner + kid (partner fuera) → still shared", () => {
    expect(isEffectivelyShared([planner, partner], [child], "comida", 1)).toBe(true);
  });

  test("sábado comida: solo planner → not shared", () => {
    expect(isEffectivelyShared([planner, partner], [child], "comida", 5)).toBe(false);
  });

  test("planner fuera → never shared", () => {
    const plannerAway = { ...planner, homeSchedule: EMPTY_SCHEDULE };
    expect(isEffectivelyShared([plannerAway, partner], [child], "comida", 0)).toBe(false);
  });

  test("sin planificador → never shared", () => {
    const noPlanners = [{ ...planner, isPlanner: false }, partner];
    expect(isEffectivelyShared(noPlanners, [child], "comida", 0)).toBe(false);
  });

  test("solo planner y un niño → shared (2 personas)", () => {
    expect(isEffectivelyShared([planner], [child], "comida", 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// servingsForMealDay
// ---------------------------------------------------------------------------
describe("servingsForMealDay", () => {
  test("lunes comida: 1 + 1 + 0.5 = 2.5 raciones", () => {
    expect(
      servingsForMealDay(
        [planner, partner].map((m) => ({ portion: m.portion, homeSchedule: m.homeSchedule })),
        [child].map((c) => ({ portion: c.portion, homeSchedule: c.homeSchedule })),
        "comida",
        0,
      ),
    ).toBe(2.5);
  });

  test("martes comida: partner fuera → 1 + 0.5 = 1.5", () => {
    expect(
      servingsForMealDay(
        [planner, partner].map((m) => ({ portion: m.portion, homeSchedule: m.homeSchedule })),
        [child].map((c) => ({ portion: c.portion, homeSchedule: c.homeSchedule })),
        "comida",
        1,
      ),
    ).toBe(1.5);
  });

  test("nadie en casa → 0", () => {
    expect(servingsForMealDay([], [], "comida", 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveSharedSlots
// ---------------------------------------------------------------------------
describe("deriveSharedSlots", () => {
  test("L-V desayuno shared (planner + partner ambos en casa)", () => {
    const slots = deriveSharedSlots([planner, partner], [child]);
    expect(slots.desayuno).toEqual([0, 1, 2, 3, 4]);
  });

  test("comida: solo L, X, V (partner solo esos días)", () => {
    // Pero planner + kid are also home on other days,
    // so comida is shared whenever planner + someone else is home.
    // Kid eats lunch L-V, so even without partner it's shared on Tu/Th too.
    const slots = deriveSharedSlots([planner, partner], [child]);
    expect(slots.comida).toEqual([0, 1, 2, 3, 4]); // L-V, because kid is always there
  });

  test("comida sin kid: solo L, X, V", () => {
    const slots = deriveSharedSlots([planner, partner], []);
    expect(slots.comida).toEqual([0, 2, 4]);
  });

  test("cena: L-D (todos los días planner + partner)", () => {
    const slots = deriveSharedSlots([planner, partner], [child]);
    expect(slots.cena).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("sin schedules: todo vacío", () => {
    const slots = deriveSharedSlots(
      [
        { ...planner, homeSchedule: null },
        { ...partner, homeSchedule: null },
      ],
      [],
    );
    expect(slots.desayuno).toEqual([]);
    expect(slots.comida).toEqual([]);
    expect(slots.cena).toEqual([]);
  });
});
