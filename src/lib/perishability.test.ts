import { describe, expect, it } from "bun:test";

import { freshRiskNames, freshRisksForTrip, freshRiskText, shelfLifeDays } from "./perishability";
import type { ShoppingItem } from "./plan-shared";

const item = (name: string, perishable: boolean, owned?: "fridge" | "store"): ShoppingItem => ({
  name,
  qty: "",
  price_eur: 1,
  trip: 0,
  perishable,
  ...(owned ? { owned } : {}),
});

describe("shelfLifeDays", () => {
  it("los no perecederos nunca caducan a efectos del plan", () => {
    expect(shelfLifeDays("Arroz", "Despensa", false)).toBe(Infinity);
    expect(shelfLifeDays("Lentejas", "Proteína", false)).toBe(Infinity);
  });

  it("reconoce frescos delicados por palabra clave", () => {
    expect(shelfLifeDays("Salmón fresco", "Proteína", true)).toBe(2);
    expect(shelfLifeDays("Lechuga romana", "Verdura y fruta", true)).toBe(4);
    expect(shelfLifeDays("Kiwi maduro", "Verdura y fruta", true)).toBe(5);
    expect(shelfLifeDays("Cebolla", "Verdura y fruta", true)).toBe(32); // larga vida en despensa fresca
  });

  it("cae en la vida útil de la categoría cuando el nombre no da pistas", () => {
    expect(shelfLifeDays("Verdura variada", "Verdura y fruta", true)).toBe(6);
    expect(shelfLifeDays("Fiambre casero", "Proteína", true)).toBe(3);
    expect(shelfLifeDays("Algo raro", "Otros", true)).toBe(10);
  });
});

describe("freshRisksForTrip", () => {
  const groups = [
    { category: "Proteína", items: [item("Pescado blanco", true), item("Atún en lata", false)] },
    { category: "Verdura y fruta", items: [item("Manzana", true), item("Espinacas", true)] },
  ];
  const septiembre = { fromDay: 1, toDay: 30 };

  it("avisa de los frescos que no aguantan una compra mensual", () => {
    const risks = freshRisksForTrip(groups, septiembre, 1, 0);
    expect(risks).toContain("Pescado blanco"); // 2 < 30
    expect(risks).toContain("Espinacas"); // 4 < 30
    expect(risks).toContain("Manzana"); // 15 < 30
    expect(risks).not.toContain("Atún en lata"); // no perecedero
  });

  it("con compra semanal solo salta lo muy perecedero", () => {
    // 4 compras sobre 30 días → tramos de 7-9 días
    const risks = freshRisksForTrip(groups, septiembre, 4, 0);
    expect(risks).toContain("Pescado blanco"); // 2 < 8
    expect(risks).toContain("Espinacas"); // 4 < 8
    expect(risks).not.toContain("Manzana"); // 15 >= 8
  });

  it("lo que llega justo al último día de la compra no avisa", () => {
    // octubre: compras semanales de 8 días (1-8); comprado el día 1 con 7 días llega al 8
    const octubre = { fromDay: 1, toDay: 31 };
    const week = [
      { category: "Verdura y fruta", items: [item("Tomate", true), item("Brócoli", true)] },
      { category: "Lácteos", items: [item("Yogur natural", true)] },
    ];
    expect(freshRisksForTrip(week, octubre, 4, 0)).toEqual(["Brócoli"]); // 5 < 7
  });

  it("escribe el aviso según la cadencia y la pantalla", () => {
    expect(freshRiskText(["Merluza"], 8, "semanal")).toBe(
      "Merluza no aguanta los 8 días de esta compra. Cómpralo más cerca de cuando los vayas a cocinar.",
    );
    expect(freshRiskText(["Merluza", "Espinacas"], 8, "semanal", true)).toBe(
      "Merluza y Espinacas no aguantan los 8 días hasta la próxima compra. Cógelos justo para los primeros platos.",
    );
    // la optimizada ya compra lo fresco en cada salida: propone qué hacer con lo que no llega
    expect(freshRiskText(["Merluza", "Espinacas"], 8, "optimizada")).toBe(
      "Merluza y Espinacas no aguantan hasta la próxima compra. Congélalos al llegar o cómpralos el día que los cocines.",
    );
    expect(freshRiskText(["Merluza"], 8, "optimizada", true)).toBe(
      "Merluza no aguanta hasta la próxima compra. Congélalo al llegar o cómpralo el día que lo cocines.",
    );
  });

  it("resume la lista de nombres para el aviso", () => {
    expect(freshRiskNames([])).toBe("");
    expect(freshRiskNames(["Pescado"])).toBe("Pescado");
    expect(freshRiskNames(["Pescado", "Espinacas"])).toBe("Pescado y Espinacas");
    expect(freshRiskNames(["Pescado", "Espinacas", "Fresas"])).toBe("Pescado, Espinacas y Fresas");
    expect(freshRiskNames(["Pescado", "Espinacas", "Fresas", "Lechuga"])).toBe(
      "Pescado, Espinacas y 2 más",
    );
  });

  it("no avisa de lo no perecedero ni de lo ya marcado", () => {
    const withOwned = [
      {
        category: "Proteína",
        items: [item("Pescado blanco", true, "store"), item("Atún en lata", false)],
      },
    ];
    expect(freshRisksForTrip(withOwned, septiembre, 1, 0)).toEqual([]);
  });
});
