import { describe, expect, it } from "bun:test";

import {
  childBasePortion,
  childPortion,
  cleanSharedSlots,
  describeServings,
  describeSharedSlots,
  isSharedSlot,
  servingsPerSlot,
  toggleDay,
  type SharedSlots,
} from "./household-shared";

describe("cleanSharedSlots", () => {
  it("recorta días fuera de 0–6, deduplica y ordena", () => {
    expect(cleanSharedSlots({ desayuno: [3, 1, 1, 8, -1, 2.5], comida: [6, 0], cena: [] })).toEqual(
      {
        desayuno: [1, 3],
        comida: [0, 6],
        cena: [],
      },
    );
  });

  it("tolera valores basura: null, ausencias y tipos raros caen a lista vacía", () => {
    expect(cleanSharedSlots(null)).toEqual({ desayuno: [], comida: [], cena: [] });
    expect(cleanSharedSlots({ desayuno: "L,M", comida: 3, cena: [1] })).toEqual({
      desayuno: [],
      comida: [],
      cena: [1],
    });
  });

  it("acepta días numéricos en texto (vienen así del JSON de la BD)", () => {
    expect(cleanSharedSlots({ comida: ["0", "1", "2"] }).comida).toEqual([0, 1, 2]);
  });
});

describe("isSharedSlot", () => {
  const slots: SharedSlots = { desayuno: [], comida: [0, 1, 2, 3, 4], cena: [0, 1, 2, 3, 4, 5, 6] };

  it("es true solo si esa comida ese día está en la config del hogar", () => {
    expect(isSharedSlot(slots, "comida", 2)).toBe(true);
    expect(isSharedSlot(slots, "comida", 5)).toBe(false);
    expect(isSharedSlot(slots, "cena", 6)).toBe(true);
    expect(isSharedSlot(slots, "desayuno", 0)).toBe(false);
  });
});

describe("toggleDay", () => {
  it("añade el día si falta y lo quita si está, manteniendo el orden", () => {
    expect(toggleDay([0, 2], 1)).toEqual([0, 1, 2]);
    expect(toggleDay([0, 1, 2], 1)).toEqual([0, 2]);
  });
});

describe("describeSharedSlots", () => {
  it("resume las comidas con días; vacío → texto neutro", () => {
    expect(describeSharedSlots({ desayuno: [], comida: [0, 4], cena: [] })).toBe(
      "Comida: Lunes, Viernes",
    );
    expect(describeSharedSlots({ desayuno: [], comida: [], cena: [] })).toBe(
      "sin comidas compartidas",
    );
  });
});

describe("childBasePortion", () => {
  it("sigue la tabla por edad del backfill de la migración", () => {
    expect(childBasePortion(1)).toBe(0.3);
    expect(childBasePortion(3)).toBe(0.3);
    expect(childBasePortion(4)).toBe(0.5);
    expect(childBasePortion(8)).toBe(0.5);
    expect(childBasePortion(9)).toBe(0.75);
    expect(childBasePortion(13)).toBe(0.75);
    expect(childBasePortion(14)).toBe(1);
    expect(childBasePortion(30)).toBe(1);
  });

  it("sin edad conocida cae en 0,5, igual que el backfill", () => {
    expect(childBasePortion(null)).toBe(0.5);
  });
});

describe("childPortion", () => {
  it("ajusta la base de edad ±0,2 según el apetito", () => {
    expect(childPortion(6, "normal")).toBe(0.5);
    expect(childPortion(6, "mucho")).toBe(0.7);
    expect(childPortion(6, "poco")).toBe(0.3);
  });

  it("nunca baja de 0,1 aunque la base sea pequeña y el apetito sea poco", () => {
    expect(childPortion(2, "poco")).toBe(0.1);
  });
});

describe("servingsPerSlot", () => {
  const members = [
    { portion: 1, isPlanner: true },
    { portion: 1.2, isPlanner: false },
  ];
  const children = [{ portion: 0.5 }, { portion: 0.3 }];

  it("suma las raciones de todos (adultos + niños) en las comidas que se comparten", () => {
    const slots: SharedSlots = { desayuno: [], comida: [0, 1, 2, 3, 4, 5, 6], cena: [] };
    const servings = servingsPerSlot(members, children, slots);
    expect(servings.shared.comida).toBe(3); // 1 + 1.2 + 0.5 + 0.3
  });

  it("una comida sin ningún día compartido pide 0 raciones de hogar", () => {
    const slots: SharedSlots = { desayuno: [], comida: [], cena: [] };
    const servings = servingsPerSlot(members, children, slots);
    expect(servings.shared).toEqual({ desayuno: 0, comida: 0, cena: 0 });
  });

  it("plannerSolo es la ración de quien planifica, no la del hogar", () => {
    const slots: SharedSlots = { desayuno: [], comida: [], cena: [] };
    expect(servingsPerSlot(members, children, slots).plannerSolo).toBe(1);
  });
});

describe("describeServings", () => {
  it("resume solo las comidas con días compartidos", () => {
    const slots: SharedSlots = { desayuno: [], comida: [0, 1], cena: [0, 1, 2, 3, 4, 5, 6] };
    const servings = servingsPerSlot([{ portion: 1, isPlanner: true }], [], slots);
    expect(describeServings(servings, slots)).toBe("Comida: 1 raciones · Cena: 1 raciones");
  });
});
