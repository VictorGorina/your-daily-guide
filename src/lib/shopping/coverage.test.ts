import { describe, expect, it } from "bun:test";

import { cleanShopping, projectTrips, type ShoppingList } from "../plan-shared";
import { checkShopping, type CoverageReader, type DishNeed } from "./coverage";
import { normName } from "./model";

// Octubre de 2026: 31 días, compras semanales 1-8 / 9-16 / 17-24 / 25-31.
const octubre = { fromDay: 1, toDay: 31 };

const list = (): ShoppingList => [
  {
    category: "Verdura y fruta",
    items: [
      {
        name: "Calabacín",
        qty: "2 kg",
        price_eur: 4,
        trip: 0,
        perishable: true,
        unit: "g",
        weekQty: [1000, 0, 0, 1000],
        weekPrice: [2, 0, 0, 2],
      },
      {
        name: "Huevos",
        qty: "24 ud",
        price_eur: 6,
        trip: 0,
        perishable: true,
        unit: "ud",
        weekQty: [6, 6, 6, 6],
        weekPrice: [1.5, 1.5, 1.5, 1.5],
      },
    ],
  },
];

const reader: CoverageReader = {
  familyOfItem: (name) => {
    const n = normName(name);
    if (n.includes("calabacin")) return "calabacin";
    if (n.includes("huevo")) return "huevo";
    if (n.includes("pera")) return "pera";
    return null;
  },
  // Un huevo, 60 g; lo demás va en gramos.
  gramsOf: (name, unit, qty) =>
    unit === "g" ? qty : normName(name).includes("huevo") ? qty * 60 : null,
  newItem: (family) =>
    family === "pera"
      ? { name: "Pera", category: "Verdura y fruta", eurPerGram: 0.002, perishable: true }
      : null,
};

const run = (needs: DishNeed[], editable = (_day: number) => true, shopping = list()) =>
  checkShopping({
    shopping,
    needs,
    coverage: octubre,
    daysInMonth: 31,
    editable: (day) => editable(day),
    stocksUp: () => false,
    pantry: new Set(),
    reader,
  });

const item = (out: ShoppingList, name: string) =>
  out.flatMap((g) => g.items).find((i) => i.name === name);

describe("checkShopping", () => {
  it("añade lo que falta, en la semana y el día del plato", () => {
    // La pera de la comida del día 30, que no estaba en la lista.
    const out = run([{ day: 30, family: "pera", grams: 180 }]);
    expect(out.added).toEqual(["Pera"]);
    const pera = item(out.shopping, "Pera")!;
    expect(pera.weekQty).toEqual([0, 0, 0, 180]);
    expect(pera.price_eur).toBe(0.36);
    expect(pera.dayQty![29]).toBe(180);
  });

  it("sube la semana que se quedó sin un ingrediente que sí está en la lista", () => {
    // Crema de calabacín los días 18 y 21: la semana 3 tenía 0 g.
    const out = run([
      { day: 18, family: "calabacin", grams: 250 },
      { day: 21, family: "calabacin", grams: 250 },
    ]);
    expect(out.raised).toEqual(["Calabacín"]);
    const calabacin = item(out.shopping, "Calabacín")!;
    expect(calabacin.weekQty).toEqual([1000, 0, 500, 1000]);
    // Al precio por gramo que ya tenía el artículo.
    expect(calabacin.weekPrice![2]).toBeCloseTo(1, 5);
  });

  it("no sube lo que ya alcanza, ni lo que solo es un pellizco", () => {
    const out = run([
      { day: 27, family: "calabacin", grams: 900 },
      { day: 10, family: "calabacin", grams: 5 },
      { day: 3, family: "huevo", grams: 120 },
    ]);
    expect(out.raised).toEqual([]);
    expect(out.added).toEqual([]);
  });

  it("no toca una compra que ya se hizo: lo que falta ahí se queda sin arreglar", () => {
    const out = run([{ day: 20, family: "pera", grams: 180 }], (day) => day > 24);
    expect(out.added).toEqual([]);
    expect(out.late).toEqual(["pera"]);
  });

  it("lo que hay en la despensa extra no se compra", () => {
    const out = checkShopping({
      shopping: list(),
      needs: [{ day: 30, family: "pera", grams: 180 }],
      coverage: octubre,
      daysInMonth: 31,
      editable: () => true,
      stocksUp: () => false,
      pantry: new Set(["pera"]),
      reader,
    });
    expect(out.added).toEqual([]);
  });

  it("reparte cada semana entre los días que la usan y Σ de la semana no cambia", () => {
    // Semana 4 (días 22-31): el calabacín solo se usa el día 27.
    const out = run([{ day: 27, family: "calabacin", grams: 600 }]);
    const calabacin = item(out.shopping, "Calabacín")!;
    expect(calabacin.weekQty).toEqual([1000, 0, 0, 1000]);
    expect(calabacin.dayQty![26]).toBe(1000);
    const semanal = projectTrips(out.shopping, "semanal", octubre);
    const qtyIn = (trip: number) =>
      semanal[trip]!.groups.flatMap((g) => g.items).find((i) => i.name === "Calabacín")?.qtyValue ??
      0;
    // Antes 300 g iban a la compra de los días 17-24 por el reparto a partes iguales.
    expect(qtyIn(2)).toBe(0);
    expect(qtyIn(3)).toBe(1000);
  });

  it("los días de una compra ya hecha conservan lo que enseñaban", () => {
    const out = run([{ day: 27, family: "calabacin", grams: 600 }], (day) => day > 24);
    const calabacin = item(out.shopping, "Calabacín")!;
    // Días 22-24: su parte a partes iguales de 1000 g entre 10 días.
    expect(calabacin.dayQty![21]).toBe(100);
    expect(calabacin.dayQty![23]).toBe(100);
    expect(calabacin.dayQty![26]).toBe(700);
  });

  it("el reparto por días sobrevive al saneado, y se descarta si no cuadra", () => {
    const out = run([{ day: 27, family: "calabacin", grams: 600 }]);
    const kept = cleanShopping(out.shopping);
    expect(item(kept, "Calabacín")!.dayQty).toEqual(item(out.shopping, "Calabacín")!.dayQty);
    // Alguien cambió la semana sin tocar los días: vuelve al reparto a partes iguales.
    item(out.shopping, "Calabacín")!.weekQty = [1000, 0, 0, 1500];
    expect(item(cleanShopping(out.shopping), "Calabacín")!.dayQty).toBeUndefined();
  });

  it("una lista antigua, sin cantidades por semana, no se toca", () => {
    const legacy: ShoppingList = [
      {
        category: "Otros",
        items: [{ name: "Calabacín", qty: "1 kg", price_eur: 2, trip: 0, perishable: true }],
      },
    ];
    const out = run([{ day: 3, family: "pera", grams: 180 }], () => true, legacy);
    expect(out.shopping).toBe(legacy);
    expect(out.added).toEqual([]);
  });
});
