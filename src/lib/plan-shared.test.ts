import { describe, expect, it } from "bun:test";

import {
  cadenceOf,
  cleanPlan,
  cleanShopping,
  cleanTripActuals,
  coverageRatio,
  groupByTrip,
  mealsForDate,
  mergeFuturePlan,
  type MonthlyPlan,
  monthCoverage,
  parseJsonLoose,
  boughtTotal,
  homeTotal,
  ownedTotal,
  pendingTotal,
  planForDate,
  repartitionTrips,
  shoppingTotal,
  type ShoppingList,
  tripActualsTotal,
  tripCount,
  tripDayRange,
} from "./plan-shared";

// --- helpers ---------------------------------------------------------------

const shopping = (): ShoppingList => [
  {
    category: "Fruta",
    items: [
      { name: "Manzana", qty: "1kg", price_eur: 2.0, trip: 0, perishable: true },
      { name: "Plátano", qty: "1kg", price_eur: 1.5, trip: 0, perishable: true, owned: "fridge" },
    ],
  },
  {
    category: "Cereales",
    items: [
      { name: "Arroz", qty: "1kg", price_eur: 1.2, trip: 0, perishable: false, owned: "store" },
    ],
  },
];

const day = (
  name: string,
  lunch: string,
  dinner: string,
  extra?: Partial<MonthlyPlan["weeks"][0]["days"][0]>,
) => ({
  day: name,
  lunch,
  dinner,
  ...extra,
});

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const plan = (overrides?: Partial<MonthlyPlan>): MonthlyPlan => ({
  intro: "intro",
  focus: ["foco"],
  weeks: Array.from({ length: 4 }, (_, wi) => ({
    label: `Semana ${wi + 1}`,
    focus: "",
    breakfasts: ["Avena", "Tostadas", "Yogur"],
    snacks: ["Fruta", "Frutos secos"],
    days: DAY_NAMES.map((n, di) => day(n, `Comida S${wi}D${di}`, `Cena S${wi}D${di}`)),
  })),
  ...overrides,
});

// --- cobertura del mes ----------------------------------------------------

describe("monthCoverage", () => {
  it("cubre de hoy a fin de mes en el mes en curso", () => {
    expect(monthCoverage("2026-08", "2026-08-14")).toEqual({ fromDay: 14, toDay: 31 });
  });

  it("cubre el mes entero si es un mes futuro", () => {
    expect(monthCoverage("2026-09", "2026-08-14")).toEqual({ fromDay: 1, toDay: 30 });
  });

  it("febrero de un año no bisiesto tiene 28 días", () => {
    expect(monthCoverage("2026-02", "2026-02-01")).toEqual({ fromDay: 1, toDay: 28 });
  });
});

describe("coverageRatio", () => {
  it("prorratea según los días cubiertos", () => {
    expect(coverageRatio({ fromDay: 14, toDay: 31 }, "2026-08")).toBeCloseTo(18 / 31, 5);
  });

  it("nunca pasa de 1", () => {
    expect(coverageRatio({ fromDay: 1, toDay: 31 }, "2026-08")).toBe(1);
  });
});

// --- reparto de tramos de compra ----------------------------------------

describe("tripDayRange", () => {
  // Regresión: antes el reparto redondeaba cada tramo hacia arriba y el último
  // acababa con un rango imposible ("días 32-31") al cubrir pocos días.
  it("no desborda el mes ni deja huecos con 9 días entre 4 compras", () => {
    const coverage = { fromDay: 1, toDay: 9 };
    const ranges = [0, 1, 2, 3].map((t) => tripDayRange(coverage, 4, t));

    for (const r of ranges) {
      expect(r.from).toBeGreaterThanOrEqual(coverage.fromDay);
      expect(r.to).toBeLessThanOrEqual(coverage.toDay);
      expect(r.to).toBeGreaterThanOrEqual(r.from);
    }
    // contiguo y completo: cada tramo empieza justo donde acaba el anterior
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.from).toBe(ranges[i - 1]!.to + 1);
    }
    expect(ranges[0]!.from).toBe(1);
    expect(ranges[3]!.to).toBe(9);
  });

  it("reparte un mes completo entre 4 compras sin solapes", () => {
    const ranges = [0, 1, 2, 3].map((t) => tripDayRange({ fromDay: 1, toDay: 31 }, 4, t));
    expect(ranges[0]).toEqual({ from: 1, to: 8 });
    expect(ranges[3]!.to).toBe(31);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.from).toBe(ranges[i - 1]!.to + 1);
    }
  });
});

describe("tripCount / cadenceOf", () => {
  it("cuenta los tramos por el trip más alto + 1", () => {
    expect(tripCount(shopping())).toBe(1);
  });

  it("deriva la cadencia del número de tramos", () => {
    expect(cadenceOf(null)).toBe("mensual");
    const cuatro: ShoppingList = [
      { category: "X", items: [{ name: "a", qty: "", price_eur: 1, trip: 3, perishable: true }] },
    ];
    expect(cadenceOf(cuatro)).toBe("semanal");
  });
});

describe("repartitionTrips", () => {
  it("manda la despensa a la primera compra y reparte los frescos", () => {
    const list: ShoppingList = [
      {
        category: "Varios",
        items: [
          { name: "Aceite", qty: "", price_eur: 5, trip: 0, perishable: false },
          { name: "Lechuga", qty: "", price_eur: 1, trip: 0, perishable: true },
          { name: "Tomate", qty: "", price_eur: 1, trip: 0, perishable: true },
          { name: "Pescado", qty: "", price_eur: 6, trip: 0, perishable: true },
        ],
      },
    ];
    const out = repartitionTrips(list, "bisemanal"); // 2 tramos
    const byName = Object.fromEntries(out[0]!.items.map((i) => [i.name, i.trip]));
    expect(byName["Aceite"]).toBe(0); // no perecedero → siempre tramo 0
    expect(byName["Lechuga"]).toBe(0);
    expect(byName["Tomate"]).toBe(1);
    expect(byName["Pescado"]).toBe(0);
  });

  it("con cadencia mensual todo va al tramo 0", () => {
    const out = repartitionTrips(shopping(), "mensual");
    expect(out.flatMap((g) => g.items).every((i) => i.trip === 0)).toBe(true);
  });
});

describe("groupByTrip", () => {
  it("mantiene los tramos vacíos para no perder 'semana 4 de 4'", () => {
    const groups = groupByTrip(shopping(), 4);
    expect(groups).toHaveLength(4);
    expect(groups[0]!.groups.length).toBeGreaterThan(0);
    expect(groups[3]!.groups).toHaveLength(0);
  });
});

// --- dinero -------------------------------------------------------------

describe("totales de la compra", () => {
  it("suma, redondea a céntimos y separa por estado", () => {
    const s = shopping();
    expect(shoppingTotal(s)).toBe(4.7);
    expect(ownedTotal(s)).toBe(2.7); // fridge + store
    expect(homeTotal(s)).toBe(1.5); // solo fridge
    expect(boughtTotal(s)).toBe(1.2); // solo store
    expect(pendingTotal(s)).toBe(2.0); // total - owned
    expect(homeTotal(s) + boughtTotal(s)).toBeCloseTo(ownedTotal(s), 5);
  });

  it("trata null como lista vacía", () => {
    expect(shoppingTotal(null)).toBe(0);
    expect(pendingTotal(undefined)).toBe(0);
  });
});

describe("cleanTripActuals / tripActualsTotal", () => {
  it("descarta claves y valores inválidos", () => {
    expect(cleanTripActuals({ "0": 12.5, "1": "8", "-1": 5, x: 3, "2": -4 })).toEqual({
      0: 12.5,
      1: 8,
    });
  });

  it("suma lo realmente gastado", () => {
    expect(tripActualsTotal({ 0: 12.5, 1: 8 })).toBe(20.5);
    expect(tripActualsTotal(null)).toBe(0);
  });
});

// --- parsers defensivos -----------------------------------------------

describe("parseJsonLoose", () => {
  it("parsea JSON limpio", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("tolera vallas ```json y texto alrededor", () => {
    expect(parseJsonLoose('aquí tienes:\n```json\n{"a":1,"b":2}\n```\ngracias')).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("cierra un JSON truncado a mitad", () => {
    expect(parseJsonLoose('{"a":1, "b":[2,3')).toEqual({ a: 1, b: [2, 3] });
  });

  it("devuelve null si no hay ningún objeto", () => {
    expect(parseJsonLoose("no hay json aquí")).toBeNull();
  });
});

describe("cleanShopping", () => {
  it("deja pasar una lista válida", () => {
    expect(cleanShopping(shopping())).toEqual(shopping());
  });

  it("descarta grupos sin categoría o sin artículos y artículos sin nombre", () => {
    const dirty = [
      { category: "", items: [{ name: "x", price_eur: 1, trip: 0 }] },
      { category: "Fruta", items: [{ name: "", price_eur: 1, trip: 0 }] },
      {
        category: "Verdura",
        items: [{ name: "Lechuga", price_eur: 1, trip: 0, perishable: true }],
      },
    ];
    const out = cleanShopping(dirty);
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("Verdura");
  });

  it("migra el 'owned' booleano antiguo a 'fridge'", () => {
    const out = cleanShopping([
      { category: "Fruta", items: [{ name: "Pera", price_eur: 1, trip: 0, owned: true }] },
    ]);
    expect(out[0]!.items[0]!.owned).toBe("fridge");
  });

  it("sanea precio y trip fuera de rango", () => {
    const out = cleanShopping([
      { category: "X", items: [{ name: "a", price_eur: -3, trip: 9, perishable: true }] },
    ]);
    expect(out[0]!.items[0]!.price_eur).toBe(0);
    expect(out[0]!.items[0]!.trip).toBe(3);
  });
});

describe("cleanPlan", () => {
  it("devuelve null sin semanas", () => {
    expect(cleanPlan({ weeks: [] })).toBeNull();
    expect(cleanPlan(null)).toBeNull();
  });

  it("recorta a 5 semanas y 7 días y coacciona los tipos", () => {
    const out = cleanPlan({
      intro: 123,
      weeks: Array.from({ length: 8 }, () => ({
        label: "S",
        days: Array.from({ length: 10 }, () => ({ day: "L", lunch: "x", dinner: "y" })),
      })),
    });
    expect(out!.weeks).toHaveLength(5);
    expect(out!.weeks[0]!.days).toHaveLength(7);
    expect(out!.intro).toBe("123");
  });
});

// --- lectura del plan por fecha --------------------------------------

describe("planForDate / mealsForDate", () => {
  it("un plato pedido a mano para un día manda sobre la rotación semanal", () => {
    // 2026-08-05 es miércoles → semana 0, día "Miércoles"
    const p = plan();
    p.weeks[0]!.days[2] = day("Miércoles", "Lentejas", "Tortilla", {
      breakfast: "Tostada con tomate",
    });

    const meals = mealsForDate(p, "2026-08-05");
    const desayuno = meals.find((m) => m.slot === "desayuno");
    expect(desayuno!.idea).toBe("Tostada con tomate");
  });

  it("sin plato a mano, el desayuno rota entre las opciones de la semana", () => {
    const meals = mealsForDate(plan(), "2026-08-05");
    const desayuno = meals.find((m) => m.slot === "desayuno");
    expect(["Avena", "Tostadas", "Yogur"]).toContain(desayuno!.idea);
  });

  it("comida y cena salen del día exacto del plan", () => {
    const found = planForDate(plan(), "2026-08-05");
    expect(found!.day!.lunch).toBe("Comida S0D2");
  });
});

// --- fusión de un plan recolocado ----------------------------------

describe("mergeFuturePlan", () => {
  it("conserva un plato pedido a mano en un día futuro tras una recolocación", () => {
    const current = plan();
    current.weeks[0]!.days[4] = day("Viernes", "A", "B", { breakfast: "Tostadas caseras" });
    current.weeks[1]!.days[0] = day("Lunes", "C", "D", { snack: "Nueces" });

    // El plan nuevo de la IA solo trae lunch/dinner, nunca breakfast/snack
    const next = plan({
      weeks: plan().weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => day(d.day, `NUEVO ${d.lunch}`, `NUEVO ${d.dinner}`)),
      })),
    });

    const merged = mergeFuturePlan(current, next, { weekIndex: 0, dayIndex: 2 });

    // día futuro de la semana en curso: adopta lunch/dinner nuevos, mantiene el desayuno a mano
    expect(merged.weeks[0]!.days[4]!.breakfast).toBe("Tostadas caseras");
    expect(merged.weeks[0]!.days[4]!.lunch).toBe(next.weeks[0]!.days[4]!.lunch);
    expect(merged.weeks[0]!.days[4]!.lunch).not.toBe("A"); // ya no es el del plan viejo

    // semana futura: igual, el snack a mano sobrevive
    expect(merged.weeks[1]!.days[0]!.snack).toBe("Nueces");
    expect(merged.weeks[1]!.days[0]!.lunch).toBe(next.weeks[1]!.days[0]!.lunch);
  });

  it("no toca los días de hoy o antes", () => {
    const current = plan();
    const next = plan({
      weeks: plan().weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => day(d.day, `NUEVO ${d.lunch}`, `NUEVO ${d.dinner}`)),
      })),
    });

    const merged = mergeFuturePlan(current, next, { weekIndex: 0, dayIndex: 2 });

    // día 1 de la semana 0 (di=1 <= cursor.dayIndex=2) queda intacto
    expect(merged.weeks[0]!.days[1]!.lunch).toBe("Comida S0D1");
  });
});
