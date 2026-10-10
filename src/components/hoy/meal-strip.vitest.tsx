import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DailyGuide, DailyLog } from "@/lib/daily";
import i18next from "@/lib/i18n";
import type { mealsForDate } from "@/lib/plan-shared";
import { renderApp } from "@/test/render";

import { MealStrip } from "./meal-strip";

// La receta y el relleno de purés llaman al servidor: aquí no pintan nada.
vi.mock("@/components/dish-recipe", () => ({ DishRecipe: () => null }));
vi.mock("@/lib/plan.functions", () => ({ fillChildMeals: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const t = i18next.t.bind(i18next);

type Meals = ReturnType<typeof mealsForDate>;
const meal = (moment: string, slot: string, idea: string) =>
  ({ moment, slot, idea }) as unknown as Meals[number];

// El registro guarda las comidas en el orden del plan, no en el del día.
const habits: DailyLog["habits"] = [
  { label: "Cena", done: false },
  { label: "Desayuno", done: false },
  { label: "Comida", done: true, status: "plan" },
];
const todayMeals: Meals = [
  meal("Cena", "cena", "Merluza al horno con brócoli"),
  meal("Desayuno", "desayuno", "Tostadas con tomate"),
  meal("Comida", "comida", "Lentejas estofadas"),
];

function setup(props: Partial<Parameters<typeof MealStrip>[0]> = {}) {
  const onEdit = vi.fn();
  const onAte = vi.fn();
  const onClear = vi.fn();
  const onRetry = vi.fn();
  renderApp(
    <MealStrip
      habits={habits}
      todayMeals={todayMeals}
      mealMacros={undefined}
      showNumbers
      date="2026-03-18"
      month="2026-03"
      plan={null}
      household={null}
      sharedSlots={null}
      homePlanner={null}
      noPlanYet={false}
      loadFailed={false}
      onRetry={onRetry}
      isAdjusting={() => false}
      onEdit={onEdit}
      onAte={onAte}
      onClear={onClear}
      {...props}
    />,
  );
  return { onEdit, onAte, onClear, onRetry };
}

const label = (key: string, mealName: string) => t(key, { meal: mealName });

describe("MealStrip", () => {
  it("pinta las comidas en orden del día y cuenta las hechas", () => {
    setup();
    const dishes = screen
      .getAllByText(/Tostadas con tomate|Lentejas estofadas|Merluza al horno con brócoli/)
      .map((el) => el.textContent);
    expect(dishes).toEqual([
      "Tostadas con tomate",
      "Lentejas estofadas",
      "Merluza al horno con brócoli",
    ]);
    expect(screen.getByText(t("hoy.meals.count", { done: 1, total: 3 }))).toBeInTheDocument();
  });

  it("«comí esto» y «comí otra cosa» avisan con el índice del registro, no el de la tira", async () => {
    const user = userEvent.setup();
    const { onAte, onEdit } = setup();
    // Desayuno es la primera fila de la tira, pero la segunda del registro.
    await user.click(
      screen.getByRole("button", { name: label("hoy.meals.ateThisLabel", "Desayuno") }),
    );
    expect(onAte).toHaveBeenCalledWith(1);
    await user.click(
      screen.getByRole("button", { name: label("hoy.meals.ateOtherLabel", "Cena") }),
    );
    expect(onEdit).toHaveBeenCalledWith(0);
  });

  it("una comida hecha solo ofrece deshacer", async () => {
    const user = userEvent.setup();
    const { onClear } = setup();
    expect(
      screen.queryByRole("button", { name: label("hoy.meals.ateThisLabel", "Comida") }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: label("hoy.meals.undoLabel", "Comida") }));
    expect(onClear).toHaveBeenCalledWith(2);
  });

  it("un plato cambiado enseña debajo la sugerencia original del plan", () => {
    setup({
      habits: [{ label: "Cena", done: false, plannedIdea: "Merluza al horno con brócoli" }],
      todayMeals: [meal("Cena", "cena", "Pizza margarita")],
    });
    expect(screen.getByText("Pizza margarita")).toBeInTheDocument();
    expect(screen.getByText("Merluza al horno con brócoli")).toHaveClass("line-through");
  });

  it("un plato sin cifra dice «Calculando…», y nada si las cifras están ocultas", () => {
    const mealMacros = [
      { moment: "Cena", idea: "Merluza al horno con brócoli", status: "calculando" },
    ] as unknown as DailyGuide["mealMacros"];
    const one = {
      habits: [{ label: "Cena", done: false }],
      todayMeals: [meal("Cena", "cena", "Merluza al horno con brócoli")],
      mealMacros,
    };
    setup(one);
    expect(screen.getByText(t("hoy.meals.calculating"))).toBeInTheDocument();
    setup({ ...one, showNumbers: false });
    expect(screen.getAllByText(t("hoy.meals.calculating"))).toHaveLength(1);
  });

  it("sin plan del mes lleva a Plan en vez de pintar comidas", () => {
    setup({ habits: [], todayMeals: [], noPlanYet: true });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/plan");
    expect(within(link).getByText(t("hoy.meals.noPlanTitle"))).toBeInTheDocument();
  });

  it("si el registro de hoy no carga, ofrece reintentar", async () => {
    const user = userEvent.setup();
    const { onRetry } = setup({ habits: [], todayMeals: [], loadFailed: true });
    await user.click(screen.getByRole("button", { name: t("hoy.meals.loadFailed") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
