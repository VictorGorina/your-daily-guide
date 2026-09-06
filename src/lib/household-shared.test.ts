import { describe, expect, it } from "bun:test";

import {
  childBasePortion,
  childPortion,
  childRation,
  cleanFeedingStage,
  cleanSharedSlots,
  describeRoster,
  describeServings,
  describeSharedSlots,
  eatsTableFood,
  isSharedSlot,
  PERSON_COLORS,
  personColor,
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

describe("describeRoster", () => {
  it("nombra a los adultos con y sin app, los niños con alergias y quién planifica", () => {
    const text = describeRoster(
      [
        { displayName: "Ana", hasAccount: true, isPlanner: true },
        { displayName: "Luis", hasAccount: true, isPlanner: false },
        { displayName: "Abuela", hasAccount: false, isPlanner: false },
      ],
      [
        { name: "Leo", age: 5, allergies: "huevo" },
        { name: "Mía", age: 2, allergies: null },
      ],
    );
    expect(text).toContain("Ana y Luis (con la app)");
    expect(text).toContain("Abuela (sin la app, solo cuentan para la compra)");
    expect(text).toContain("Leo (5 años), alergia a huevo");
    expect(text).toContain("Mía (2 años), sin alergias");
    expect(text).toContain("Planifica el menú y hace la compra de la casa: Ana.");
  });

  it("separa a los bebés que aún no comen de la mesa de los niños que sí", () => {
    const text = describeRoster(
      [{ displayName: "Ana", hasAccount: true, isPlanner: true }],
      [
        { name: "Leo", age: 5, allergies: null, stage: "mesa" },
        { name: "Bruno", age: 0, allergies: null, stage: "pecho" },
        { name: "Sara", age: 1, allergies: null, stage: "triturados" },
      ],
    );
    expect(text).toContain("Niños que comen del plato: Leo (5 años), sin alergias.");
    expect(text).toContain("Bebés que aún no comen de la mesa:");
    expect(text).toContain("Bruno (0 años) — pecho o biberón");
    expect(text).toContain("Sara (1 años) — triturados y potitos");
  });

  it("sin planificador lo dice explícitamente y omite la línea de niños si no hay", () => {
    const text = describeRoster([{ displayName: "Ana", hasAccount: true, isPlanner: false }], []);
    expect(text).toContain("Ana (con la app)");
    expect(text).not.toContain("Niños:");
    expect(text).toContain("nadie de la casa planifica");
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

describe("cleanFeedingStage", () => {
  it("acepta las tres etapas y cae en 'mesa' para cualquier otra cosa", () => {
    expect(cleanFeedingStage("pecho")).toBe("pecho");
    expect(cleanFeedingStage("triturados")).toBe("triturados");
    expect(cleanFeedingStage("mesa")).toBe("mesa");
    expect(cleanFeedingStage(null)).toBe("mesa");
    expect(cleanFeedingStage("otra")).toBe("mesa");
  });
});

describe("childRation", () => {
  it("un bebé de pecho o biberón no lleva ración (no entra en la compra)", () => {
    expect(childRation("pecho", 0, "normal")).toBe(0);
  });

  it("un bebé de triturados lleva una ración pequeña fija para su puré", () => {
    expect(childRation("triturados", 0, "normal")).toBe(0.25);
    expect(childRation("triturados", 1, "mucho")).toBe(0.25);
  });

  it("quien ya come del plato usa la ración por edad y apetito", () => {
    expect(childRation("mesa", 6, "normal")).toBe(childPortion(6, "normal"));
  });
});

describe("eatsTableFood", () => {
  it("solo 'mesa' come del mismo plato que la familia", () => {
    expect(eatsTableFood("mesa")).toBe(true);
    expect(eatsTableFood("triturados")).toBe(false);
    expect(eatsTableFood("pecho")).toBe(false);
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

  it("los bebés (pecho/triturados) no engordan la ración del plato compartido", () => {
    const slots: SharedSlots = { desayuno: [], comida: [0, 1, 2, 3, 4, 5, 6], cena: [] };
    const withBabies = [
      { portion: 0.5, stage: "mesa" as const },
      { portion: 0, stage: "pecho" as const },
      { portion: 0.25, stage: "triturados" as const },
    ];
    // 1 + 1.2 + 0.5 (solo el niño 'mesa'); pecho y triturados quedan fuera.
    expect(servingsPerSlot(members, withBabies, slots).shared.comida).toBe(2.7);
  });
});

describe("describeServings", () => {
  it("resume solo las comidas con días compartidos", () => {
    const slots: SharedSlots = { desayuno: [], comida: [0, 1], cena: [0, 1, 2, 3, 4, 5, 6] };
    const servings = servingsPerSlot([{ portion: 1, isPlanner: true }], [], slots);
    expect(describeServings(servings, slots)).toBe("Comida: 1 raciones · Cena: 1 raciones");
  });
});

describe("personColor", () => {
  it("es determinista: el mismo seed devuelve siempre el mismo color", () => {
    expect(personColor("member-abc")).toEqual(personColor("member-abc"));
  });

  it("siempre devuelve un color de la paleta", () => {
    for (const seed of ["", "a", "k1", "5e38f97f-1234", "Vega", "0000-1111-2222"]) {
      expect(PERSON_COLORS).toContainEqual(personColor(seed));
    }
  });

  it("reparte por la paleta: seeds distintos alcanzan los 5 índices", () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => JSON.stringify(personColor(`seed-${i}`))),
    );
    expect(seen.size).toBe(PERSON_COLORS.length);
  });
});
