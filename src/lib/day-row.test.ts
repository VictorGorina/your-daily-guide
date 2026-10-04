import { describe, expect, it } from "bun:test";

import {
  cleanGuide,
  cleanHabits,
  toChatMessage,
  toDailyLog,
  toDailyLogHistory,
  toDailyLogs,
} from "./day-row";

const MACROS = { kcal: 520, protein_g: 31, carbs_g: 48, fat_g: 19, fiber_g: 7 };

describe("cleanHabits", () => {
  it("deja igual una comida bien guardada, con todos sus campos", () => {
    const habit = {
      label: "Cena",
      done: true,
      status: "distinto",
      plannedIdea: "Merluza con brócoli",
      plannedKcal: 465,
      plannedProtein: 38,
      actual: "Pizza",
      portionSize: "grande",
      swapKcalDelta: 310,
      swapCompensated: true,
      adjustmentSummary: "Cena más ligera mañana",
      adjustmentChanges: [
        { date: "2026-10-05", slot: "dinner", slotLabel: "Cena", before: "A", after: "B" },
      ],
    };
    expect(cleanHabits([habit])).toEqual<unknown>([habit]);
  });

  it("conserva una clave que no conoce: un campo nuevo no desaparece al leer", () => {
    expect(cleanHabits([{ label: "Comida", done: false, campoNuevo: { a: 1 } }])).toEqual<unknown>([
      { label: "Comida", done: false, campoNuevo: { a: 1 } },
    ]);
  });

  it("quita la clave conocida con el tipo equivocado y deja el resto", () => {
    const [habit] = cleanHabits([
      {
        label: "Comida",
        done: "sí",
        status: "comido",
        plannedKcal: "465",
        manualKcal: Number.NaN,
        portionSize: "enorme",
        actual: 7,
        swapCompensated: 1,
        adjustmentChanges: "ninguno",
        plannedIdea: "Lentejas",
      },
    ]);
    expect(habit).toEqual<unknown>({ label: "Comida", done: false, plannedIdea: "Lentejas" });
  });

  it("salta lo que no es una comida: sin label, o que no es un objeto", () => {
    expect(
      cleanHabits([null, "Cena", { done: true }, { label: "  " }, { label: "Cena" }]),
    ).toEqual<unknown>([{ label: "Cena", done: false }]);
  });

  it("devuelve una lista vacía si la columna no trae una lista", () => {
    expect(cleanHabits(null)).toEqual<unknown>([]);
    expect(cleanHabits({ label: "Cena" })).toEqual<unknown>([]);
  });

  it("de los platos movidos se queda solo con los que son objetos", () => {
    const [habit] = cleanHabits([{ label: "Cena", adjustmentChanges: [null, { date: "x" }, 3] }]);
    expect(habit.adjustmentChanges).toEqual<unknown>([{ date: "x" }]);
  });
});

describe("cleanGuide", () => {
  const guide = {
    intro: "Hola",
    calories: "Unas 2.100 kcal",
    macros: "Proteína en cada comida",
    behaviors: ["Bebe agua"],
    meals: [{ moment: "Cena", idea: "Merluza" }],
    tips: ["Duerme"],
    macroEstimate: MACROS,
    targets: MACROS,
    portionFactor: 1.1,
    mealMacros: [{ ...MACROS, moment: "Cena", idea: "Merluza", status: "calculado", portion: 1.2 }],
  };

  it("deja igual una guía bien guardada", () => {
    expect(cleanGuide(guide)).toEqual<unknown>(guide);
  });

  it("sin guía (null, o algo que no es un objeto) devuelve null", () => {
    expect(cleanGuide(null)).toBeNull();
    expect(cleanGuide("guía")).toBeNull();
    expect(cleanGuide([guide])).toBeNull();
  });

  it("una guía antigua sin los campos opcionales no los gana al leerla", () => {
    const old = { intro: "Hola", calories: "", macros: "", behaviors: [] };
    expect(cleanGuide(old)).toEqual<unknown>(old);
  });

  it("pone por defecto los textos obligatorios que faltan", () => {
    expect(cleanGuide({ behaviors: "muchos", tips: [1, "Duerme"] })).toEqual<unknown>({
      intro: "",
      calories: "",
      macros: "",
      behaviors: [],
      tips: ["Duerme"],
    });
  });

  it("unas cifras a medias no son cifras: el objetivo queda en null", () => {
    const out = cleanGuide({ ...guide, targets: { kcal: 2100 }, macroEstimate: "2100" });
    expect(out?.targets).toBeNull();
    expect(out?.macroEstimate).toBeNull();
  });

  it("un plato calculado sin momento o sin cifras se salta (D13: se vuelve a pedir)", () => {
    const out = cleanGuide({
      ...guide,
      mealMacros: [
        { ...MACROS, moment: "Cena", status: "calculando" },
        { ...MACROS, idea: "sin momento" },
        { moment: "Comida", kcal: 500 },
        { ...MACROS, moment: "Desayuno", status: "medio", vague: "sí", portion: "1" },
      ],
    });
    expect(out?.mealMacros).toEqual<unknown>([
      { ...MACROS, moment: "Cena", status: "calculando" },
      { ...MACROS, moment: "Desayuno" },
    ]);
  });

  it("conserva una clave que no conoce", () => {
    expect(cleanGuide({ ...guide, campoNuevo: 1 })).toEqual<unknown>({ ...guide, campoNuevo: 1 });
  });
});

describe("toDailyLog", () => {
  const row = {
    id: "log-1",
    user_id: "user-1",
    log_date: "2026-10-04",
    weight_kg: 71.4,
    habits: [{ label: "Cena", done: true }],
    guide: null,
    mood: null,
    notes: "bien",
    evening_done: true,
    created_at: "2026-10-04T08:00:00Z",
  };

  it("lee la fila y no arrastra columnas que el tipo no tiene", () => {
    expect(toDailyLog(row)).toEqual<unknown>({
      id: "log-1",
      user_id: "user-1",
      log_date: "2026-10-04",
      weight_kg: 71.4,
      habits: [{ label: "Cena", done: true }],
      guide: null,
      mood: null,
      notes: "bien",
      evening_done: true,
    });
  });

  it("picoteo, deporte y ajuste solo aparecen si la lectura los pidió", () => {
    expect(toDailyLog(row)).not.toHaveProperty("snacks");
    const withBooks = toDailyLog({ ...row, snacks: null, exercise: null, adjustment: null });
    expect(withBooks).toMatchObject({ snacks: null, exercise: null, adjustment: null });
  });

  it("una fila sin fecha no es un día", () => {
    expect(toDailyLog({ ...row, log_date: null })).toBeNull();
    expect(toDailyLog(null)).toBeNull();
    expect(toDailyLogs([row, null, { id: "x" }])).toHaveLength(1);
  });

  it("un peso que no es un número queda en null", () => {
    expect(toDailyLog({ ...row, weight_kg: "71" })?.weight_kg).toBeNull();
  });

  it("el histórico se queda con fecha, peso y comidas", () => {
    expect(toDailyLogHistory(row)).toEqual<unknown>({
      log_date: "2026-10-04",
      weight_kg: 71.4,
      habits: [{ label: "Cena", done: true }],
    });
  });
});

describe("toChatMessage", () => {
  const message = {
    id: "m-1",
    log_date: "2026-10-04",
    role: "assistant",
    content: "Hola",
    created_at: "2026-10-04T08:00:00Z",
  };

  it("lee un mensaje de la persona o del coach", () => {
    expect(toChatMessage({ ...message, user_id: "user-1" })).toEqual<unknown>(message);
  });

  it("un role que no es de ninguno de los dos no se pinta", () => {
    expect(toChatMessage({ ...message, role: "system" })).toBeNull();
    expect(toChatMessage(null)).toBeNull();
  });
});
