import { describe, expect, test } from "bun:test";

import { jwtClaims, linkForAnotherAccount } from "../../mobile/lib/link-claims";

// Ticket 38 (MOB-01): el móvil mira de quién es un enlace antes de instalar su sesión.
const b64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const jwt = (claims: unknown) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.firma`;

describe("jwtClaims", () => {
  test("lee `sub` y `email` sin verificar la firma", () => {
    expect(jwtClaims(jwt({ sub: "u-1", email: "ana@example.com" }))).toEqual({
      sub: "u-1",
      email: "ana@example.com",
    });
  });

  test("UTF-8 y base64url sin relleno", () => {
    for (const email of ["a@b.es", "ñandú+çà@example.com", "ab@c.io", "abc@d.io"]) {
      expect(jwtClaims(jwt({ sub: "u-1", email, name: "Íñigo ¿?~~>>" }))?.email).toBe(email);
    }
  });

  test("sin correo (sesión anónima) el `sub` basta", () => {
    expect(jwtClaims(jwt({ sub: "u-2" }))).toEqual({ sub: "u-2", email: null });
  });

  test("lo que no es un JWT legible da null", () => {
    for (const bad of [null, undefined, "", "abc", "a.b.c", `x.${b64url("texto")}.y`, jwt({})]) {
      expect(jwtClaims(bad)).toBeNull();
    }
  });
});

describe("linkForAnotherAccount", () => {
  const token = jwt({ sub: "u-1", email: "ana@example.com" });

  test("otra cuenta abierta: devuelve la del enlace", () => {
    expect(linkForAnotherAccount(token, "u-9")?.email).toBe("ana@example.com");
  });

  test("sin sesión, la misma cuenta o un token ilegible: no se pregunta", () => {
    expect(linkForAnotherAccount(token, null)).toBeNull();
    expect(linkForAnotherAccount(token, "u-1")).toBeNull();
    expect(linkForAnotherAccount("roto", "u-9")).toBeNull();
  });
});
