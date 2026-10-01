import { describe, expect, test } from "bun:test";

import { detectedLocale, dictationLang, htmlLang, offeredLocales } from "./i18n";

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

describe("dictationLang", () => {
  test("español con la variante del país cuando la hay", () => {
    expect(dictationLang("es", "ES")).toBe("es-ES");
    expect(dictationLang("es", "MX")).toBe("es-MX");
    expect(dictationLang("es", "us")).toBe("es-US");
    expect(dictationLang("es", "GB")).toBe("es-ES");
  });

  test("sin perfil, como antes", () => {
    expect(dictationLang(null, null)).toBe("es-ES");
  });

  test("quien conserva el inglés dicta en inglés", () => {
    expect(dictationLang("en", "GB")).toBe("en-GB");
    expect(dictationLang("en", "ES")).toBe("en-US");
  });
});
