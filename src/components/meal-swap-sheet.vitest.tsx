import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import i18next from "@/lib/i18n";
import { renderApp } from "@/test/render";

import { MealSwapSheet, type MealSwapResult } from "./meal-swap-sheet";

const t = i18next.t.bind(i18next);

function setup(
  props: Partial<Parameters<typeof MealSwapSheet>[0]> = {},
  result: MealSwapResult = { ok: true },
) {
  const onSwap = vi.fn(async () => result);
  const onSkip = vi.fn();
  const onOpenChange = vi.fn();
  renderApp(
    <MealSwapSheet
      open
      onOpenChange={onOpenChange}
      mealLabel="Cena"
      plannedDish="Merluza a la plancha con brócoli"
      onSwap={onSwap}
      onSkip={onSkip}
      {...props}
    />,
  );
  const field = screen.getByRole("textbox", {
    name: t("mealSwap.fieldLabel", { meal: "cena" }),
  });
  return { user: userEvent.setup(), onSwap, onSkip, onOpenChange, field };
}

const change = () => screen.getByRole("button", { name: t("common.change") });

describe("MealSwapSheet", () => {
  it("enseña tachado el plato que tenía el plan", () => {
    setup();
    expect(screen.getByText("Merluza a la plancha con brócoli")).toHaveClass("line-through");
  });

  it("cambia el plato con el tamaño elegido y cierra", async () => {
    const { user, onSwap, onOpenChange, field } = setup();
    await user.type(field, "Pizza margarita");
    await user.click(screen.getByRole("radio", { name: t("mealSwap.sizes.grande") }));
    await user.click(change());

    expect(onSwap).toHaveBeenCalledExactlyOnceWith("Pizza margarita", { size: "grande" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("llega preseleccionado el tamaño que la persona suele elegir", async () => {
    const { user, onSwap, field } = setup({ defaultSize: "pequena" });
    expect(screen.getByRole("radio", { name: t("mealSwap.sizes.pequena") })).toBeChecked();
    await user.type(field, "Ensalada de pasta");
    await user.click(change());
    expect(onSwap).toHaveBeenCalledExactlyOnceWith("Ensalada de pasta", { size: "pequena" });
  });

  it("si el texto ya dice cuánto, no hay tamaños ni se manda uno", async () => {
    const { user, onSwap, field } = setup();
    await user.type(field, "media pizza");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await user.click(change());
    expect(onSwap).toHaveBeenCalledExactlyOnceWith("media pizza", undefined);
  });

  it("no manda un texto de una sola letra", async () => {
    const { user, onSwap, field } = setup();
    await user.type(field, "x");
    await user.click(change());
    expect(onSwap).not.toHaveBeenCalled();
    expect(screen.getByText(t("mealSwap.tooShort"))).toBeInTheDocument();
  });

  it("ante un texto vago se queda abierta y deja apuntar las kcal a mano", async () => {
    const { user, onSwap, onOpenChange, field } = setup(
      {},
      { ok: false, vague: true, message: "Dime qué has comido." },
    );
    await user.type(field, "algo rápido");
    await user.click(change());

    expect(screen.getByText("Dime qué has comido.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await user.type(screen.getByRole("textbox", { name: t("mealSwap.kcalLabel") }), "450");
    await user.click(screen.getByRole("button", { name: t("mealSwap.note") }));
    expect(onSwap).toHaveBeenLastCalledWith("algo rápido", { manualKcal: 450 });
  });

  it("sin ver cifras, un texto vago solo pide concretar", async () => {
    const { user, field } = setup(
      { showNumbers: false },
      { ok: false, vague: true, message: "Dime qué has comido." },
    );
    await user.type(field, "algo rápido");
    await user.click(change());

    expect(screen.getByText("Dime qué has comido.")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: t("mealSwap.kcalLabel") }),
    ).not.toBeInTheDocument();
  });

  it("«Me lo salté» avisa y cierra sin cambiar el plato", async () => {
    const { user, onSwap, onSkip, onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: t("mealSwap.skipped") }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onSwap).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("al cerrar con Escape el foco vuelve a la comida que lo abrió", async () => {
    // Como en Hoy: la hoja vive montada con `open={false}` y la abre una fila.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Cena
          </button>
          <MealSwapSheet
            open={open}
            onOpenChange={setOpen}
            mealLabel="Cena"
            plannedDish="Merluza a la plancha con brócoli"
            onSwap={async () => ({ ok: true })}
            onSkip={() => {}}
          />
        </>
      );
    }
    const user = userEvent.setup();
    renderApp(<Harness />);
    const opener = screen.getByRole("button", { name: "Cena" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    // Radix devuelve el foco en un `setTimeout`.
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
