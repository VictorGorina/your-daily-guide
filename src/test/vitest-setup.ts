import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// El catálogo de verdad, en español: un test busca el texto con `i18next.t`,
// así no se rompe al retocar una frase y sí si la clave deja de pintarse.
import i18next from "@/lib/i18n";

import { resetFakeBrowser, testBrowser } from "./browser-client";

// Ningún test de componentes habla con Supabase: ver browser-client.ts.
vi.mock("@/integrations/supabase/client", () => ({ supabase: testBrowser }));

afterEach(async () => {
  cleanup();
  resetFakeBrowser();
  localStorage.clear();
  if (i18next.language !== "es") await i18next.changeLanguage("es");
});

// Lo que jsdom no trae y piden Radix (hojas, diálogos) y los componentes que
// miran el tamaño o el tema.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
