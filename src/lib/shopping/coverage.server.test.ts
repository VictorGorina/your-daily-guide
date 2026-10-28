import { describe, expect, it } from "bun:test";

import type { CanonicalRecipe } from "@/lib/nutrition/recipe";
import type { RecipeLookup } from "@/lib/nutrition/recipes.server";
import type { MonthlyPlan, PlanDay, ShoppingList } from "@/lib/plan-shared";
import {
  availableByDay,
  coverageReader,
  dishNeeds,
  editableDays,
  familyOfFood,
  markMealsOut,
  withMealsOut,
} from "./coverage.server";

// Noviembre de 2026: empieza en domingo; compras semanales 1-8 / 9-16 / 17-23 / 24-30.
const day = (lunch: string, dinner: string, extra: Partial<PlanDay> = {}): PlanDay => ({
  day: "",
  lunch,
  dinner,
  ...extra,
});
const plan = (days: PlanDay[] = []): MonthlyPlan => ({
  intro: "",
  focus: [],
  weeks: Array.from({ length: 5 }, (_, wi) => ({
    label: `Semana ${wi + 1}`,
    focus: "",
    breakfasts: [],
    snacks: [],
    days: Array.from({ length: 7 }, (_, di) => days[wi * 7 + di] ?? day("", "")),
  })),
  coverage: { fromDay: 1, toDay: 30 },
  cadence: "semanal",
});

const recipe = (ingredients: [string, number][]): CanonicalRecipe => ({
  dishKey: "",
  dishLabel: "",
  ingredients: ingredients.map(([foodKey, gramsRaw]) => ({
    foodKey,
    name: foodKey,
    gramsRaw,
    state: "crudo",
    confidence: "high",
  })),
  methods: [],
  servingKind: "plato",
  quality: 1,
  flags: [],
  pipelineVersion: 2,
  foodsVersion: "",
});
const lookups = (entries: [string, CanonicalRecipe][]): Map<string, RecipeLookup> =>
  new Map(
    entries.map(([dish, r]) => [
      dish,
      {
        dish,
        key: dish,
        recipe: r,
        textQuantity: null,
        vague: false,
        isFood: true,
        fromCache: true,
      },
    ]),
  );

describe("familyOfFood", () => {
  it("lo seco va con su cocido y los sustitutos van juntos", () => {
    expect(familyOfFood("lentejas-secas")).toBe(familyOfFood("lentejas"));
    expect(familyOfFood("muslo-pollo")).toBe(familyOfFood("pechuga-pollo"));
    expect(familyOfFood("yogur-griego")).toBe(familyOfFood("yogur-natural"));
    expect(familyOfFood("calabacin")).toBe("calabacin");
  });

  it("casa los nombres de la lista con la tabla, también congelados y conservas", () => {
    expect(coverageReader.familyOfItem("Pechuga de pollo congelada")).toBe(
      familyOfFood("pechuga-pollo"),
    );
    expect(coverageReader.familyOfItem("Lentejas pardina")).toBe(familyOfFood("lentejas"));
    expect(coverageReader.gramsOf("Calabacín", "ud", 2)).toBe(500);
    expect(coverageReader.gramsOf("Atún en lata", "ud", 2)).toBeNull();
    expect(coverageReader.newItem("pera")?.name).toBe("Pera");
  });
});

describe("dishNeeds", () => {
  const recipes = lookups([
    [
      "Crema de calabacín",
      recipe([
        ["calabacin", 250],
        ["aceite-oliva", 10],
        ["sal", 1],
      ]),
    ],
    [
      "Pollo con pera",
      recipe([
        ["pechuga-pollo", 150],
        ["pera", 180],
      ]),
    ],
  ]);
  // Martes 3 de noviembre: la fila 0, posición 1 (martes).
  const p = plan([day("", ""), day("Pollo con pera", "Crema de calabacín", { out: ["comida"] })]);
  const shared = () => ({});
  const servings = { shared: { desayuno: 0, comida: 0, cena: 0 }, plannerSolo: 1 };

  it("pide lo de cada plato futuro, sin lo básico ni lo que se come fuera", () => {
    const needs = dishNeeds({
      plan: p,
      month: "2026-11",
      after: "2026-10-27",
      selected: ["comida", "cena"],
      shared,
      servings,
      recipes,
    });
    expect(needs).toEqual([{ day: 3, family: "calabacin", grams: 250 }]);
  });

  it("una comida compartida pide las raciones de la casa", () => {
    const needs = dishNeeds({
      plan: p,
      month: "2026-11",
      after: "2026-10-27",
      selected: ["cena"],
      shared: () => ({ cena: { factor: 1, target: null } }),
      servings: { shared: { desayuno: 0, comida: 0, cena: 3 }, plannerSolo: 1 },
      recipes,
    });
    expect(needs).toEqual([{ day: 3, family: "calabacin", grams: 750 }]);
  });
});

describe("editableDays", () => {
  const list = (ownedTrips?: Record<number, "fridge" | "store">): ShoppingList => [
    {
      category: "Verdura y fruta",
      items: [
        {
          name: "Calabacín",
          qty: "",
          price_eur: 0,
          trip: 0,
          perishable: true,
          unit: "g",
          weekQty: [1, 1, 1, 1],
          weekPrice: [0, 0, 0, 0],
          ...(ownedTrips ? { ownedTrips } : {}),
        },
      ],
    },
  ];

  it("un mes futuro se puede tocar entero", () => {
    const editable = editableDays({
      plan: plan(),
      shopping: list(),
      month: "2026-11",
      today: "2026-10-27",
    });
    expect(editable(1, false)).toBe(true);
    expect(editable(30, false)).toBe(true);
  });

  it("no se toca una compra empezada ni una con marcas", () => {
    const editable = editableDays({
      plan: plan(),
      shopping: list({ 2: "fridge" }),
      month: "2026-11",
      today: "2026-11-10",
    });
    expect(editable(12, false)).toBe(false); // compra de los días 9-16, empezada
    expect(editable(20, false)).toBe(false); // compra de los días 17-23, con una marca
    expect(editable(26, false)).toBe(true);
  });

  it("en la optimizada, lo que se compra de una vez va en la primera compra", () => {
    const editable = editableDays({
      plan: { ...plan(), cadence: "optimizada" },
      shopping: list(),
      month: "2026-11",
      today: "2026-11-02",
    });
    expect(editable(26, true)).toBe(false);
    expect(editable(26, false)).toBe(true);
  });
});

describe("availableByDay", () => {
  it("lo fresco es de su compra; la despensa, desde que se compra; la despensa extra, siempre", () => {
    const list: ShoppingList = [
      {
        category: "Verdura y fruta",
        items: [
          {
            name: "Calabacín",
            qty: "",
            price_eur: 0,
            trip: 0,
            perishable: true,
            unit: "g",
            weekQty: [500, 0, 0, 0],
            weekPrice: [1, 0, 0, 0],
          },
        ],
      },
      {
        category: "Despensa",
        items: [
          {
            name: "Lentejas pardina",
            qty: "",
            price_eur: 0,
            trip: 0,
            perishable: false,
            unit: "g",
            weekQty: [500, 0, 0, 0],
            weekPrice: [1, 0, 0, 0],
          },
        ],
      },
    ];
    const at = availableByDay({ plan: plan(), shopping: list, month: "2026-11", pantry: ["Pera"] });
    expect(at(3).has("calabacin")).toBe(true);
    expect(at(20).has("calabacin")).toBe(false);
    expect(at(20).has(familyOfFood("lentejas"))).toBe(true);
    expect(at(20).has("pera")).toBe(true);
  });
});

describe("comidas que no se cocinan en casa", () => {
  it("se marcan sin tocar el plato", () => {
    const p = plan([day("", ""), day("Paella", "Crema de calabacín")]);
    const out = withMealsOut(p, [{ date: "2026-11-03", slot: "comida" }]);
    expect(out.weeks[0]!.days[1]!.out).toEqual(["comida"]);
    expect(out.weeks[0]!.days[1]!.lunch).toBe("Paella");
  });

  it("sin nada contado de comer fuera no se pregunta a nadie", async () => {
    const p = await markMealsOut({
      plan: plan(),
      month: "2026-11",
      after: "2026-10-27",
      constraints: {
        month: "2026-11",
        awayStart: null,
        awayEnd: null,
        notes: "Horario o rutina: Igual que siempre",
      },
      key: "",
      userId: "u",
      profile: null,
      homeText: "",
    });
    expect(p.outMarked).toBe(true);
  });
});
