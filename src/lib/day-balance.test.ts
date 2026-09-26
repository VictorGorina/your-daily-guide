import { describe, expect, it } from "bun:test";

import {
  absorbedKcal,
  absorbedNote,
  absorbsTooLittle,
  balanceNote,
  cleanDayAdjustment,
  changedMealsKcal,
  dayBalance,
  dayNote,
  dayReversing,
  mergeDayAdjustment,
  releaseDay,
  reserveDay,
  type DayBalance,
} from "./day-balance";
import type { DayExercise, ExerciseEntry } from "./exercise";
import { compensationNeed } from "./nutrition/compensation";
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
    proteinPending: 0,
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
    proteinPending: 0,
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

// ---------------------------------------------------------------------------
// Proteína en la decisión (ticket 13 de `precision-nutricional`)
// ---------------------------------------------------------------------------

describe("proteína del día", () => {
  it("lentejas → pasta con tomate (−22 g de P, +40 kcal) compensa por proteína con cualquier objetivo", () => {
    const habits = [
      habit("Comida", {
        status: "distinto",
        swapKcalDelta: 40,
        swapProteinDelta: -22,
        swapCompensated: false,
      }),
    ];
    const balance = dayBalance(habits, null, null);
    expect(balance.pending).toBe(40);
    expect(balance.proteinPending).toBe(-22);
    for (const goal of ["perder", "mantener", "ganar", null]) {
      const decision = compensationNeed({
        deltaKcal: balance.pending,
        deltaProtein: balance.proteinPending,
        goal,
      });
      expect(decision).toMatchObject({ compensate: true, proteinDelta: -22 });
      // Sin la proteína (como antes del ticket 13), no se movía nada.
      expect(compensationNeed({ deltaKcal: balance.pending, goal }).compensate).toBe(false);
    }
  });

  it("el picoteo repone proteína contra una bajada; el deporte no suma nada", () => {
    const habits = [
      habit("Comida", { status: "distinto", swapKcalDelta: 0, swapProteinDelta: -25 }),
    ];
    const withSnack: DaySnacks = {
      entries: [
        {
          id: "s1",
          text: "yogur griego",
          at: "2026-09-21T11:00:00.000Z",
          kcal: 120,
          protein_g: 10,
          carbs_g: 5,
          fat_g: 6,
          fiber_g: 0,
          source: "lookup",
        },
      ],
      compensatedKcal: 0,
    } as DaySnacks;
    expect(dayBalance(habits, withSnack, null).proteinPending).toBe(-15);
  });

  it("subir proteína no decide nada, y lo ya compensado no cuenta", () => {
    expect(
      dayBalance([habit("Cena", { status: "distinto", swapProteinDelta: 30 })], null, null)
        .proteinPending,
    ).toBe(0);
    expect(
      dayBalance(
        [habit("Cena", { status: "distinto", swapProteinDelta: -30, swapCompensated: true })],
        null,
        null,
      ).proteinPending,
    ).toBe(0);
  });

  it("la nota del día pide reponer proteína cuando es lo que dispara", () => {
    const note = dayNote({
      changedMeals: [{ label: "Comida", dish: "Pasta con tomate", plannedDish: "Lentejas" }],
      snackEntries: [],
      exerciseEntries: [],
      pendingKcal: 40,
      reversing: false,
      proteinDrop: -22,
    });
    expect(note).toContain("22 g menos de proteína");
    expect(note).not.toContain("compensar el exceso");
  });
});

// ---------------------------------------------------------------------------
// Ticket 18: lo que absorbe de verdad el reajuste
// ---------------------------------------------------------------------------

describe("absorbedKcal (ticket 18)", () => {
  const kcal: Record<string, number> = {
    "Lentejas con chorizo": 520,
    "Garbanzos con espinacas": 490,
    "Pollo con verduras": 380,
    "Crema de calabacín": 180,
  };
  const kcalOf = (d: string) => kcal[d] ?? null;

  it("lentejas → garbanzos mueve 30 kcal, no 'todo compensado'", () => {
    const a = absorbedKcal(
      [{ before: "Lentejas con chorizo", after: "Garbanzos con espinacas" }],
      kcalOf,
    )!;
    expect(a).toBe(30);
    expect(absorbsTooLittle(a, 400)).toBe(true);
  });

  it("dos cenas más ligeras compensan un exceso de 400", () => {
    const a = absorbedKcal(
      [
        { before: "Lentejas con chorizo", after: "Pollo con verduras" },
        { before: "Garbanzos con espinacas", after: "Crema de calabacín" },
      ],
      kcalOf,
    )!;
    expect(a).toBe(140 + 310);
    expect(absorbsTooLittle(a, 400)).toBe(false);
  });

  it("un déficit se compensa sumando: mismo criterio con el signo", () => {
    const a = absorbedKcal(
      [{ before: "Crema de calabacín", after: "Lentejas con chorizo" }],
      kcalOf,
    )!;
    expect(a).toBe(-340);
    expect(absorbsTooLittle(a, -300)).toBe(false);
    expect(absorbsTooLittle(a, 300)).toBe(true);
  });

  it("sin cifra de algún plato no se mide", () => {
    expect(
      absorbedKcal([{ before: "Lentejas con chorizo", after: "Algo nuevo" }], kcalOf),
    ).toBeNull();
  });

  it("la tarjeta dice lo que se midió, con o sin cifras", () => {
    expect(absorbedNote({ absorbedKcal: 347, kcal: 400 }, true)).toBe(
      "He movido unas 350 kcal de tus próximos días.",
    );
    expect(absorbedNote({ absorbedKcal: 347, kcal: 400 }, false)).toBe(
      "He aligerado un poco tus próximas comidas.",
    );
    expect(absorbedNote({ absorbedKcal: 80, kcal: 400, partial: true }, true)).toBe(
      "He ajustado una parte; el resto no lo persigo.",
    );
    expect(absorbedNote({ kcal: 400 }, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reserva y liberación (`settleDay`): la garantía de no compensar dos veces
// ---------------------------------------------------------------------------

describe("reserveDay / releaseDay", () => {
  type Books = Parameters<typeof reserveDay>[0];
  const apply = (row: Books, patch: Partial<Books>): Books => ({ ...row, ...patch });
  const pendingOf = (row: Books) => {
    const b = dayBalance(row.habits, row.snacks, row.exercise);
    return { kcal: b.pending, protein: b.proteinPending };
  };
  const day = (): Books => ({
    habits: [
      habit("Desayuno"),
      changed("Comida", 250),
      changed("Cena", 120, true), // ya compensada en una pasada anterior
      habit("Merienda", { status: "distinto", swapProteinDelta: -25, swapCompensated: false }),
    ],
    snacks: snacks(300, 100),
    exercise: exercise(200),
  });

  it("reserva los tres libros: tras aplicarla no queda nada pendiente", () => {
    const row = day();
    const before = pendingOf(row);
    const { patch, reservation } = reserveDay(row);
    expect(reservation).toEqual({
      labels: ["Comida", "Merienda"],
      snackKcal: 200,
      exerciseKcal: 200,
      total: before.kcal,
      protein: before.protein,
    });
    expect(pendingOf(apply(row, patch))).toEqual({ kcal: 0, protein: 0 });
  });

  it("marca solo las comidas cambiadas sin compensar (también las de solo proteína)", () => {
    const { patch } = reserveDay(day());
    expect(patch.habits?.map((h) => [h.label, h.swapCompensated])).toEqual([
      ["Desayuno", undefined],
      ["Comida", true],
      ["Cena", true],
      ["Merienda", true],
    ]);
  });

  it("sin nada pendiente: reserva vacía y ni picoteo ni deporte en el parche", () => {
    const row: Books = { habits: [habit("Comida")], snacks: snacks(300, 300), exercise: null };
    const { patch, reservation } = reserveDay(row);
    expect(reservation).toEqual({
      labels: [],
      snackKcal: 0,
      exerciseKcal: 0,
      total: 0,
      protein: 0,
    });
    expect(Object.keys(patch)).toEqual(["habits"]);
  });

  it("liberar devuelve el día a lo que estaba pendiente antes de reservar", () => {
    const row = day();
    const { patch, reservation } = reserveDay(row);
    const reserved = apply(row, patch);
    const released = apply(reserved, releaseDay(reserved, reservation));
    expect(pendingOf(released)).toEqual(pendingOf(row));
    expect(released.snacks?.compensatedKcal).toBe(100);
    expect(released.exercise?.compensatedKcal).toBe(0);
    // La cena ya compensada antes no formaba parte de la reserva: sigue compensada.
    expect(released.habits.find((h) => h.label === "Cena")?.swapCompensated).toBe(true);
  });

  it("liberar sobre la fila releída devuelve solo lo reservado: lo apuntado entre medias sigue pendiente", () => {
    const row = day();
    const { patch, reservation } = reserveDay(row);
    const reserved = apply(row, patch);
    // Mientras la IA trabajaba, se apuntan 150 kcal más de picoteo.
    const meanwhile: Books = {
      ...reserved,
      snacks: {
        entries: [
          ...(reserved.snacks?.entries ?? []),
          { ...(snacks(150).entries[0] as SnackEntry), id: "s2" },
        ],
        compensatedKcal: reserved.snacks?.compensatedKcal ?? 0,
      },
    };
    const released = apply(meanwhile, releaseDay(meanwhile, reservation));
    expect(pendingOf(released).kcal).toBe(pendingOf(row).kcal + 150);
  });
});
