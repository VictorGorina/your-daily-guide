import { describe, expect, test } from "bun:test";

import { currencySymbol, eur, formatMoney } from "./clean";

// Espacio duro de Intl entre cifra y símbolo: se normaliza para comparar.
const plain = (s: string) => s.replace(/\s/g, " ");

describe("formatMoney (ticket 34, I18N-02)", () => {
  test("en euros, idéntico a eur(): nadie en España ve ningún cambio", () => {
    expect(formatMoney(1234.5, "EUR")).toBe(eur(1234.5));
    expect(formatMoney(12, null)).toBe(eur(12));
    expect(formatMoney(12, undefined)).toBe(eur(12));
  });

  test("cada moneda con su símbolo y el formato de su país", () => {
    expect(plain(formatMoney(60, "GBP"))).toBe("60,00 £");
    expect(formatMoney(1234.5, "MXN")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "usd")).toBe("$1,234.50");
  });

  test("un código que no existe cae a euros en vez de lanzar", () => {
    expect(formatMoney(5, "XX")).toBe(eur(5));
  });
});

describe("currencySymbol", () => {
  test("el mismo símbolo que formatMoney", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol(null)).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("MXN")).toBe("$");
  });
});
