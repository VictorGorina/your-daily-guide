import { describe, expect, it } from "bun:test";

import { RateLimitError, retryAfterText } from "./rate-limit-error";

describe("retryAfterText", () => {
  it("no promete un tiempo cuando no lo sabe", () => {
    expect(retryAfterText(0)).toBe("un momento");
    expect(retryAfterText(-5)).toBe("un momento");
    expect(retryAfterText(Number.NaN)).toBe("un momento");
  });

  it("agrupa lo que falta menos de un minuto", () => {
    expect(retryAfterText(1)).toBe("menos de un minuto");
    expect(retryAfterText(59)).toBe("menos de un minuto");
  });

  it("redondea hacia arriba en minutos y concuerda el singular", () => {
    expect(retryAfterText(60)).toBe("1 minuto");
    expect(retryAfterText(61)).toBe("2 minutos");
    expect(retryAfterText(600)).toBe("10 minutos");
  });

  it("pasa a horas sin encadenar dos redondeos", () => {
    // Con un `ceil` a minutos y otro a horas, 3601 s daba "2 horas".
    expect(retryAfterText(3600)).toBe("1 hora");
    expect(retryAfterText(3601)).toBe("2 horas");
    expect(retryAfterText(7200)).toBe("2 horas");
    expect(retryAfterText(86399)).toBe("24 horas");
  });

  it("pasa a días desde las 24 horas (tope de gasto mensual)", () => {
    expect(retryAfterText(86400)).toBe("1 día");
    expect(retryAfterText(86401)).toBe("2 días");
    expect(retryAfterText(15 * 86400 + 6 * 3600)).toBe("16 días");
  });
});

describe("RateLimitError", () => {
  it("arma un mensaje listo para enseñar, con la acción y el tiempo", () => {
    const error = new RateLimitError(600, "generar el plan");
    expect(error.message).toBe(
      "Has hecho esto muchas veces seguidas. Puedes volver a generar el plan en 10 minutos.",
    );
    expect(error.retryAfterSeconds).toBe(600);
    expect(error.name).toBe("RateLimitError");
    expect(error.scope).toBe("window");
  });

  it("con el tope de gasto no dice que se ha repetido algo seguido", () => {
    expect(new RateLimitError(5 * 3600, "escanear un tiquet", "day").message).toBe(
      "Por hoy ya has llegado al tope de uso del coach. Puedes volver a escanear un tiquet en 5 horas.",
    );
    const monthly = new RateLimitError(10 * 86400, "hablar con el coach", "month");
    expect(monthly.message).toBe(
      "Este mes ya has llegado al tope de uso del coach. Puedes volver a hablar con el coach en 10 días.",
    );
    expect(monthly.scope).toBe("month");
  });

  it("es un Error de verdad, para que `instanceof` funcione en apiPost", () => {
    expect(new RateLimitError(60, "hablar con el coach")).toBeInstanceOf(Error);
  });
});
