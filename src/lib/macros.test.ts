import { describe, expect, it } from "bun:test";

import type { DailyLog } from "./daily";
import type { MacroEstimate, MealMacroEstimate } from "./guide.functions";
import {
  ZERO_MACROS,
  addMacros,
  daySignal,
  daySignalOf,
  hasDayRecord,
  macroTargets,
  donePendingMeals,
  guideReuse,
  isMealCalculated,
  mealsToRecalculate,
  mergeGuide,
  perMealDeltas,
  showsNutritionNumbers,
  sumDoneMacros,
} from "./macros";

// ---------------------------------------------------------------------------
// sumDoneMacros — suma las macros de las comidas ya marcadas como comidas
// ---------------------------------------------------------------------------

describe("sumDoneMacros", () => {
  const meal = (
    moment: string,
    kcal: number,
    protein: number,
    carbs: number,
    fat: number,
    fiber: number,
  ): MealMacroEstimate => ({
    moment,
    kcal,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    fiber_g: fiber,
  });

  const desayuno = meal("Desayuno", 400, 20, 50, 12, 6);
  const comida = meal("Comida", 650, 35, 70, 22, 8);
  const cena = meal("Cena", 500, 30, 45, 18, 7);
  const snack = meal("Snack", 150, 8, 15, 5, 2);
  const allMeals: MealMacroEstimate[] = [desayuno, comida, cena, snack];

  it("devuelve null sin mealMacros", () => {
    expect(sumDoneMacros(null, [])).toBeNull();
    expect(sumDoneMacros(undefined, [])).toBeNull();
    expect(sumDoneMacros([], [])).toBeNull();
  });

  it("devuelve ceros si ninguna comida está marcada como comida", () => {
    const habits = [
      { label: "Desayuno", done: false },
      { label: "Comida", done: false },
    ];
    const result = sumDoneMacros(allMeals, habits);
    expect(result).toEqual(ZERO_MACROS);
  });

  it('suma solo las comidas con status "plan"', () => {
    const habits = [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: false },
      { label: "Cena", done: false },
      { label: "Snack", done: false },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    expect(result.kcal).toBe(desayuno.kcal);
    expect(result.protein_g).toBe(desayuno.protein_g);
    expect(result.carbs_g).toBe(desayuno.carbs_g);
    expect(result.fat_g).toBe(desayuno.fat_g);
    expect(result.fiber_g).toBe(desayuno.fiber_g);
  });

  it('suma las comidas con status "distinto"', () => {
    const habits = [
      { label: "Desayuno", done: true, status: "distinto" as const },
      { label: "Comida", done: false },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    expect(result.kcal).toBe(desayuno.kcal);
    expect(result.protein_g).toBe(desayuno.protein_g);
  });

  it('no suma comidas con status "salteo" (saltadas)', () => {
    const habits = [
      { label: "Desayuno", done: false, status: "salteo" as const },
      { label: "Comida", done: true, status: "plan" as const },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    // Desayuno saltado → no suma; solo Comida
    expect(result.kcal).toBe(comida.kcal);
    expect(result.protein_g).toBe(comida.protein_g);
  });

  it("suma varias comidas marcadas", () => {
    const habits = [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: true, status: "distinto" as const },
      { label: "Cena", done: true, status: "plan" as const },
      { label: "Snack", done: false },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    expect(result.kcal).toBe(desayuno.kcal + comida.kcal + cena.kcal);
    expect(result.protein_g).toBe(desayuno.protein_g + comida.protein_g + cena.protein_g);
    expect(result.carbs_g).toBe(desayuno.carbs_g + comida.carbs_g + cena.carbs_g);
    expect(result.fat_g).toBe(desayuno.fat_g + comida.fat_g + cena.fat_g);
    expect(result.fiber_g).toBe(desayuno.fiber_g + comida.fiber_g + cena.fiber_g);
  });

  it("suma las cuatro comidas cuando todas están confirmadas", () => {
    const habits = [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: true, status: "plan" as const },
      { label: "Cena", done: true, status: "plan" as const },
      { label: "Snack", done: true, status: "plan" as const },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    const total = allMeals.reduce(
      (acc, m) => ({
        kcal: acc.kcal + m.kcal,
        protein_g: acc.protein_g + m.protein_g,
        carbs_g: acc.carbs_g + m.carbs_g,
        fat_g: acc.fat_g + m.fat_g,
        fiber_g: acc.fiber_g + m.fiber_g,
      }),
      { ...ZERO_MACROS },
    );
    expect(result).toEqual(total);
  });

  it("ignora un habit cuyo label no tiene mealMacros correspondiente", () => {
    // Si hay un habit "Merienda" pero mealMacros solo tiene "Snack", no suma
    const habits = [
      { label: "Merienda", done: true, status: "plan" as const },
      { label: "Comida", done: true, status: "plan" as const },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    expect(result.kcal).toBe(comida.kcal);
  });

  it("no suma un mealMacros fantasma que no tiene habit", () => {
    // mealMacros tiene 4 entradas pero habits solo tiene 2 marcadas
    const habits = [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: true, status: "plan" as const },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    expect(result.kcal).toBe(desayuno.kcal + comida.kcal);
    // Cena y Snack no se suman aunque existan en mealMacros
  });

  it("habits sin status pero con done no cuentan como comidas", () => {
    // Un habit con done:true pero sin status explícito (p.ej. un hábito antiguo)
    // no se suma, porque sumDoneMacros filtra por status, no por done
    const habits = [
      { label: "Desayuno", done: true },
      { label: "Comida", done: true, status: "plan" as const },
    ];
    const result = sumDoneMacros(allMeals, habits)!;
    // Desayuno no tiene status → no se suma
    expect(result.kcal).toBe(comida.kcal);
  });

  it("deshacer una comida (quitar status) la resta de la suma", () => {
    // Escenario: el usuario marca comida y luego deshace
    const before = sumDoneMacros(allMeals, [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: true, status: "plan" as const },
    ])!;
    const after = sumDoneMacros(allMeals, [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: false }, // deshecho: sin status
    ])!;
    expect(before.kcal).toBe(desayuno.kcal + comida.kcal);
    expect(after.kcal).toBe(desayuno.kcal);
  });

  it("macros actualizadas tras cambiar un plato reflejan el plato nuevo", () => {
    // Simula el flujo de cambiar_plato: mealMacros se regenera con los macros
    // del plato nuevo. El label ("Comida") permanece igual.
    const oldMacros: MealMacroEstimate[] = [
      meal("Desayuno", 400, 20, 50, 12, 6),
      meal("Comida", 650, 35, 70, 22, 8), // plato original
      meal("Cena", 500, 30, 45, 18, 7),
    ];
    const newMacros: MealMacroEstimate[] = [
      meal("Desayuno", 400, 20, 50, 12, 6),
      meal("Comida", 480, 40, 30, 15, 10), // plato nuevo (más proteína, menos kcal)
      meal("Cena", 500, 30, 45, 18, 7),
    ];

    const habits = [
      { label: "Desayuno", done: true, status: "plan" as const },
      { label: "Comida", done: true, status: "distinto" as const },
      { label: "Cena", done: false },
    ];

    const resultOld = sumDoneMacros(oldMacros, habits)!;
    const resultNew = sumDoneMacros(newMacros, habits)!;

    // Con el plato viejo
    expect(resultOld.kcal).toBe(400 + 650);
    expect(resultOld.protein_g).toBe(20 + 35);
    // Con el plato nuevo
    expect(resultNew.kcal).toBe(400 + 480);
    expect(resultNew.protein_g).toBe(20 + 40);
  });
});

// ---------------------------------------------------------------------------
// macroTargets — referencia genérica de respaldo sin guía
// ---------------------------------------------------------------------------

describe("macroTargets", () => {
  it("ajusta proteína a ~1.2g/kg del peso", () => {
    const t = macroTargets(70);
    expect(t.protein_g).toBe(84); // 70 × 1.2 = 84
  });

  it("usa 70 kg como fallback si el peso es null", () => {
    const t = macroTargets(null);
    expect(t.protein_g).toBe(84); // 70 × 1.2 = 84
  });

  it("topa la proteína en 200g para pesos muy altos", () => {
    const t = macroTargets(200);
    expect(t.protein_g).toBe(200); // 200 × 1.2 = 240, pero capped a 200
  });

  it("fija un suelo de 45g de proteína para pesos muy bajos", () => {
    const t = macroTargets(30);
    expect(t.protein_g).toBe(45); // 30 × 1.2 = 36, pero floor a 45
  });

  it("siempre devuelve los mismos valores fijos de carbohidratos, grasa y fibra", () => {
    const t = macroTargets(80);
    expect(t.carbs_g).toBe(250);
    expect(t.fat_g).toBe(70);
    expect(t.fiber_g).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// ZERO_MACROS — constante de inicio
// ---------------------------------------------------------------------------

describe("ZERO_MACROS", () => {
  it("es todo ceros", () => {
    expect(ZERO_MACROS).toEqual({
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      fiber_g: 0,
    });
  });

  it("se puede usar como valor inicial en un reduce", () => {
    const meals: MacroEstimate[] = [
      { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 3 },
      { kcal: 200, protein_g: 20, carbs_g: 30, fat_g: 10, fiber_g: 4 },
    ];
    const total = meals.reduce(
      (acc, m) => ({
        kcal: acc.kcal + m.kcal,
        protein_g: acc.protein_g + m.protein_g,
        carbs_g: acc.carbs_g + m.carbs_g,
        fat_g: acc.fat_g + m.fat_g,
        fiber_g: acc.fiber_g + m.fiber_g,
      }),
      { ...ZERO_MACROS },
    );
    expect(total).toEqual({ kcal: 300, protein_g: 30, carbs_g: 50, fat_g: 15, fiber_g: 7 });
  });
});

// ---------------------------------------------------------------------------
// perMealDeltas — el desvío por comida (kcal y proteína) que acumula settleDay
// ---------------------------------------------------------------------------

describe("perMealDeltas", () => {
  const macro = (
    moment: string,
    kcal: number,
    protein = 0,
    extra: Partial<MealMacroEstimate> = {},
  ): MealMacroEstimate => ({
    moment,
    kcal,
    protein_g: protein,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    ...extra,
  });

  it("da una cifra por cada comida cambiada del lote, en kcal y proteína", () => {
    const { resolved, unresolved } = perMealDeltas(
      [
        { label: "Comida", prevKcal: 600, prevProtein: 30 },
        { label: "Cena", prevKcal: 500, prevProtein: 25 },
      ],
      [macro("Comida", 1100, 40), macro("Cena", 900, 20), macro("Desayuno", 300)],
    );
    // El desayuno no se tocó y no aparece.
    expect(resolved).toEqual([
      { label: "Comida", kcalDelta: 500, proteinDelta: 10 },
      { label: "Cena", kcalDelta: 400, proteinDelta: -5 },
    ]);
    expect(unresolved).toEqual([]);
  });

  it("da negativo cuando se ha comido menos de lo previsto", () => {
    expect(
      perMealDeltas([{ label: "Cena", prevKcal: 800 }], [macro("Cena", 450)]).resolved,
    ).toEqual([{ label: "Cena", kcalDelta: -350, proteinDelta: null }]);
  });

  it("sin cifra de antes o de después, la comida queda pendiente: nunca un cero", () => {
    const { resolved, unresolved } = perMealDeltas(
      [
        { label: "Cena", prevKcal: null },
        { label: "Comida", prevKcal: 400 },
        { label: "Desayuno", prevKcal: 300 },
      ],
      [macro("Comida", 700), macro("Cena", 900)],
    );
    expect(resolved).toEqual([{ label: "Comida", kcalDelta: 300, proteinDelta: null }]);
    expect(unresolved).toEqual(["Cena", "Desayuno"]);
  });

  it("si fallan los dos modelos el plato queda `calculando`: no suma ni genera desvío (D13)", () => {
    const calculando = macro("Cena", 0, 0, { idea: "Pizza", status: "calculando" });
    const { resolved, unresolved } = perMealDeltas(
      [{ label: "Cena", prevKcal: 500, prevProtein: 25 }],
      [calculando],
    );
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual(["Cena"]);
    const habits = [{ label: "Cena", done: true, status: "distinto" as const }];
    expect(sumDoneMacros([calculando], habits)).toEqual(ZERO_MACROS);
    expect(donePendingMeals([calculando], habits)).toEqual(["Cena"]);
  });

  it("una cifra manual solo trae kcal: la proteína no se sabe y no decide", () => {
    const manual = macro("Cena", 700, 0, { idea: "algo rápido", manual: true });
    expect(
      perMealDeltas([{ label: "Cena", prevKcal: 500, prevProtein: 30 }], [manual]).resolved,
    ).toEqual([{ label: "Cena", kcalDelta: 200, proteinDelta: null }]);
  });
});

describe("estado calculado / calculando", () => {
  const meal = (extra: Partial<MealMacroEstimate>): MealMacroEstimate => ({
    moment: "Comida",
    idea: "Lentejas",
    kcal: 400,
    protein_g: 20,
    carbs_g: 50,
    fat_g: 8,
    fiber_g: 10,
    ...extra,
  });

  it("una guía antigua sin `status` cuenta como calculada", () => {
    expect(isMealCalculated(meal({}))).toBe(true);
    expect(isMealCalculated(meal({ status: "calculando" }))).toBe(false);
  });

  it("solo se reintenta lo que está calculando y no es vago", () => {
    const list = [
      meal({ moment: "Comida", status: "calculando" }),
      meal({ moment: "Cena", status: "calculando", vague: true }),
      meal({ moment: "Desayuno" }),
    ];
    expect(mealsToRecalculate(list).map((m) => m.moment)).toEqual(["Comida"]);
  });

  it("`reuse` manda lo ya calculado y la cifra manual, nunca lo que está calculando", () => {
    const reuse = guideReuse(
      [meal({ moment: "Comida" }), meal({ moment: "Cena", status: "calculando" })],
      [
        {
          label: "Cena",
          done: true,
          status: "distinto",
          confirmedIdea: "algo rápido",
          manualKcal: 650,
        },
      ],
    );
    expect(reuse.map((m) => [m.moment, m.idea, m.kcal, m.manual ?? false])).toEqual([
      ["Cena", "algo rápido", 650, true],
      ["Comida", "Lentejas", 400, false],
    ]);
  });

  it("un reintento que vuelve calculando no borra la cifra que ya tenía el mismo plato", () => {
    const prev = { macroEstimate: null, mealMacros: [meal({})] };
    const merged = mergeGuide(prev, { mealMacros: [meal({ kcal: 0, status: "calculando" })] });
    expect(merged.mealMacros?.[0].kcal).toBe(400);
    // Un plato distinto sí sustituye (el de antes ya no describe la comida).
    const other = mergeGuide(prev, {
      mealMacros: [meal({ idea: "Pizza", kcal: 0, status: "calculando" })],
    });
    expect(other.mealMacros?.[0]).toMatchObject({ idea: "Pizza", status: "calculando" });
  });

  it("el semáforo no juzga un día con comidas marcadas por calcular", () => {
    const log = {
      habits: [{ label: "Comida", done: true, status: "plan" as const }],
      guide: {
        macroEstimate: { kcal: 2000, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
        mealMacros: [meal({ status: "calculando", kcal: 0 })],
      },
    } as never;
    expect(daySignalOf(log)).toBe("muted");
  });
});

// ---------------------------------------------------------------------------
// addMacros — comidas marcadas + picoteo del día
// ---------------------------------------------------------------------------

describe("addMacros", () => {
  it("suma campo a campo sin mutar las entradas", () => {
    const a: MacroEstimate = { kcal: 900, protein_g: 40, carbs_g: 90, fat_g: 30, fiber_g: 10 };
    const b: MacroEstimate = { kcal: 175, protein_g: 6, carbs_g: 6, fat_g: 15, fiber_g: 3 };
    expect(addMacros(a, b)).toEqual({
      kcal: 1075,
      protein_g: 46,
      carbs_g: 96,
      fat_g: 45,
      fiber_g: 13,
    });
    expect(a.kcal).toBe(900);
    expect(addMacros(ZERO_MACROS, b)).toEqual(b);
  });
});

describe("daySignal", () => {
  it("verde dentro del ±10 % del objetivo", () => {
    expect(daySignal(2000, 2000, true)).toBe("success");
    expect(daySignal(2200, 2000, true)).toBe("success");
    expect(daySignal(1800, 2000, true)).toBe("success");
  });

  it("ámbar si se desvía, por arriba o por abajo", () => {
    expect(daySignal(2300, 2000, true)).toBe("warning");
    expect(daySignal(1500, 2000, true)).toBe("warning");
    expect(daySignal(600, 2000, true)).toBe("warning");
  });

  // Decisión del usuario (2026-09-20): rojo solo "si te lo petas mucho".
  it("rojo solo pasándose de largo, nunca por quedarse corto", () => {
    expect(daySignal(2600, 2000, true)).toBe("over");
    expect(daySignal(4000, 2000, true)).toBe("over");
    expect(daySignal(0, 2000, true)).toBe("warning");
  });

  it("un día sin registro es neutro, no un fallo", () => {
    expect(daySignal(0, 2000, false)).toBe("none");
    expect(daySignal(3000, 2000, false)).toBe("none");
  });

  it("un día registrado sin objetivo no se juzga", () => {
    expect(daySignal(1800, null, true)).toBe("muted");
    expect(daySignal(1800, 0, true)).toBe("muted");
  });
});

describe("daySignalOf / hasDayRecord", () => {
  const guide = (kcal: number, perMeal: number) => ({
    intro: "",
    calories: "",
    macros: "",
    macroEstimate: { kcal, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    mealMacros: [
      { moment: "Comida", kcal: perMeal, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
    ],
    behaviors: [],
    meals: [],
    tips: [],
  });

  it("suma el picoteo al juzgar el día", () => {
    const base = {
      habits: [{ label: "Comida", done: true, status: "plan" as const }],
      guide: guide(1000, 1000),
    } as unknown as DailyLog;
    expect(daySignalOf(base)).toBe("success");

    const conPicoteo = {
      ...base,
      snacks: {
        entries: [
          {
            id: "a",
            text: "bollos",
            at: "2026-09-20T18:00:00Z",
            kcal: 600,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
            fiber_g: 0,
          },
        ],
      },
    } as unknown as DailyLog;
    expect(daySignalOf(conPicoteo)).toBe("over");
  });

  it("una comida sin resolver no cuenta como registro", () => {
    const sinTocar = { habits: [{ label: "Comida", done: false }] } as unknown as DailyLog;
    expect(hasDayRecord(sinTocar)).toBe(false);
    expect(daySignalOf(sinTocar)).toBe("none");
  });
});

describe("mergeGuide", () => {
  // La forma que `mergeGuide` lee (su `GuideNumbers`). Sin darla explícita, `T`
  // se infiere del literal y `{ macroEstimate: null }` tiparía el resultado como
  // `null` aunque en ejecución devuelva la cifra de `prev`.
  type Numbers = {
    intro?: string;
    macroEstimate?: MacroEstimate | null;
    mealMacros?: MealMacroEstimate[] | null;
  };
  const macros = (kcal: number): MacroEstimate => ({
    kcal,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
  });
  const meal = (kcal: number): MealMacroEstimate => ({ moment: "Comida", ...macros(kcal) });

  it("una guía de respaldo sin cifras no borra las que había", () => {
    const prev = { macroEstimate: macros(2000), mealMacros: [meal(600)] };
    const merged = mergeGuide<Numbers>(prev, { intro: "x", macroEstimate: null, mealMacros: null });
    expect(merged.macroEstimate).toEqual(macros(2000));
    expect(merged.mealMacros).toEqual([meal(600)]);
    expect(merged.intro).toBe("x");
  });

  it("si la nueva trae cifras, mandan ellas", () => {
    const prev = { macroEstimate: macros(2000), mealMacros: [meal(600)] };
    const merged = mergeGuide(prev, { macroEstimate: macros(1700), mealMacros: [meal(450)] });
    expect(merged.macroEstimate).toEqual(macros(1700));
    expect(merged.mealMacros).toEqual([meal(450)]);
  });

  it("sin guía previa se queda con lo que venga", () => {
    expect(mergeGuide(null, { macroEstimate: null, mealMacros: null }).macroEstimate).toBeNull();
    expect(mergeGuide(undefined, { macroEstimate: macros(1200) }).macroEstimate).toEqual(
      macros(1200),
    );
  });

  it("una lista de platos vacía cuenta como «sin cifras»", () => {
    const prev = { macroEstimate: macros(2000), mealMacros: [meal(600)] };
    expect(mergeGuide<Numbers>(prev, { mealMacros: [] }).mealMacros).toEqual([meal(600)]);
  });
});

describe("showsNutritionNumbers — la preferencia de ver cifras (ticket 01)", () => {
  it("solo 'ocultar' esconde las cifras", () => {
    expect(showsNutritionNumbers({ nutrition_numbers: "ocultar" })).toBe(false);
    expect(showsNutritionNumbers({ nutrition_numbers: "mostrar" })).toBe(true);
  });

  it("sin perfil, sin valor o sin la columna todavía, se enseña como hasta ahora", () => {
    expect(showsNutritionNumbers(null)).toBe(true);
    expect(showsNutritionNumbers(undefined)).toBe(true);
    expect(showsNutritionNumbers({})).toBe(true);
    expect(showsNutritionNumbers({ nutrition_numbers: null })).toBe(true);
  });

  it("no se deduce de ningún otro dato (D3): ed_history no cuenta", () => {
    expect(
      showsNutritionNumbers({ nutrition_numbers: "mostrar", ed_history: "activa" } as never),
    ).toBe(true);
  });
});
