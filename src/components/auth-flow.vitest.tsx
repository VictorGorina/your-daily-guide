import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveProfile } from "@/lib/daily";
import i18next from "@/lib/i18n";
import { setFakeBrowser } from "@/test/browser-client";
import { renderApp } from "@/test/render";

import { AuthFlow } from "./auth-flow";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/daily", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/daily")>()),
  saveProfile: vi.fn(),
}));
// Server functions: sin el plugin de TanStack Start no se pueden importar.
vi.mock("@/lib/auth.functions", () => ({
  requestPasswordReset: vi.fn(),
  requestSignupConfirmation: vi.fn(),
}));
vi.mock("@/components/turnstile-widget", () => ({
  useTurnstile: () => ({ slot: null, getToken: async () => undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

const t = i18next.t.bind(i18next);
const save = vi.mocked(saveProfile);
const SESSION = { user: { id: "anon-1" } };

/**
 * Auth de supabase-js con lo que usa la pantalla. Como el de verdad,
 * `signInAnonymously` avisa de SIGNED_IN a los listeners ANTES de resolver: es
 * la carrera que mandaba la demo a /onboarding (2026-10-25).
 */
function fakeAuth() {
  let session: typeof SESSION | null = null;
  let listener: ((event: string, s: typeof SESSION | null) => void) | null = null;
  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: typeof listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInAnonymously: vi.fn(async () => {
      session = SESSION;
      listener?.("SIGNED_IN", session);
      return { data: { session }, error: null };
    }),
  };
  setFakeBrowser({ auth });
  return { auth, emit: (event: string) => listener?.(event, SESSION) };
}

beforeEach(() => {
  navigate.mockReset();
  save.mockReset();
});

describe("«Probar sin cuenta»", () => {
  it("no sale de la pantalla hasta guardar el perfil, y llega a Hoy con la caché del perfil invalidada", async () => {
    const user = userEvent.setup();
    const { auth } = fakeAuth();
    let release!: () => void;
    save.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    // `["profile"]` va sembrado a `null`: el perfil vacío que la raíz pidió al
    // entrar la cuenta anónima. Hoy no puede leer esa copia.
    const { queryClient } = renderApp(<AuthFlow initialStage="access" />);
    let profileInvalidated: boolean | undefined;
    navigate.mockImplementation(() => {
      profileInvalidated = queryClient.getQueryState(["profile"])?.isInvalidated;
    });

    await user.click(screen.getByRole("button", { name: t("auth.tryNoAccount") }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(auth.signInAnonymously).toHaveBeenCalledOnce();
    // Ya emitió SIGNED_IN, pero el perfil aún no está: no se navega.
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t("auth.demoCreating") })).toBeDisabled();

    release();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/hoy", replace: true }));
    expect(navigate).toHaveBeenCalledOnce();
    expect(profileInvalidated).toBe(true);
  });

  it("si guardar el perfil falla, se queda en la pantalla y reintentar reutiliza la sesión", async () => {
    const user = userEvent.setup();
    const { auth } = fakeAuth();
    save.mockRejectedValueOnce(new Error("sin red")).mockResolvedValueOnce(undefined);
    renderApp(<AuthFlow initialStage="access" />);

    await user.click(screen.getByRole("button", { name: t("auth.tryNoAccount") }));
    const retry = await screen.findByRole("button", { name: t("auth.tryNoAccount") });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(navigate).not.toHaveBeenCalled();

    await user.click(retry);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/hoy", replace: true }));
    expect(auth.signInAnonymously).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("listener de sesión", () => {
  it("fuera de la demo, SIGNED_IN (el enlace de confirmación) sigue llevando a Hoy", async () => {
    const { auth, emit } = fakeAuth();
    renderApp(<AuthFlow initialStage="access" />);
    await waitFor(() => expect(auth.onAuthStateChange).toHaveBeenCalled());

    emit("SIGNED_IN");
    expect(navigate).toHaveBeenCalledWith({ to: "/hoy", replace: true });
  });
});
