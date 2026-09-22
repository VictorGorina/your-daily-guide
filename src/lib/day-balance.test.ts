import { describe, expect, it } from "bun:test";

import {
  balanceNote,
  cleanDayAdjustment,
  changedMealsKcal,
  dayBalance,
  dayNote,
  dayReversing,
  mergeDayAdjustment,
  type DayBalance,
} from "./day-balance";
import type { DayExercise, ExerciseEntry } from "./exercise";
import type { MealChange, MealHabit } from "./plan-shared";
import type { DaySnacks, SnackEntry } from "./snacks";

const habit = (label: string, over: Partial<MealHabit> = {}): MealHabit => ({
  label,
  done: true,
  ...over,
});

const changed = (label: string, kcal: number, compensated = false): MealHabit =>
  habit(label, { status: "distinto", swapKcalDelta: kcal, swapCompensated: compensated });

const snacks = (kcal: number, compensatedKcal = 0): DaySnacks => ({
  entries: kcal
    ? [
        {
          id: "s1",
          text: "almendras",
          at: "2026-09-21T11:00:00.000Z",
          kcal,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 0,
          fiber_g: 0,
          source: "lookup",
        } satisfies SnackEntry,
      ]
    : [],
  compensatedKcal,
});

const exercise = (kcal: number, compensatedKcal = 0): DayExercise => ({
  entries: kcal
    ? [
        {
          id: "e1",
          activity: "Correr",
          minutes: 30,
          intensity: "Normal",
          kcal,
          at: "2026-09-21T19:00:00.000Z",
        } satisfies ExerciseEntry,
      ]
    : [],
  compensatedKcal,
});

// ---------------------------------------------------------------------------
// La suma del día: es lo que arregla los dos fallos de los libros separados
// ---------------------------------------------------------------------------

describe("dayBalance", () => {
  it("un día sin nada no está activo", () => {
    const b = dayBalance([], null, null);
    expect(b.net).toBe(0);
    expect(b.pending).toBe(0);
    expect(b.active).toBe(false);
  });

  it("suma los tres orígenes en un solo desvío", () => {
    const b = dayBalance([changed("Comida", 120)], snacks(260), exercise(-200));
    expect(b.sources).toEqual({ meals: 120, snacks: 260, exercise: -200 });
    expect(b.net).toBe(180);
    expect(b.pending).toBe(180);
    expect(b.active).toBe(true);
  });

  it("dos desvíos pequeños de origen distinto suman por encima del umbral", () => {
    // El fallo que arregla: +120 y +110 nunca llegaban a 200 en su propio libro.
    const b = dayBalance([changed("Comida", 120)], snacks(110), null);
    expect(b.pending).toBe(230);
  });

  it("picoteo y deporte que se anulan dejan el día en casi cero", () => {
    // El otro fallo: por separado cada uno cruzaba su umbral y se lanzaban dos
    // recolocaciones opuestas sobre los mismos días.
    const b = dayBalance([], snacks(250), exercise(-300));
    expect(b.net).toBe(-50);
    expect(b.pending).toBe(-50);
  });

  it("un día ya compensado y deshecho no enseña una tarjeta muda", () => {
    // Quedaba `compensatedKcal` pero ningún origen y nada pendiente: la tarjeta
    // salía con "0 kcal" y sin ninguna línea de desglose debajo.
    const b = dayBalance([], { entries: [], compensatedKcal: 250 }, null);
    expect(b.net).toBe(0);
    expect(b.pending).toBe(-250);
    expect(b.active).toBe(true);

    const settled = dayBalance([], { entries: [], compensatedKcal: 0 }, null);
    expect(settled.active).toBe(false);
  });

  it("lo ya compensado sale de `pending` pero sigue contando en `net`", () => {
    const b = dayBalance([changed("Cena", 300, true)], snacks(100, 100), null);
    expect(b.net).toBe(400);
    expect(b.pending).toBe(0);
    expect(b.compensated).toBe(400);
    // Sigue activa: hay desglose que enseñar aunque no quede nada pendiente.
    expect(b.active).toBe(true);
  });

  it("mezcla compensado y pendiente de orígenes distintos", () => {
    const b = dayBalance([changed("Cena", 300, true)], snacks(150), exercise(-80));
    expect(b.net).toBe(370);
    expect(b.pending).toBe(70);
    expect(b.compensated).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Deshacer: el apunte contrario decide, pero no se enseña
// ---------------------------------------------------------------------------

describe("changedMealsKcal", () => {
  it("solo cuenta las comidas que siguen marcadas como distintas", () => {
    expect(changedMealsKcal([changed("Comida", 120), habit("Cena")])).toBe(120);
  });

  it("una comida deshecha no cuenta, aunque lleve el apunte contrario", () => {
    // `revert` deja `swapKcalDelta: -300` sin estado: es contabilidad interna
    // para devolverle la energía a los días futuros, no algo que se haya comido.
    const reverted = habit("Cena", { done: false, swapKcalDelta: -300 });
    expect(changedMealsKcal([reverted])).toBe(0);
    // Pero sí tiene que decidir: el pendiente lo ve.
    expect(dayBalance([reverted], null, null).pending).toBe(-300);
  });
});

// ---------------------------------------------------------------------------
// Deshacer un ajuste ya aplicado vs. un desvío nuevo
// ---------------------------------------------------------------------------

describe("dayReversing", () => {
  const b = (pending: number, compensated: number): DayBalance => ({
    sources: { meals: 0, snacks: 0, exercise: 0 },
    net: 0,
    pending,
    compensated,
    active: true,
  });

  it("sin nada compensado nunca se está deshaciendo", () => {
    expect(dayReversing(b(-300, 0))).toBe(false);
  });

  it("sin pendiente tampoco", () => {
    expect(dayReversing(b(0, 250))).toBe(false);
  });

  it("borrar picoteo ya compensado es deshacer", () => {
    expect(dayReversing(b(-100, 250))).toBe(true);
  });

  it("borrar deporte ya compensado es deshacer", () => {
    expect(dayReversing(b(100, -300))).toBe(true);
  });

  it("deporte después de un picoteo ya compensado también cuenta como deshacer", () => {
    // Generalización nueva: ese déficit es, antes que nada, la devolución del
    // recorte que hizo el picoteo, no un déficit fresco que convenga ignorar.
    expect(dayReversing(b(-300, 250))).toBe(true);
  });

  it("más exceso sobre un exceso ya compensado no es deshacer", () => {
    expect(dayReversing(b(200, 250))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// El ajuste del día se acumula entre pasadas
// ---------------------------------------------------------------------------

describe("mergeDayAdjustment", () => {
  const change = (date: string, slot: string, before: string, after: string): MealChange =>
    ({ date, slot, slotLabel: slot, before, after }) as MealChange;

  it("sin ajuste previo devuelve el nuevo", () => {
    const next = { changes: [change("2026-09-24", "dinner", "A", "B")], summary: "s", kcal: 200 };
    expect(mergeDayAdjustment(null, next)).toEqual(next);
  });

  it("conserva el plato de antes de la PRIMERA pasada y el de después de la última", () => {
    const prev = { changes: [change("2026-09-24", "dinner", "A", "B")], summary: "s1", kcal: 200 };
    const next = { changes: [change("2026-09-24", "dinner", "B", "C")], summary: "s2", kcal: 150 };
    const merged = mergeDayAdjustment(prev, next);
    expect(merged.changes).toHaveLength(1);
    expect(merged.changes[0]!.before).toBe("A");
    expect(merged.changes[0]!.after).toBe("C");
    expect(merged.kcal).toBe(350);
  });

  it("quita la comida que ha vuelto a quedar como estaba", () => {
    const prev = { changes: [change("2026-09-24", "dinner", "A", "B")], summary: "s1", kcal: 200 };
    const next = { changes: [change("2026-09-24", "dinner", "B", "A")], summary: "s2", kcal: -200 };
    expect(mergeDayAdjustment(prev, next).changes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lectura defensiva de la columna nueva
// ---------------------------------------------------------------------------

describe("cleanDayAdjustment", () => {
  it("null para basura o para una columna que aún no existe", () => {
    expect(cleanDayAdjustment(null)).toBeNull();
    expect(cleanDayAdjustment(undefined)).toBeNull();
    expect(cleanDayAdjustment("texto")).toBeNull();
    expect(cleanDayAdjustment({})).toBeNull();
  });

  it("descarta un outcome desconocido pero conserva el ajuste", () => {
    const got = cleanDayAdjustment({
      adjustment: { changes: [], summary: "hecho", kcal: "180" },
      lastOutcome: "inventado",
    });
    expect(got?.lastOutcome).toBeNull();
    expect(got?.adjustment?.kcal).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// Lo que se le cuenta a la IA y lo que se le cuenta a la persona
// ---------------------------------------------------------------------------

describe("dayNote", () => {
  const base = {
    changedMeals: [],
    snackEntries: [],
    exerciseEntries: [],
    pendingKcal: 0,
    reversing: false,
  };

  it("junta los tres orígenes en una sola nota", () => {
    const note = dayNote({
      ...base,
      changedMeals: [{ label: "Comida", dish: "pizza", plannedDish: "ensalada" }],
      snackEntries: [{ text: "almendras", kcal: 260 }],
      exerciseEntries: [{ activity: "Correr", minutes: 30, intensity: "Normal", kcal: -200 }],
      pendingKcal: 180,
    });
    expect(note).toContain("pizza");
    expect(note).toContain("almendras");
    expect(note).toContain("Correr");
    expect(note).toContain("compensar el exceso");
  });

  it("un déficit pide reponer, no recortar", () => {
    expect(dayNote({ ...base, pendingKcal: -300 })).toContain("Repón");
  });

  it("deshacer pide devolver la energía quitada", () => {
    const note = dayNote({ ...base, pendingKcal: -250, reversing: true });
    expect(note).toContain("devuelve");
  });
});

describe("balanceNote", () => {
  const withSources = (meals: number, snack: number, ex: number): DayBalance => ({
    sources: { meals, snacks: snack, exercise: ex },
    net: meals + snack + ex,
    pending: meals + snack + ex,
    compensated: 0,
    active: true,
  });

  it("explica el motivo cuando el plan no se pudo tocar", () => {
    expect(balanceNote(withSources(0, 300, 0), "no-days")).toContain("No quedan días");
    expect(balanceNote(withSources(0, 300, 0), "pregnancy")).toContain("embarazo");
  });

  it("dice que el deporte compensó lo comido cuando el día se anula solo", () => {
    expect(balanceNote(withSources(0, 250, -300), "below-threshold")).toContain(
      "El deporte compensa",
    );
  });

  it("un desvío pequeño de un solo origen cae en el mensaje genérico", () => {
    expect(balanceNote(withSources(90, 0, 0), "below-threshold")).toContain("Lo absorbe el plan");
  });

  it("sin nada que explicar tras un ajuste no dice nada", () => {
    expect(balanceNote(withSources(0, 300, 0), "adjusted")).toBeNull();
  });
});
