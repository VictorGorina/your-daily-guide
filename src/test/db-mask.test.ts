import { describe, expect, test } from "bun:test";

import { HIDDEN, maskRows, sensitiveInSelect } from "../../scripts/db-mask";

// Ticket 19 de la auditoría (OPS-04): `bun run db` usa la clave de servicio, así
// que lo que imprime no puede llevar datos de salud de personas reales.

const profile = {
  id: "u1",
  tone: "calido",
  medications: "sertralina",
  ed_history: "si",
  display_name: "Ana",
  current_weight_kg: 70,
};

describe("maskRows", () => {
  test("sin --select las columnas sensibles ni aparecen", () => {
    expect(maskRows("profiles", [profile], "omit")).toEqual([
      { id: "u1", tone: "calido", current_weight_kg: 70 },
    ]);
  });

  test("con --select la columna sensible sale tapada, no desaparece", () => {
    expect(maskRows("profiles", [{ id: "u1", medications: "sertralina" }], "hide")).toEqual([
      { id: "u1", medications: HIDDEN },
    ]);
  });

  test("--unmask la deja tal cual", () => {
    expect(maskRows("profiles", [profile], "show")).toEqual([profile]);
  });

  test("un recurso embebido se tapa con la lista de SU tabla", () => {
    const rows = [
      {
        id: "h1",
        name: "Casa",
        household_members: [{ id: "m1", display_name: "Leo", portion: 1 }],
        household_children: [{ id: "c1", name: "Noa", allergies: ["frutos secos"], age: 4 }],
      },
    ];
    expect(maskRows("households", rows, "hide")).toEqual([
      {
        id: "h1",
        name: HIDDEN,
        household_members: [{ id: "m1", display_name: HIDDEN, portion: 1 }],
        household_children: [{ id: "c1", name: HIDDEN, allergies: HIDDEN, age: 4 }],
      },
    ]);
  });

  test("`name` solo es sensible donde lo dice su tabla", () => {
    expect(maskRows("dish_recipes", [{ name: "arroz" }], "hide")).toEqual([{ name: "arroz" }]);
  });

  test("un jsonb se recorre con la lista de la tabla de la fila", () => {
    expect(maskRows("daily_logs", [{ habits: { notes: "ansiedad" } }], "omit")).toEqual([
      { habits: {} },
    ]);
  });

  test("una tabla sin lista y los valores sueltos pasan sin cambios", () => {
    expect(maskRows("foods_extra", [{ key: "k", label: "l" }], "omit")).toEqual([
      { key: "k", label: "l" },
    ]);
    expect(maskRows("profiles", null, "omit")).toBeNull();
  });
});

describe("sensitiveInSelect", () => {
  test("nombra las sensibles pedidas, también con alias", () => {
    expect(sensitiveInSelect("profiles", "id, medications,meds:ed_history,tone")).toEqual([
      "medications",
      "ed_history",
    ]);
  });

  test("con * son todas las de la tabla", () => {
    expect(sensitiveInSelect("chat_messages", "*")).toEqual(["content"]);
  });
});
