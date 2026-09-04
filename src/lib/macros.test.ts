import { describe, expect, it } from "bun:test";

import type { MacroEstimate, MealMacroEstimate } from "./guide.functions";
import { ZERO_MACROS, macroTargets, sumDoneMacros } from "./macros";

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
