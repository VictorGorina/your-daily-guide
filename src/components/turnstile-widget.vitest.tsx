import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERACTIVE_TIMEOUT_MS, INVISIBLE_TIMEOUT_MS } from "@/lib/captcha-bridge";
import i18next from "@/lib/i18n";

// La clave de sitio se lee al cargar el módulo: se fija antes de importarlo.
let widget: typeof import("./turnstile-widget");
beforeAll(async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  widget = await import("./turnstile-widget");
});

type Options = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];

/** Un `window.turnstile` de mentira: el test dispara a mano los callbacks de Cloudflare. */
function fakeTurnstile() {
  let options: Options | undefined;
  const api = {
    render: vi.fn((_container: HTMLElement, o: Options) => {
      options = o;
      return "w1";
    }),
    execute: vi.fn(),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  const cloudflare = () => {
    if (!options) throw new Error("el widget no se ha pintado");
    return options;
  };
  return { api, cloudflare };
}

function Harness({ onToken }: { onToken: (token: string | undefined) => void }) {
  const { slot, getToken } = widget.useTurnstile();
  return (
    <>
      {slot}
      <button type="button" onClick={() => void getToken().then(onToken)}>
        pedir
      </button>
    </>
  );
}

/** Pinta, pide un token y deja que el widget arranque. */
async function askForToken() {
  const onToken = vi.fn();
  const view = render(<Harness onToken={onToken} />);
  fireEvent.click(screen.getByRole("button", { name: "pedir" }));
  await advance(0);
  return { onToken, view };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const hint = () => screen.getByRole("status");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  delete window.turnstile;
});

describe("useTurnstile: cuánto se espera al token (ticket 29)", () => {
  it("devuelve el token en cuanto llega, y el siguiente intento reutiliza el widget", async () => {
    const { api, cloudflare } = fakeTurnstile();
    const { onToken } = await askForToken();
    expect(cloudflare()).toMatchObject({
      execution: "execute",
      appearance: "interaction-only",
      retry: "never",
    });
    expect(api.execute).toHaveBeenCalledWith("w1");

    act(() => cloudflare().callback("token-1"));
    await advance(0);
    expect(onToken).toHaveBeenCalledWith("token-1");

    fireEvent.click(screen.getByRole("button", { name: "pedir" }));
    await advance(0);
    expect(api.render).toHaveBeenCalledOnce();
    expect(api.reset).toHaveBeenCalledWith("w1");
    expect(api.execute).toHaveBeenCalledTimes(2);
  });

  it("un error de Cloudflare sigue sin token en el momento y lo da por tratado", async () => {
    const { cloudflare } = fakeTurnstile();
    const { onToken } = await askForToken();
    let handled: boolean | undefined;
    act(() => {
      handled = cloudflare()["error-callback"]("600010");
    });
    await advance(0);
    expect(handled).toBe(true);
    expect(onToken).toHaveBeenCalledWith(undefined);
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), "600010");
  });

  it("un navegador que Cloudflare no admite sigue sin token en el momento", async () => {
    const { cloudflare } = fakeTurnstile();
    const { onToken } = await askForToken();
    act(() => cloudflare()["unsupported-callback"]());
    await advance(0);
    expect(onToken).toHaveBeenCalledWith(undefined);
  });

  it("el reto que Cloudflare da por caducado sigue sin token en el momento", async () => {
    const { cloudflare } = fakeTurnstile();
    const { onToken } = await askForToken();
    act(() => cloudflare()["timeout-callback"]());
    await advance(0);
    expect(onToken).toHaveBeenCalledWith(undefined);
  });

  it("si Cloudflare no contesta, sigue sin token a los 20 s y retira el reto", async () => {
    const { api } = fakeTurnstile();
    const { onToken } = await askForToken();
    await advance(INVISIBLE_TIMEOUT_MS - 1);
    expect(onToken).not.toHaveBeenCalled();
    await advance(1);
    expect(onToken).toHaveBeenCalledWith(undefined);
    expect(api.reset).toHaveBeenCalledWith("w1");
  });

  it("con la casilla a la vista avisa y espera 30 s desde que aparece; otro reto no lo alarga", async () => {
    const { api, cloudflare } = fakeTurnstile();
    const { onToken } = await askForToken();
    expect(hint()).toBeEmptyDOMElement();

    await advance(3_000);
    act(() => cloudflare()["before-interactive-callback"]());
    expect(hint()).toHaveTextContent(i18next.t("auth.captchaHint"));

    // Pasado el tope de la fase invisible, sigue esperando a la persona.
    await advance(INVISIBLE_TIMEOUT_MS);
    expect(onToken).not.toHaveBeenCalled();

    // Un reto que vuelve a salir no reinicia la cuenta.
    act(() => cloudflare()["before-interactive-callback"]());
    await advance(INTERACTIVE_TIMEOUT_MS - INVISIBLE_TIMEOUT_MS - 1);
    expect(onToken).not.toHaveBeenCalled();
    await advance(1);
    expect(onToken).toHaveBeenCalledWith(undefined);
    expect(hint()).toBeEmptyDOMElement();
    expect(api.reset).toHaveBeenCalledWith("w1");
  });

  it("marcar la casilla a tiempo devuelve el token y quita el aviso", async () => {
    const { cloudflare } = fakeTurnstile();
    const { onToken } = await askForToken();
    act(() => cloudflare()["before-interactive-callback"]());
    await advance(5_000);
    act(() => cloudflare().callback("token-humano"));
    await advance(0);
    expect(onToken).toHaveBeenCalledWith("token-humano");
    expect(hint()).toBeEmptyDOMElement();
  });

  it("si el widget no arranca, sigue sin token en vez de fallar", async () => {
    const { api } = fakeTurnstile();
    api.render.mockImplementation(() => {
      throw new Error("sitekey inválida");
    });
    const { onToken } = await askForToken();
    expect(onToken).toHaveBeenCalledWith(undefined);
  });

  it("al desmontar la pantalla, la espera en curso termina sin token", async () => {
    const { api } = fakeTurnstile();
    const { onToken, view } = await askForToken();
    view.unmount();
    await advance(0);
    expect(onToken).toHaveBeenCalledWith(undefined);
    expect(api.remove).toHaveBeenCalledWith("w1");
  });

  // Va el último: deja la carga del script pendiente para el resto del archivo.
  it("un script que no llega a cargar tampoco pasa de 20 s", async () => {
    const { onToken } = await askForToken();
    expect(document.head.querySelector('script[src*="challenges.cloudflare.com"]')).not.toBeNull();
    await advance(INVISIBLE_TIMEOUT_MS);
    expect(onToken).toHaveBeenCalledWith(undefined);
  });
});
