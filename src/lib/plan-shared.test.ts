import { describe, expect, it } from "bun:test";

import type { SharedSlots } from "./household-shared";
import {
  addMonths,
  cadenceOf,
  carryOwnedByName,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  cleanTripActuals,
  cleanTripReceipts,
  composeDayForUser,
  composeMonthlyPlanForMember,
  coverageRatio,
  daysLeftInMonth,
  formatQty,
  groupByTrip,
  isBeforeAppStart,
  isCanonicalShopping,
  isMonthActionable,
  isNextMonthUnlocked,
  mealsForDate,
  mergeFuturePlan,
  type MonthlyPlan,
  monthCoverage,
  nextMonthISO,
  normalizeUnit,
  parseJsonLoose,
  parseQtyLegacy,
  planMonthStatus,
  planNavBounds,
  boughtTotal,
  homeTotal,
  ownedTotal,
  pendingTotal,
  planForDate,
  projectTrips,
  repartitionTrips,
  shoppingTotal,
  type ShoppingList,
  tripActualsTotal,
  tripCount,
  tripDayRange,
  weekDayCounts,
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

// --- navegación de meses ------------------------------------------------

describe("addMonths", () => {
  it("cruza de año hacia delante y hacia atrás", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-08", 0)).toBe("2026-08");
  });
});

describe("daysLeftInMonth / nextMonthISO", () => {
  it("cuenta hoy incluido", () => {
    expect(daysLeftInMonth("2026-08-31")).toBe(1);
    expect(daysLeftInMonth("2026-08-25")).toBe(7);
    expect(daysLeftInMonth("2026-02-01")).toBe(28);
  });

  it("da el mes siguiente al de la fecha", () => {
    expect(nextMonthISO("2026-08-25")).toBe("2026-09");
    expect(nextMonthISO("2026-12-10")).toBe("2027-01");
  });
});

describe("isNextMonthUnlocked", () => {
  it("se desbloquea a 7 días o menos de fin de mes", () => {
    expect(isNextMonthUnlocked("2026-08-23")).toBe(false); // quedan 9
    expect(isNextMonthUnlocked("2026-08-24")).toBe(false); // quedan 8
    expect(isNextMonthUnlocked("2026-08-25")).toBe(true); // quedan 7
    expect(isNextMonthUnlocked("2026-08-31")).toBe(true); // queda 1
  });
});

describe("planMonthStatus / isMonthActionable", () => {
  const today = "2026-08-10"; // quedan 22 días → mes+1 bloqueado

  it("clasifica los cinco estados", () => {
    expect(planMonthStatus("2026-07", today)).toBe("past");
    expect(planMonthStatus("2026-08", today)).toBe("current");
    expect(planMonthStatus("2026-09", today)).toBe("next-locked");
    expect(planMonthStatus("2026-10", today)).toBe("far-future");
    expect(planMonthStatus("2026-09", "2026-08-28")).toBe("next-unlocked");
  });

  it("solo el actual y el siguiente desbloqueado son accionables", () => {
    expect(isMonthActionable("2026-08", today)).toBe(true);
    expect(isMonthActionable("2026-09", today)).toBe(false);
    expect(isMonthActionable("2026-09", "2026-08-28")).toBe(true);
    expect(isMonthActionable("2026-07", today)).toBe(false);
  });
});

describe("planNavBounds", () => {
  it("sin fecha de alta, el suelo es el mes en curso", () => {
    expect(planNavBounds("2026-08-10", null)).toEqual({ earliest: "2026-08", latest: "2026-08" });
  });

  it("la fecha de alta baja el suelo hasta su mes", () => {
    expect(planNavBounds("2026-08-10", "2026-05-14").earliest).toBe("2026-05");
  });

  it("una fecha de alta futura o del mes en curso no sube el suelo", () => {
    expect(planNavBounds("2026-08-10", "2026-08-01").earliest).toBe("2026-08");
  });

  it("el techo sube al mes que viene solo cuando está desbloqueado", () => {
    expect(planNavBounds("2026-08-10", null).latest).toBe("2026-08");
    expect(planNavBounds("2026-08-28", null).latest).toBe("2026-09");
  });
});

describe("isBeforeAppStart", () => {
  it("marca los días anteriores a la fecha de alta", () => {
    expect(isBeforeAppStart("2026-05-10", "2026-05-14")).toBe(true);
    expect(isBeforeAppStart("2026-05-14", "2026-05-14")).toBe(false);
    expect(isBeforeAppStart("2026-05-20", "2026-05-14")).toBe(false);
    expect(isBeforeAppStart("2026-05-01", null)).toBe(false);
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

describe("carryOwnedByName", () => {
  const prev: ShoppingList = [
    {
      category: "Fruta",
      items: [
        { name: "Plátano", qty: "", price_eur: 1.5, trip: 0, perishable: true, owned: "fridge" },
        { name: "Manzana", qty: "", price_eur: 1, trip: 0, perishable: true },
      ],
    },
    {
      category: "Despensa",
      items: [
        { name: "Arroz", qty: "", price_eur: 1.2, trip: 0, perishable: false, owned: "store" },
      ],
    },
  ];

  it("reaplica 'owned' por nombre aunque el ingrediente se haya troceado en varias compras", () => {
    const next: ShoppingList = [
      {
        category: "Fruta",
        items: [
          { name: "plátano", qty: "", price_eur: 0.75, trip: 0, perishable: true },
          { name: "plátano", qty: "", price_eur: 0.75, trip: 1, perishable: true },
          { name: "Manzana", qty: "", price_eur: 1, trip: 0, perishable: true },
        ],
      },
      {
        category: "Despensa",
        items: [{ name: "Arroz", qty: "", price_eur: 1.2, trip: 0, perishable: false }],
      },
    ];
    const out = carryOwnedByName(prev, next);
    const platano = out[0]!.items.filter((i) => i.name === "plátano");
    expect(platano.every((i) => i.owned === "fridge")).toBe(true);
    expect(out[0]!.items.find((i) => i.name === "Manzana")!.owned).toBeUndefined();
    expect(out[1]!.items[0]!.owned).toBe("store");
  });

  it("'fridge' gana a 'store' si el mismo nombre aparecía con los dos", () => {
    const mixed: ShoppingList = [
      {
        category: "X",
        items: [
          { name: "Tomate", qty: "", price_eur: 1, trip: 0, perishable: true, owned: "store" },
          { name: "Tomate", qty: "", price_eur: 1, trip: 1, perishable: true, owned: "fridge" },
        ],
      },
    ];
    const next: ShoppingList = [
      {
        category: "X",
        items: [{ name: "Tomate", qty: "", price_eur: 2, trip: 0, perishable: true }],
      },
    ];
    expect(carryOwnedByName(mixed, next)[0]!.items[0]!.owned).toBe("fridge");
  });

  it("sin marcas previas devuelve la lista nueva tal cual", () => {
    const next = shopping();
    expect(carryOwnedByName([], next)).toBe(next);
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

describe("cleanPantryExtras", () => {
  it("descarta entradas sin nombre y deduplica por nombre normalizado", () => {
    const out = cleanPantryExtras([
      { name: "Lentejas", source: "manual", addedAt: "2026-09-01T00:00:00Z" },
      { name: " lentejas ", source: "receipt" },
      { name: "", source: "manual" },
      { name: "Espinacas", qty: "1 bolsa" },
      "basura",
    ]);
    expect(out.map((e) => e.name)).toEqual(["Lentejas", "Espinacas"]);
    expect(out[0]!.source).toBe("manual");
    expect(out[1]!.qty).toBe("1 bolsa");
    expect(out[1]!.source).toBe("manual"); // por defecto
  });

  it("trata un valor no-array como lista vacía y recorta a 40", () => {
    expect(cleanPantryExtras(null)).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `item ${i}` }));
    expect(cleanPantryExtras(many)).toHaveLength(40);
  });
});

describe("cleanTripReceipts", () => {
  it("descarta tramos y totales inválidos y redondea a céntimos", () => {
    const out = cleanTripReceipts({
      "0": { total: 47.305, itemCount: 12, scannedAt: "2026-09-01T10:00:00Z" },
      "-1": { total: 5 },
      x: { total: 3 },
      "2": { total: -4 },
      "3": { total: "no" },
    });
    expect(Object.keys(out)).toEqual(["0"]);
    expect(out[0]).toEqual({ total: 47.31, itemCount: 12, scannedAt: "2026-09-01T10:00:00Z" });
  });

  it("trata null como objeto vacío y rellena itemCount/scannedAt ausentes", () => {
    expect(cleanTripReceipts(null)).toEqual({});
    const out = cleanTripReceipts({ "0": { total: 10 } });
    expect(out[0]!.total).toBe(10);
    expect(out[0]!.itemCount).toBe(0);
    expect(typeof out[0]!.scannedAt).toBe("string");
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

// --- plan del hogar: lo que ve un no planificador (issue 05, D1) ----------

describe("composeDayForUser", () => {
  // Lunes=0 comparte comida; Jueves=3 comparte cena; nada más.
  const slots: SharedSlots = { desayuno: [], comida: [0], cena: [3] };

  it("un día sin ninguna comida compartida vuelve tal cual (el mío)", () => {
    const mine = day("Martes", "Mi comida", "Mi cena");
    const planner = day("Martes", "Su comida", "Su cena");
    expect(composeDayForUser(mine, planner, slots, 1)).toBe(mine);
  });

  it("solo se pisa la comida que ese día es compartida, el resto es lo mío", () => {
    const mine = day("Lunes", "Mi comida", "Mi cena", { breakfast: "Mi desayuno" });
    const planner = day("Lunes", "Su comida", "Su cena", { breakfast: "Su desayuno" });
    const composed = composeDayForUser(mine, planner, slots, 0);
    expect(composed.lunch).toBe("Su comida"); // lunes: comida compartida
    expect(composed.dinner).toBe("Mi cena"); // lunes: cena NO compartida
    expect(composed.breakfast).toBe("Mi desayuno"); // desayuno nunca compartido aquí
  });

  it("sin fila del planificador para ese día, se queda con la mía", () => {
    const mine = day("Lunes", "Mi comida", "Mi cena");
    expect(composeDayForUser(mine, undefined, slots, 0)).toBe(mine);
  });

  it("arrastra el aviso de 'fuera de la compra' del plato compartido, no el mío", () => {
    const mine = day("Jueves", "Mi comida", "Mi cena", { extras: { cena: ["Mi ingrediente"] } });
    const planner = day("Jueves", "Su comida", "Su cena", {
      extras: { cena: ["Ingrediente del planificador"] },
    });
    const composed = composeDayForUser(mine, planner, slots, 3);
    expect(composed.extras?.cena).toEqual(["Ingrediente del planificador"]);
  });
});

describe("composeMonthlyPlanForMember", () => {
  const slots: SharedSlots = { desayuno: [], comida: [0, 1, 2, 3, 4], cena: [] };

  it("sin ninguna comida compartida, el plan es exactamente el propio", () => {
    const mine = plan();
    expect(composeMonthlyPlanForMember(mine, plan(), { desayuno: [], comida: [], cena: [] })).toBe(
      mine,
    );
  });

  it("compone comida entre semana con la del planificador, cena queda como la mía", () => {
    const mine = plan();
    const planner = plan({
      weeks: plan().weeks.map((w, wi) => ({
        ...w,
        days: w.days.map((d, di) => day(d.day, `CASA S${wi}D${di}`, d.dinner)),
      })),
    });
    const composed = composeMonthlyPlanForMember(mine, planner, slots)!;
    expect(composed.weeks[0]!.days[0]!.lunch).toBe("CASA S0D0"); // lunes: compartido
    expect(composed.weeks[0]!.days[5]!.lunch).toBe("Comida S0D5"); // sábado: no compartido, lo mío
    expect(composed.weeks[0]!.days[0]!.dinner).toBe("Cena S0D0"); // cena nunca compartida aquí
  });

  it("sin plan propio (nunca lo generó), sigue viendo las comidas compartidas del planificador", () => {
    const planner = plan();
    const composed = composeMonthlyPlanForMember(null, planner, slots)!;
    expect(composed.weeks[0]!.days[0]!.lunch).toBe(planner.weeks[0]!.days[0]!.lunch); // lunes: de la casa
    expect(composed.weeks[0]!.days[5]!.lunch).toBe(""); // sábado: sin planificar, vacío — no el del planificador
  });

  it("sin comidas compartidas en absoluto, ni con plan propio null, devuelve null (nada que componer)", () => {
    expect(composeMonthlyPlanForMember(null, plan(), { desayuno: [], comida: [], cena: [] })).toBe(
      null,
    );
  });

  it("desayuno compartido sustituye también la rotación semanal, no solo el día con plato a mano", () => {
    const mine = plan();
    const planner = plan({
      weeks: plan().weeks.map((w) => ({ ...w, breakfasts: ["Tortitas de la casa"] })),
    });
    const composed = composeMonthlyPlanForMember(mine, planner, {
      desayuno: [0, 1, 2, 3, 4, 5, 6],
      comida: [],
      cena: [],
    })!;
    expect(composed.weeks[0]!.breakfasts).toEqual(["Tortitas de la casa"]);
  });
});

// --- cantidades: unidades y desglose por semana --------------------------

describe("normalizeUnit / formatQty / parseQtyLegacy", () => {
  it("normaliza la unidad y su factor a g/ml/ud", () => {
    expect(normalizeUnit("kg")).toEqual({ unit: "g", factor: 1000 });
    expect(normalizeUnit("gramos")).toEqual({ unit: "g", factor: 1 });
    expect(normalizeUnit("L")).toEqual({ unit: "ml", factor: 1000 });
    expect(normalizeUnit("manojo")).toEqual({ unit: "ud", factor: 1 });
    expect(normalizeUnit("")).toEqual({ unit: "ud", factor: 1 });
  });

  it("formatea el total en español, subiendo a kg/l cuando toca", () => {
    expect(formatQty(500, "g")).toBe("500 g");
    expect(formatQty(1500, "g")).toBe("1,5 kg");
    expect(formatQty(2000, "g")).toBe("2 kg");
    expect(formatQty(250, "ml")).toBe("250 ml");
    expect(formatQty(1000, "ml")).toBe("1 l");
    expect(formatQty(3, "ud")).toBe("3 ud");
  });

  it("interpreta el qty de texto libre de una lista antigua", () => {
    expect(parseQtyLegacy("2 kg")).toEqual({ value: 2000, unit: "g" });
    expect(parseQtyLegacy("1,5 l")).toEqual({ value: 1500, unit: "ml" });
    expect(parseQtyLegacy("3 unidades")).toEqual({ value: 3, unit: "ud" });
    expect(parseQtyLegacy("al gusto")).toBeNull();
  });
});

describe("weekDayCounts", () => {
  it("la última semana de un mes de 30 días arrastra los días de más", () => {
    expect(weekDayCounts({ fromDay: 1, toDay: 30 }, 4)).toEqual([7, 7, 7, 9]);
  });

  it("un plan a media de mes deja en 0 las semanas que no cubre", () => {
    expect(weekDayCounts({ fromDay: 15, toDay: 31 }, 4)).toEqual([0, 0, 7, 10]);
  });
});

// Lista canónica: una fila por ingrediente con weekQty (g/ml/ud) por semana.
const canonical = (): ShoppingList => [
  {
    category: "Verdura y fruta",
    items: [
      {
        name: "Cebolla",
        qty: "2 kg",
        price_eur: 2,
        trip: 0,
        perishable: true,
        unit: "g",
        weekQty: [500, 500, 500, 500],
        weekPrice: [0.5, 0.5, 0.5, 0.5],
      },
      {
        name: "Espinaca",
        qty: "400 g",
        price_eur: 2,
        trip: 0,
        perishable: true,
        unit: "g",
        weekQty: [200, 0, 200, 0],
        weekPrice: [1, 0, 1, 0],
      },
    ],
  },
  {
    category: "Despensa",
    items: [
      {
        name: "Arroz",
        qty: "1 kg",
        price_eur: 1.2,
        trip: 0,
        perishable: false,
        unit: "g",
        weekQty: [1000, 0, 0, 0],
        weekPrice: [1.2, 0, 0, 0],
      },
    ],
  },
];

const septiembre = { fromDay: 1, toDay: 30 };

const totalQtyOf = (trips: ReturnType<typeof projectTrips>, name: string) =>
  trips
    .flatMap((t) => t.groups.flatMap((g) => g.items))
    .filter((i) => i.name === name)
    .reduce((sum, i) => sum + (i.qtyValue ?? 0), 0);

describe("isCanonicalShopping", () => {
  it("distingue la lista canónica de la antigua", () => {
    expect(isCanonicalShopping(canonical())).toBe(true);
    expect(isCanonicalShopping(shopping())).toBe(false);
    expect(isCanonicalShopping(null)).toBe(false);
  });
});

describe("projectTrips", () => {
  it("con compra mensual cada ingrediente suma su total del mes", () => {
    const [trip] = projectTrips(canonical(), "mensual", septiembre);
    const byName = Object.fromEntries(
      trip!.groups.flatMap((g) => g.items).map((i) => [i.name, i.qty]),
    );
    expect(byName["Cebolla"]).toBe("2 kg");
    expect(byName["Espinaca"]).toBe("400 g");
    expect(byName["Arroz"]).toBe("1 kg");
  });

  it("reparte cada compra según las semanas que cubre, sin perder ni inventar cantidad", () => {
    const bi = projectTrips(canonical(), "bisemanal", septiembre);
    expect(bi).toHaveLength(2);
    // Σ de las dos compras = total del mes (2000 g de cebolla), salvo redondeo
    expect(Math.abs(totalQtyOf(bi, "Cebolla") - 2000)).toBeLessThan(1);
    // la primera compra (días 1-15) se lleva algo más de la mitad
    const t0 = bi[0]!.groups.flatMap((g) => g.items).find((i) => i.name === "Cebolla")!;
    expect(t0.qtyValue).toBeGreaterThan(900);
    expect(t0.qtyValue).toBeLessThan(1200);
  });

  it("cambiar de cadencia no mueve el total mensual de ningún ingrediente", () => {
    for (const name of ["Cebolla", "Espinaca", "Arroz"]) {
      const mensual = totalQtyOf(projectTrips(canonical(), "mensual", septiembre), name);
      const bisemanal = totalQtyOf(projectTrips(canonical(), "bisemanal", septiembre), name);
      const semanal = totalQtyOf(projectTrips(canonical(), "semanal", septiembre), name);
      expect(Math.abs(bisemanal - mensual)).toBeLessThan(2);
      expect(Math.abs(semanal - mensual)).toBeLessThan(2);
    }
  });

  it("resuelve owned por compra desde ownedTrips", () => {
    const list = canonical();
    list[0]!.items[0]!.ownedTrips = { 1: "store" };
    const bi = projectTrips(list, "bisemanal", septiembre);
    const t0 = bi[0]!.groups.flatMap((g) => g.items).find((i) => i.name === "Cebolla")!;
    const t1 = bi[1]!.groups.flatMap((g) => g.items).find((i) => i.name === "Cebolla")!;
    expect(t0.owned).toBeUndefined();
    expect(t1.owned).toBe("store");
  });

  it("una lista antigua cae en el reparto de siempre (groupByTrip)", () => {
    const legacy = shopping();
    expect(projectTrips(legacy, "bisemanal", septiembre)).toEqual(groupByTrip(legacy, 2));
  });

  // Issue 04 (raciones por comensal): dimensionar `weekQty` para un hogar de
  // varias personas es solo escalar el mismo número — la invariante canónica
  // (Σ compras = total del mes, estable al cambiar cadencia) no puede depender
  // de cuánta gente come. Mismos platos, ×3 raciones.
  it("la misma invariante se cumple con raciones de hogar (weekQty ×3)", () => {
    const scaled = (): ShoppingList =>
      canonical().map((g) => ({
        ...g,
        items: g.items.map((i) => ({
          ...i,
          weekQty: i.weekQty?.map((q) => q * 3),
          weekPrice: i.weekPrice?.map((p) => p * 3),
        })),
      }));

    const [trip] = projectTrips(scaled(), "mensual", septiembre);
    const byName = Object.fromEntries(
      trip!.groups.flatMap((g) => g.items).map((i) => [i.name, i.qtyValue]),
    );
    expect(byName["Cebolla"]).toBe(6000); // 2 kg × 3
    expect(byName["Arroz"]).toBe(3000); // 1 kg × 3

    for (const name of ["Cebolla", "Espinaca", "Arroz"]) {
      const mensual = totalQtyOf(projectTrips(scaled(), "mensual", septiembre), name);
      const bisemanal = totalQtyOf(projectTrips(scaled(), "bisemanal", septiembre), name);
      const semanal = totalQtyOf(projectTrips(scaled(), "semanal", septiembre), name);
      // Al triplicar la cantidad se triplica también el margen de redondeo tolerado.
      expect(Math.abs(bisemanal - mensual)).toBeLessThan(6);
      expect(Math.abs(semanal - mensual)).toBeLessThan(6);
    }
  });
});

describe("cleanShopping · forma canónica", () => {
  it("convierte la unidad de la IA a g/ml/ud y deriva qty y price del mes", () => {
    const out = cleanShopping([
      {
        category: "Verdura y fruta",
        items: [
          {
            name: "Tomate",
            unit: "kg",
            weekQty: [2, 1, 0, 0],
            weekPrice: [2.4, 1.2, 0, 0],
            perishable: true,
          },
        ],
      },
    ]);
    const item = out[0]!.items[0]!;
    expect(item.weekQty).toEqual([2000, 1000, 0, 0]);
    expect(item.qty).toBe("3 kg");
    expect(item.price_eur).toBe(3.6);
    expect(item.trip).toBe(0);
  });

  it("si no viene weekPrice, reparte el price_eur del mes en proporción a la cantidad", () => {
    const out = cleanShopping([
      {
        category: "Despensa",
        items: [{ name: "Lentejas", unit: "g", weekQty: [600, 200, 0, 0], price_eur: 4 }],
      },
    ]);
    const item = out[0]!.items[0]!;
    expect(item.weekPrice).toEqual([3, 1, 0, 0]);
    expect(item.price_eur).toBe(4);
  });
});
