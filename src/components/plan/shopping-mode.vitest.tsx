import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import i18next from "@/lib/i18n";
import type { ShoppingItem } from "@/lib/plan-shared";
import { renderApp } from "@/test/render";

import { ShoppingMode } from "./shopping-mode";

const t = i18next.t.bind(i18next);

const item = (name: string, price_eur: number, owned?: "fridge" | "store"): ShoppingItem => ({
  name,
  qty: "500 g",
  price_eur,
  trip: 0,
  perishable: false,
  owned,
});

const trip = {
  trip: 0,
  groups: [
    { category: "Verdura y fruta", items: [item("Cebolla", 1.2), item("Ajo", 0.6, "fridge")] },
    { category: "Despensa", items: [item("Arroz", 2, "store")] },
  ],
};

/** La pantalla en pequeño: un botón que abre el modo compra, como «Ir a comprar». */
function Harness(props: Partial<Parameters<typeof ShoppingMode>[0]> = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {open ? (
        <ShoppingMode
          trip={trip}
          cadence="mensual"
          coverage={undefined}
          tripsTotal={1}
          selectedTrip={0}
          month="2026-03"
          onToggle={() => {}}
          onClose={() => setOpen(false)}
          tripActual={undefined}
          savingActual={false}
          onSaveActual={() => {}}
          onScanReceipt={() => {}}
          scanningReceipt={false}
          {...props}
        />
      ) : null}
    </>
  );
}

async function open(props: Partial<Parameters<typeof ShoppingMode>[0]> = {}) {
  const user = userEvent.setup();
  renderApp(<Harness {...props} />);
  const opener = screen.getByRole("button", { name: "Abrir" });
  await user.click(opener);
  return { user, opener, dialog: screen.getByRole("dialog") };
}

describe("ShoppingMode", () => {
  it("es un diálogo con su título y sin lo que ya había en casa", async () => {
    const { dialog } = await open();
    expect(dialog).toHaveAccessibleName(t("shopMode.title"));
    expect(within(dialog).getByRole("checkbox", { name: /Cebolla/ })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Arroz/ })).toBeChecked();
    expect(within(dialog).queryByText("Ajo")).not.toBeInTheDocument();
  });

  it("su único cierre es la flecha: no pinta la «X» del panel", async () => {
    const { dialog } = await open();
    expect(within(dialog).getByRole("button", { name: t("shopMode.exit") })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: t("common.close") }),
    ).not.toBeInTheDocument();
  });

  it("tocar un ingrediente, o Espacio sobre él, lo alterna", async () => {
    const onToggle = vi.fn();
    const { user, dialog } = await open({ onToggle });
    const onion = within(dialog).getByRole("checkbox", { name: /Cebolla/ });
    await user.click(onion);
    onion.focus();
    await user.keyboard(" ");
    expect(onToggle.mock.calls).toEqual([["Cebolla"], ["Cebolla"]]);
  });

  it("el foco entra en el panel y Tab no sale de él", async () => {
    const { user, opener, dialog } = await open();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    expect(opener).not.toHaveFocus();
  });

  it("Escape lo cierra y el foco vuelve al botón que lo abrió", async () => {
    const { user, opener } = await open();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Radix devuelve el foco en el siguiente turno, no al desmontar.
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("la flecha también devuelve el foco al botón que lo abrió", async () => {
    const { user, opener, dialog } = await open();
    await user.click(within(dialog).getByRole("button", { name: t("shopMode.exit") }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Radix devuelve el foco en el siguiente turno, no al desmontar.
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
