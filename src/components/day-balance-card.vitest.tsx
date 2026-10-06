import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DayAdjustmentRecord, DayBalance } from "@/lib/day-balance";
import i18next from "@/lib/i18n";
import type { MealChange } from "@/lib/plan-shared";
import { renderApp } from "@/test/render";

import { DayBalanceCard } from "./day-balance-card";

const t = i18next.t.bind(i18next);

const balance = (sources: Partial<DayBalance["sources"]>, active = true): DayBalance => {
  const full = { meals: 0, snacks: 0, exercise: 0, ...sources };
  const net = full.meals + full.snacks + full.exercise;
  return { sources: full, net, pending: net, compensated: 0, proteinPending: 0, active };
};

const change = (date: string, before: string, after: string): MealChange => ({
  date,
  slot: "cena",
  slotLabel: "Cena",
  before,
  after,
});

const adjusted = (changes: MealChange[]): DayAdjustmentRecord => ({
  adjustment: { changes, summary: "", kcal: 300 },
  lastOutcome: "adjusted",
});

function setup(props: Partial<Parameters<typeof DayBalanceCard>[0]> & { balance: DayBalance }) {
  const onShowAdjustment = vi.fn();
  const view = renderApp(
    <DayBalanceCard
      record={null}
      settling={false}
      failed={false}
      onShowAdjustment={onShowAdjustment}
      {...props}
    />,
  );
  return { ...view, user: userEvent.setup(), onShowAdjustment };
}

describe("DayBalanceCard", () => {
  it("no se pinta en un día sin desvío ni platos movidos", () => {
    const { container } = setup({ balance: balance({}, false) });
    expect(container).toBeEmptyDOMElement();
  });

  it("desglosa el día por origen y suma el total, con su signo", () => {
    setup({ balance: balance({ meals: 120, snacks: 180, exercise: -250 }) });
    expect(screen.getByText(t("balance.lines.meals"))).toBeInTheDocument();
    expect(screen.getByText(t("balance.lines.snacks"))).toBeInTheDocument();
    expect(screen.getByText(t("balance.lines.exercise"))).toBeInTheDocument();
    expect(screen.getByText("+180")).toBeInTheDocument();
    expect(screen.getByText("−250")).toBeInTheDocument();
    // 120 + 180 − 250
    expect(screen.getByText("+50")).toBeInTheDocument();
  });

  it("solo pinta la línea del origen que aporta algo", () => {
    setup({ balance: balance({ snacks: 200 }) });
    expect(screen.getByText(t("balance.lines.snacks"))).toBeInTheDocument();
    expect(screen.queryByText(t("balance.lines.meals"))).not.toBeInTheDocument();
    expect(screen.queryByText(t("balance.lines.exercise"))).not.toBeInTheDocument();
  });

  it("mientras se asienta el día lo dice, sin enseñar todavía platos", () => {
    setup({
      balance: balance({ snacks: 400 }),
      settling: true,
      record: adjusted([change("2026-03-19", "Pasta carbonara", "Crema de calabacín")]),
    });
    expect(screen.getByText(t("balance.settling"))).toBeInTheDocument();
    expect(screen.queryByText("Crema de calabacín")).not.toBeInTheDocument();
  });

  it("enseña los platos movidos: el de antes tachado y el nuevo", () => {
    setup({
      balance: balance({ snacks: 400 }),
      record: adjusted([change("2026-03-19", "Pasta carbonara", "Crema de calabacín")]),
    });
    expect(screen.getByText("Pasta carbonara")).toHaveClass("line-through");
    expect(screen.getByText("Crema de calabacín")).toBeInTheDocument();
    expect(screen.queryByText(t("balance.seeAll", { count: 1 }))).not.toBeInTheDocument();
  });

  it("con más de dos platos movidos enseña dos y el resto tras «Ver»", async () => {
    const { user, onShowAdjustment } = setup({
      balance: balance({ snacks: 600 }),
      record: adjusted([
        change("2026-03-19", "Pasta carbonara", "Crema de calabacín"),
        change("2026-03-20", "Pizza", "Merluza con brócoli"),
        change("2026-03-21", "Hamburguesa", "Ensalada de garbanzos"),
      ]),
    });
    expect(screen.getByText("Merluza con brócoli")).toBeInTheDocument();
    expect(screen.queryByText("Ensalada de garbanzos")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("balance.seeAll", { count: 3 }) }));
    expect(onShowAdjustment).toHaveBeenCalledOnce();
  });

  it("si el plan no se movió, también lo dice", () => {
    setup({
      balance: balance({ snacks: 60 }),
      record: { adjustment: null, lastOutcome: "below-threshold" },
    });
    expect(screen.getByText(t("balance.note.absorbed"))).toBeInTheDocument();
  });

  it("un fallo manda sobre «Ajustando…»: no se queda el spinner para siempre", () => {
    setup({ balance: balance({ snacks: 400 }), settling: true, failed: true });
    expect(screen.getByText(t("balance.failed"))).toBeInTheDocument();
    expect(screen.queryByText(t("balance.settling"))).not.toBeInTheDocument();
  });

  it("sin ver cifras no hay ninguna kcal, pero sí qué se movió", () => {
    setup({
      balance: balance({ snacks: 400 }),
      showNumbers: false,
      record: adjusted([change("2026-03-19", "Pasta carbonara", "Crema de calabacín")]),
    });
    expect(screen.queryByText("+400")).not.toBeInTheDocument();
    expect(screen.queryByText("kcal")).not.toBeInTheDocument();
    expect(screen.getByText(t("balance.lines.snacks"))).toBeInTheDocument();
    expect(screen.getByText("Crema de calabacín")).toBeInTheDocument();
  });
});
