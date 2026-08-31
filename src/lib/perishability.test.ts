import { describe, expect, it } from "bun:test";

import { freshRiskNames, freshRisksForTrip, shelfLifeDays } from "./perishability";
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
