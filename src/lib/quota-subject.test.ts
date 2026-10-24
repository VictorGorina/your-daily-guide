import { describe, expect, it } from "bun:test";

import { clientIp, normalizeEmailForQuota } from "./quota-subject";

describe("normalizeEmailForQuota", () => {
  it("minúsculas y sin espacios", () => {
    expect(normalizeEmailForQuota("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it("quita la +etiqueta en cualquier dominio", () => {
    expect(normalizeEmailForQuota("ana+1@example.com")).toBe("ana@example.com");
    expect(normalizeEmailForQuota("ana+a+b@outlook.es")).toBe("ana@outlook.es");
  });

  it("en Gmail quita también los puntos y junta googlemail.com", () => {
    expect(normalizeEmailForQuota("a.n.a+x@gmail.com")).toBe("ana@gmail.com");
    expect(normalizeEmailForQuota("A.na@GoogleMail.com")).toBe("ana@gmail.com");
  });

  it("fuera de Gmail los puntos cuentan: son buzones distintos", () => {
    expect(normalizeEmailForQuota("a.na@example.com")).toBe("a.na@example.com");
  });

  it("no junta todas las direcciones que empiezan por +", () => {
    expect(normalizeEmailForQuota("+1@example.com")).toBe("+1@example.com");
    expect(normalizeEmailForQuota("+2@example.com")).not.toBe(
      normalizeEmailForQuota("+1@example.com"),
    );
  });

  it("un nombre de Gmail que solo tiene puntos se deja como está", () => {
    expect(normalizeEmailForQuota("..@gmail.com")).toBe("..@gmail.com");
  });

  it("sin @ devuelve el texto limpio (el validador ya lo habrá rechazado)", () => {
    expect(normalizeEmailForQuota(" Nada ")).toBe("nada");
    expect(normalizeEmailForQuota("@example.com")).toBe("@example.com");
  });
});

describe("clientIp", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("el primer valor de x-forwarded-for, sin espacios", () => {
    expect(clientIp(headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("IPv6 en minúsculas, para que cuente como la misma", () => {
    expect(clientIp(headers({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
  });

  it("sin la cabecera, o vacía, no hay IP", () => {
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": " , 10.0.0.1" }))).toBeNull();
  });
});
