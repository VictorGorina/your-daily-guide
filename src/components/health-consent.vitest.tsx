import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveProfile } from "@/lib/daily";
import { HEALTH_CONSENT_VERSION, HEALTH_PROFILE_FIELDS } from "@/lib/health-consent";
import i18next from "@/lib/i18n";
import { renderApp } from "@/test/render";

import { HealthConsentGate, HealthConsentStep } from "./health-consent";

vi.mock("@/lib/daily", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daily")>()),
  saveProfile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const t = i18next.t.bind(i18next);
const save = vi.mocked(saveProfile);

beforeEach(() => save.mockClear());

describe("paso de consentimiento del onboarding (ticket 30)", () => {
  it("«Aceptar» solo se activa con la casilla y guarda la versión del texto", async () => {
    const user = userEvent.setup();
    renderApp(<HealthConsentStep onDeclined={vi.fn()} />);
    const accept = screen.getByRole("button", { name: t("healthConsent.accept") });
    expect(accept).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: t("healthConsent.checkbox") })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: t("healthConsent.checkbox") }));
    expect(accept).toBeEnabled();
    await user.click(accept);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        health_consent_at: expect.any(String),
        health_consent_version: HEALTH_CONSENT_VERSION,
      }),
    );
  });

  it("«Seguir sin datos de salud» avisa antes y no guarda nada", async () => {
    const user = userEvent.setup();
    const onDeclined = vi.fn();
    renderApp(<HealthConsentStep onDeclined={onDeclined} />);
    await user.click(screen.getByRole("button", { name: t("healthConsent.decline") }));
    expect(await screen.findByText(t("healthConsent.declineWarning.body"))).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: t("healthConsent.declineWarning.confirm") }),
    );
    expect(onDeclined).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it("enlaza a la política de privacidad", () => {
    renderApp(<HealthConsentStep onDeclined={vi.fn()} />);
    expect(screen.getByRole("link", { name: t("healthConsent.policy") })).toHaveAttribute(
      "href",
      "/privacidad",
    );
  });
});

describe("hoja para las cuentas de antes", () => {
  const before = { id: "u1", onboarding_completed: true, medications: "metformina" };

  it("sale a quien guarda datos de salud sin consentimiento, y «No acepto» los borra", async () => {
    const user = userEvent.setup();
    renderApp(<HealthConsentGate />, { queries: [[["profile"], before]] });
    expect(await screen.findByText(t("healthConsent.introExisting"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("healthConsent.declineExisting") }));
    await user.click(
      await screen.findByRole("button", { name: t("healthConsent.deleteWarning.confirm") }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const patch = save.mock.calls[0]![0] as Record<string, unknown>;
    for (const field of HEALTH_PROFILE_FIELDS) expect(patch[field]).toBeNull();
    expect(patch.health_consent_at).toBeNull();
  });

  it("no sale con el consentimiento dado, ni sin datos de salud, ni en el onboarding", () => {
    for (const profile of [
      { ...before, health_consent_at: "2026-10-24T10:00:00Z", health_consent_version: "2026-10" },
      { ...before, medications: null },
      { ...before, onboarding_completed: false },
    ]) {
      const { unmount } = renderApp(<HealthConsentGate />, { queries: [[["profile"], profile]] });
      expect(screen.queryByText(t("healthConsent.introExisting"))).not.toBeInTheDocument();
      unmount();
    }
  });
});
