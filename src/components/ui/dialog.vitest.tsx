import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";

type ContentProps = Partial<ComponentProps<typeof DialogContent>>;

/**
 * Un panel abierto por estado y sin `DialogTrigger`, como el del día en el calendario: sigue
 * montado con `open={false}` y lo abren dos botones distintos.
 */
function StateHarness({ content = {} }: { content?: ContentProps }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <>
      {gone ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
      )}
      <button type="button" onClick={() => setOpen(true)}>
        Abrir desde otro
      </button>
      <button type="button">Otro sitio</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent {...content}>
          <DialogTitle>Panel</DialogTitle>
          <DialogDescription>Texto</DialogDescription>
          <button type="button" onClick={() => setGone(true)}>
            Quitar quien abrió
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

const button = (name: string) => screen.getByRole("button", { name });

async function openFrom(name: string, content?: ContentProps) {
  const user = userEvent.setup();
  renderApp(<StateHarness content={content} />);
  await user.click(button(name));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  return user;
}

const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

describe("Dialog abierto por estado, sin DialogTrigger", () => {
  // Radix devuelve el foco en un `setTimeout`: de ahí los `waitFor`.
  it("Escape devuelve el foco al botón que lo abrió", async () => {
    const user = await openFrom("Abrir");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button("Abrir")).toHaveFocus());
  });

  it("la «X» también devuelve el foco", async () => {
    const user = await openFrom("Abrir");
    await user.click(button("Cerrar"));
    await waitFor(() => expect(button("Abrir")).toHaveFocus());
  });

  it("recuerda quién lo abrió cada vez, no quién lo abrió la primera", async () => {
    const user = await openFrom("Abrir");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button("Abrir")).toHaveFocus());

    await user.click(button("Abrir desde otro"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button("Abrir desde otro")).toHaveFocus());
  });

  it("respeta el onCloseAutoFocus de quien lo usa si ya decidió el foco", async () => {
    const user = await openFrom("Abrir", {
      onCloseAutoFocus: (event) => {
        event.preventDefault();
        button("Otro sitio").focus();
      },
    });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button("Otro sitio")).toHaveFocus());
  });

  it("un onCloseAutoFocus que solo mira no impide devolver el foco", async () => {
    let calls = 0;
    const user = await openFrom("Abrir", { onCloseAutoFocus: () => calls++ });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button("Abrir")).toHaveFocus());
    expect(calls).toBe(1);
  });

  it("si quien lo abrió ya no está, cierra sin romperse", async () => {
    const user = await openFrom("Abrir");
    await user.click(button("Quitar quien abrió"));
    await user.keyboard("{Escape}");
    await closed();
    expect(screen.queryByRole("button", { name: "Abrir" })).not.toBeInTheDocument();
  });
});

describe("Dialog con DialogTrigger", () => {
  it("el foco vuelve al trigger aunque al abrir estuviera en otro sitio", async () => {
    const user = userEvent.setup();
    renderApp(
      <>
        <input aria-label="Campo" />
        <Dialog>
          <DialogTrigger>Abrir</DialogTrigger>
          <DialogContent>
            <DialogTitle>Panel</DialogTitle>
            <DialogDescription>Texto</DialogDescription>
          </DialogContent>
        </Dialog>
      </>,
    );
    // Safari no enfoca un botón al pulsarlo: el foco se queda donde estaba.
    screen.getByRole("textbox", { name: "Campo" }).focus();
    button("Abrir").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button("Abrir")).toHaveFocus());
  });
});
