import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MacroEstimate } from "@/lib/guide.functions";
import { renderApp } from "@/test/render";

import { MacroBars } from "./macro-bars";

const macros = (m: Partial<MacroEstimate>): MacroEstimate => ({
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  ...m,
});

const target = macros({ kcal: 2000, protein_g: 120, carbs_g: 220, fat_g: 70, fiber_g: 30 });

describe("MacroBars", () => {
  it("compara las kcal con el objetivo del día, con su porcentaje", () => {
    renderApp(<MacroBars estimate={macros({ kcal: 1780 })} target={target} weightKg={null} />);
    expect(screen.getByText("~1780 de 2000 kcal")).toBeTruthy();
    // 89 %: a media jornada no es un aviso.
    expect(screen.getByText("89%").className).toBe("");
  });

  it("si comes de más, el porcentaje pasa de 100 y se marca con el semáforo", () => {
    renderApp(
      <MacroBars
        estimate={macros({ kcal: 2600, carbs_g: 300, protein_g: 180 })}
        target={target}
        weightKg={null}
      />,
    );
    // kcal +30 % e hidratos +36 %: rojo, como en el calendario.
    expect(screen.getByText("130%").className).toContain("bg-danger");
    expect(screen.getByText("136%").className).toContain("bg-danger");
    // Más proteína no es un exceso: se ve el 150 %, sin color.
    expect(screen.getByText("150%").className).toBe("");
  });

  it("un día cerrado lleva el semáforo entero", () => {
    renderApp(
      <MacroBars estimate={macros({ kcal: 1500 })} target={target} weightKg={null} finished />,
    );
    expect(screen.getByText("75%").className).toContain("bg-warning");
    expect(screen.getByText(/Lo que comiste ese día/)).toBeTruthy();
  });

  it("sin objetivo del día no hay porcentajes ni línea de kcal", () => {
    renderApp(<MacroBars estimate={macros({ kcal: 900 })} target={null} weightKg={70} />);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText(/~900 kcal de lo que llevas comido hoy/)).toBeTruthy();
  });
});
