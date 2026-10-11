import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { monthISO } from "@/lib/daily";
import i18next from "@/lib/i18n";
import { renderApp } from "@/test/render";

import CoachPanel from "./coach-panel";

// Aquí se prueba el panel como diálogo (A11Y-04), no la conversación: el chat
// queda vacío y en reposo, y ninguna herramienta corre.
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    error: undefined,
    addToolResult: vi.fn(),
  }),
}));
vi.mock("@/lib/use-coach-actions", () => ({
  useCoachActions: () => ({ runToolDetailed: vi.fn(), refresh: vi.fn() }),
}));

const t = i18next.t.bind(i18next);

function mount(props: Partial<Parameters<typeof CoachPanel>[0]> = {}) {
  const user = userEvent.setup();
  renderApp(
    <>
      <button type="button">Otro sitio</button>
      <CoachPanel hidden={false} defaultOpen={false} {...props} />
    </>,
    {
      queries: [
        [["today"], null],
        [["plan", monthISO()], null],
      ],
    },
  );
  return user;
}

const fab = () => screen.getByRole("button", { name: t("chat.fab.open") });
const message = () => screen.getByRole("textbox", { name: t("chat.messageLabel") });
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

describe("CoachPanel", () => {
  it("el botón abre un diálogo con su título y el foco va al campo de texto", async () => {
    const user = mount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(fab());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(t("chat.fab.title"));
    expect(dialog).toHaveAccessibleDescription(t("chat.fab.subtitle"));
    await waitFor(() => expect(message()).toHaveFocus());
  });

  it("Tab no sale del panel", async () => {
    const user = mount();
    await user.click(fab());
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(message()).toHaveFocus());
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  // Radix devuelve el foco en un `setTimeout`: de ahí los `waitFor`.
  it("Escape cierra y devuelve el foco al botón", async () => {
    const user = mount();
    await user.click(fab());
    await user.keyboard("{Escape}");
    await closed();
    await waitFor(() => expect(fab()).toHaveFocus());
  });

  it("su «X» cierra y devuelve el foco al botón", async () => {
    const user = mount();
    await user.click(fab());
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: t("chat.fab.close") }));
    await closed();
    await waitFor(() => expect(fab()).toHaveFocus());
  });

  // El toque sobre el marcador de coach-fab.tsx: quien tenía el foco ya no existe.
  it("montado ya abierto, al cerrar el foco también acaba en el botón", async () => {
    const user = mount({ defaultOpen: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await closed();
    await waitFor(() => expect(fab()).toHaveFocus());
  });

  it("oculto (en /chat) no pinta ni el botón ni el panel", () => {
    mount({ hidden: true, defaultOpen: true });
    expect(screen.queryByRole("button", { name: t("chat.fab.open") })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
