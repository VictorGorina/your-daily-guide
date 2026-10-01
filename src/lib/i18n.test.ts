import { describe, expect, test } from "bun:test";

import { detectedLocale, htmlLang, offeredLocales } from "./i18n";

describe("B0 del ticket 34: inglés solo con la interfaz traducida", () => {
  test("sin la variable solo se ofrece español", () => {
    expect(offeredLocales(false, "es")).toEqual(["es"]);
  });

  test("quien ya eligió inglés lo conserva y puede volver a español", () => {
    expect(offeredLocales(false, "en")).toEqual(["es", "en"]);
  });

  test("con la variable, los dos", () => {
    expect(offeredLocales(true, "es")).toEqual(["es", "en"]);
  });

  test("<html lang> dice la lengua real del texto: español mientras no esté traducido", () => {
    expect(htmlLang("en", false)).toBe("es");
    expect(htmlLang("en", true)).toBe("en");
    expect(htmlLang("es", true)).toBe("es");
  });

  test("un navegador en inglés no cuela el inglés a quien llega nuevo", () => {
    expect(detectedLocale("en-GB", false)).toBe("es");
    expect(detectedLocale("en-GB", true)).toBe("en");
    expect(detectedLocale("fr-FR", true)).toBe("es");
  });
});
