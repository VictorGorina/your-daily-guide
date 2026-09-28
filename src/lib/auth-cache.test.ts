import { describe, expect, it } from "bun:test";

import { authCacheAction } from "./auth-cache";

describe("authCacheAction", () => {
  it("entra otra cuenta: se descarta la caché y se vuelve a pedir todo", () => {
    expect(authCacheAction("SIGNED_IN", "ana", "bea")).toBe("reset");
    expect(authCacheAction("SIGNED_IN", null, "bea")).toBe("reset");
  });

  it("la misma cuenta recupera la sesión: no se toca nada", () => {
    expect(authCacheAction("SIGNED_IN", "ana", "ana")).toBe("none");
    expect(authCacheAction("TOKEN_REFRESHED", "ana", "ana")).toBe("none");
  });

  it("al salir se borra la caché", () => {
    expect(authCacheAction("SIGNED_OUT", "ana", null)).toBe("clear");
  });

  it("un cambio en la cuenta invalida lo que hay", () => {
    expect(authCacheAction("USER_UPDATED", "ana", "ana")).toBe("invalidate");
  });

  it("la sesión inicial solo se apunta", () => {
    expect(authCacheAction("INITIAL_SESSION", undefined, "ana")).toBe("none");
  });

  it("si cambia el usuario sin SIGNED_IN (p. ej. un refresco con otra sesión), también reset", () => {
    expect(authCacheAction("TOKEN_REFRESHED", "ana", "bea")).toBe("reset");
  });
});
