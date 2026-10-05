import { describe, expect, it } from "bun:test";

import {
  freezesWell,
  freshRiskNames,
  freshRisksForTrip,
  freshRiskText,
  shelfLifeDays,
} from "./perishability";
import i18n from "./i18n";
import type { ShoppingItem } from "./plan-shared";

const t = i18n.getFixedT("es");

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
    expect(freshRiskText(["Merluza"], 8, "semanal", t)).toBe(
      "Merluza no aguanta los 8 días de esta compra. Cómpralo más cerca de cuando los vayas a cocinar.",
    );
    expect(freshRiskText(["Merluza", "Espinacas"], 8, "semanal", t, true)).toBe(
      "Merluza y Espinacas no aguantan los 8 días hasta la próxima compra. Cógelos justo para los primeros platos.",
    );
    // la optimizada ya compra lo fresco en cada salida: propone qué hacer con lo que no llega
    expect(freshRiskText(["Merluza", "Espinacas"], 8, "optimizada", t)).toBe(
      "Merluza y Espinacas no aguantan hasta la próxima compra. Congélalos al llegar o cómpralos el día que los cocines.",
    );
    expect(freshRiskText(["Merluza"], 8, "optimizada", t, true)).toBe(
      "Merluza no aguanta hasta la próxima compra. Congélalo al llegar o cómpralo el día que lo cocines.",
    );
  });

  it("en la optimizada solo propone congelar lo que se congela", () => {
    expect(freshRiskText(["Lechuga", "Plátano"], 8, "optimizada", t)).toBe(
      "Lechuga y Plátano no aguantan hasta la próxima compra. Cómpralos el día que los vayas a usar.",
    );
    expect(freshRiskText(["Fresas"], 8, "optimizada", t, true)).toBe(
      "Fresas no aguanta hasta la próxima compra. Cómpralo el día que lo vayas a usar.",
    );
    // de los dos tipos en la misma compra: cada uno con su consejo
    expect(
      freshRiskText(["Merluza", "Lechuga", "Pechuga de pollo", "Plátano"], 8, "optimizada", t),
    ).toBe(
      "Merluza y Pechuga de pollo no aguantan hasta la próxima compra: congélalos al llegar. " +
        "Lechuga y Plátano tampoco y no se congelan bien: cómpralos el día que los vayas a usar.",
    );
    expect(freshRiskText(["Merluza", "Aguacate"], 8, "optimizada", t)).toBe(
      "Merluza no aguanta hasta la próxima compra: congélalo al llegar. " +
        "Aguacate tampoco y no se congela bien: cómpralo el día que lo vayas a usar.",
    );
  });

  it("freezesWell: carne, pescado, pan y verdura de cocinar; lo dudoso, no", () => {
    for (const name of ["Merluza", "Carne picada", "Pan integral", "Brócoli", "Espinacas"]) {
      expect(freezesWell(name)).toBe(true);
    }
    for (const name of ["Lechuga", "Plátano", "Tomate", "Yogur natural", "Tofu"]) {
      expect(freezesWell(name)).toBe(false);
    }
  });

  it("el aviso sale en el idioma de la persona, con su plural", () => {
    const en = i18n.getFixedT("en");
    expect(freshRiskText(["Hake"], 8, "semanal", en)).toBe(
      "Hake won't last the 8 days this trip covers. Buy it closer to when you'll cook it.",
    );
    expect(freshRiskText(["Hake", "Lettuce", "Spinach", "Banana"], 8, "semanal", en, true)).toBe(
      "Hake, Lettuce and 2 more won't last the 8 days until the next trip. Pick them up just for the first dishes.",
    );
  });

  it("resume la lista de nombres para el aviso", () => {
    expect(freshRiskNames([], t)).toBe("");
    expect(freshRiskNames(["Pescado"], t)).toBe("Pescado");
    expect(freshRiskNames(["Pescado", "Espinacas"], t)).toBe("Pescado y Espinacas");
    expect(freshRiskNames(["Pescado", "Espinacas", "Fresas"], t)).toBe(
      "Pescado, Espinacas y Fresas",
    );
    expect(freshRiskNames(["Pescado", "Espinacas", "Fresas", "Lechuga"], t)).toBe(
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
