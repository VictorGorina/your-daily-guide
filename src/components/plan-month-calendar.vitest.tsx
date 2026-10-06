import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18next from "@/lib/i18n";
import { DAY_NAMES, PLAN_ROWS, type MonthlyPlan } from "@/lib/plan-shared";
import { renderApp } from "@/test/render";

import { PlanMonthCalendar } from "./plan-month-calendar";

// La receta se pide al servidor al desplegarla: aquí no se prueba.
vi.mock("@/components/dish-recipe", () => ({ DishRecipe: () => null }));

const t = i18next.t.bind(i18next);

// Marzo de 2026 empieza en domingo; "hoy" es el miércoles 18.
const MONTH = "2026-03";

/** Cada celda dice dónde está: así se ve qué celda pinta el calendario. */
const plan: MonthlyPlan = {
  intro: "",
  focus: [],
  weeks: Array.from({ length: PLAN_ROWS }, (_, w) => ({
    label: `Semana ${w + 1}`,
    focus: "Verdura a diario",
    breakfasts: [],
    snacks: [],
    days: DAY_NAMES.map((day) => ({
      day,
      lunch: `Comida fila ${w} ${day}`,
      dinner: `Cena fila ${w} ${day}`,
    })),
  })),
};

function setup(props: Partial<Parameters<typeof PlanMonthCalendar>[0]> = {}) {
  const onOpenDay = vi.fn();
  renderApp(
    <PlanMonthCalendar
      plan={plan}
      month={MONTH}
      logs={[]}
      monthStatus="current"
      appStartedOn="2026-03-05"
      selectedMealSlots={["comida", "cena"]}
      onOpenDay={onOpenDay}
      homePlanner={null}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onOpenDay };
}

describe("PlanMonthCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("un día futuro abre el menú de SU celda: la fila la marca el día del mes", async () => {
    const { user, onOpenDay } = setup();
    // El viernes 20 es fila 2 (días 15-21), no la tercera fila del calendario.
    await user.click(screen.getByRole("button", { name: "20" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Comida fila 2 Viernes")).toBeInTheDocument();
    expect(within(dialog).getByText("Cena fila 2 Viernes")).toBeInTheDocument();
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it("los días 29 a 31 tienen su propia fila", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "31" }));
    expect(
      within(screen.getByRole("dialog")).getByText("Comida fila 4 Martes"),
    ).toBeInTheDocument();
  });

  it("solo enseña las comidas que la persona planifica", async () => {
    const { user } = setup({ selectedMealSlots: ["cena"] });
    await user.click(screen.getByRole("button", { name: "20" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Cena fila 2 Viernes")).toBeInTheDocument();
    expect(within(dialog).queryByText("Comida fila 2 Viernes")).not.toBeInTheDocument();
  });

  it("un día pasado abre el detalle del día, no el menú", async () => {
    const { user, onOpenDay } = setup();
    await user.click(screen.getByRole("button", { name: t("planCalendar.openDay", { day: 10 }) }));
    expect(onOpenDay).toHaveBeenCalledExactlyOnceWith("2026-03-10");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("un día anterior al alta en la app no se puede abrir", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: t("planCalendar.openDay", { day: 3 }) }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("planCalendar.openDay", { day: 5 }) }),
    ).toBeInTheDocument();
  });

  it("sin plan, un día futuro dice que no hay menú", async () => {
    const { user } = setup({ plan: null });
    await user.click(screen.getByRole("button", { name: "20" }));
    expect(
      within(screen.getByRole("dialog")).getByText(t("planCalendar.noMenu")),
    ).toBeInTheDocument();
  });
});
