import { describe, expect, test } from "bun:test";

import { type CaptchaEvent, parseCaptchaMessage } from "./captcha-bridge";
import { captchaPageHtml } from "./captcha-page";

type RenderOptions = Record<string, (...args: unknown[]) => unknown> & { sitekey: string };

/**
 * Ejecuta el script de la página contra un `window` y un `document` de mentira
 * y devuelve lo que la página manda a la app, ya leído con `parseCaptchaMessage`
 * (como lo leería el móvil), más las opciones con las que pintó el widget.
 */
function runPage(siteKey: string | undefined, { scriptFails = false } = {}) {
  const html = captchaPageHtml(siteKey);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("la página no tiene script");

  const sent: (CaptchaEvent | null)[] = [];
  let options: RenderOptions | undefined;
  let loadedScript: { src?: string } | undefined;
  const fakeWindow: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (raw: string) => sent.push(parseCaptchaMessage(raw)) },
    turnstile: {
      render: (_selector: string, o: RenderOptions) => {
        options = o;
        return "w1";
      },
    },
  };
  const fakeDocument = {
    createElement: () => ({}) as { src?: string; onerror?: () => void },
    head: {
      appendChild: (element: { src?: string; onerror?: () => void }) => {
        loadedScript = element;
        if (scriptFails) element.onerror?.();
        else (fakeWindow.peppersCaptchaLoaded as () => void)();
      },
    },
  };
  new Function("window", "document", script)(fakeWindow, fakeDocument);
  return { sent, options, loadedScript };
}

describe("captchaPageHtml: la página del reto para el móvil (ticket 29)", () => {
  test("sin clave de sitio dice «off» y no carga Cloudflare", () => {
    for (const key of [undefined, "", "  "]) {
      const { sent, loadedScript } = runPage(key);
      expect(sent).toEqual([{ type: "off" }]);
      expect(loadedScript).toBeUndefined();
    }
  });

  test("con clave pinta el widget, que arranca solo, y carga el script en explícito", () => {
    const { sent, options, loadedScript } = runPage("1x00000000000000000000AA");
    expect(sent).toEqual([]);
    expect(options).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      appearance: "interaction-only",
      retry: "never",
    });
    expect(options).not.toHaveProperty("execution");
    expect(loadedScript?.src).toContain("challenges.cloudflare.com/turnstile/v0/api.js");
    expect(loadedScript?.src).toContain("render=explicit");
    expect(loadedScript?.src).toContain("onload=peppersCaptchaLoaded");
  });

  test("cada callback de Cloudflare llega a la app como un mensaje que el móvil entiende", () => {
    const { sent, options } = runPage("1x00000000000000000000AA");
    if (!options) throw new Error("no se pintó el widget");
    options.callback("token-de-prueba");
    expect(options["error-callback"](600010)).toBe(true);
    options["timeout-callback"]();
    options["unsupported-callback"]();
    options["before-interactive-callback"]();
    expect(sent).toEqual([
      { type: "token", token: "token-de-prueba" },
      { type: "error", code: "600010" },
      { type: "timeout" },
      { type: "unsupported" },
      { type: "interactive" },
    ]);
  });

  test("si el script de Cloudflare no carga, lo dice en vez de callar", () => {
    expect(runPage("1x00000000000000000000AA", { scriptFails: true }).sent).toEqual([
      { type: "error", code: "script" },
    ]);
  });

  test("la clave va como texto: un `</script>` no cierra la etiqueta", () => {
    const html = captchaPageHtml("x</script><script>alert(1)</script>");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(runPage('x</script>"').options?.sitekey).toBe('x</script>"');
  });
});
