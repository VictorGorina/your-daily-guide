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
  });

  it("es un Error de verdad, para que `instanceof` funcione en apiPost", () => {
    expect(new RateLimitError(60, "hablar con el coach")).toBeInstanceOf(Error);
  });
});
