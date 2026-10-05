import { describe, expect, test } from "bun:test";

import en from "@/locales/en.json";
import es from "@/locales/es.json";

import { QUOTE_COUNT, quoteIndexOfTheDay } from "./quotes";

describe("frase del día", () => {
  test("el catálogo tiene QUOTE_COUNT frases completas en los dos idiomas", () => {
    for (const catalog of [es, en]) {
      expect(catalog.quotes).toHaveLength(QUOTE_COUNT);
      for (const q of catalog.quotes) {
        expect(q.text.length).toBeGreaterThan(5);
        expect(q.author.length).toBeGreaterThan(2);
      }
    }
  });

  test("la misma todo el día, distinta al día siguiente y siempre dentro del catálogo", () => {
    const morning = quoteIndexOfTheDay(new Date(2026, 9, 5, 8));
    expect(quoteIndexOfTheDay(new Date(2026, 9, 5, 22))).toBe(morning);
    expect(quoteIndexOfTheDay(new Date(2026, 9, 6, 8))).toBe((morning + 1) % QUOTE_COUNT);
    for (let d = 1; d <= 366; d++) {
      const i = quoteIndexOfTheDay(new Date(2028, 0, d, 12));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(QUOTE_COUNT);
    }
  });
});
