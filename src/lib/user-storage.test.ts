import { describe, expect, it } from "bun:test";

import { STORAGE_OWNER_KEY, isUserKey, localDataAction } from "./user-storage";

describe("isUserKey", () => {
  it("las claves de una persona, en web y móvil", () => {
    for (const key of [
      STORAGE_OWNER_KEY,
      "peppers-onboarding-progress-v3",
      "peppers-onboarding-progress-v4",
      "recipe-warm:done",
      "day-settle:2026-09-29",
      "plan-recalc:2026-09",
      "plan-updated-notice:2026-10",
    ]) {
      expect(isUserKey(key)).toBe(true);
    }
  });

  it("las del dispositivo y la sesión de Supabase se quedan", () => {
    for (const key of [
      "peppers.locale",
      "senda-theme",
      "dg-theme",
      "sb-abcdefgh-auth-token",
      "ydg:pendingChatMessage",
    ]) {
      expect(isUserKey(key)).toBe(false);
    }
  });
});

describe("localDataAction", () => {
  it("al salir se borra, haya quien haya", () => {
    expect(localDataAction("SIGNED_OUT", "ana", null)).toBe("clear");
    expect(localDataAction("SIGNED_OUT", null, null)).toBe("clear");
  });

  it("entra otra cuenta sin haber salido: se borra lo de la anterior", () => {
    expect(localDataAction("SIGNED_IN", "ana", "bea")).toBe("switch");
    expect(localDataAction("INITIAL_SESSION", "ana", "bea")).toBe("switch");
  });

  it("sin dueño apuntado (versión anterior), lo guardado se lo queda quien entra", () => {
    expect(localDataAction("INITIAL_SESSION", null, "ana")).toBe("claim");
    expect(localDataAction("SIGNED_IN", null, "ana")).toBe("claim");
  });

  it("la misma cuenta no toca nada", () => {
    expect(localDataAction("INITIAL_SESSION", "ana", "ana")).toBe("none");
    expect(localDataAction("TOKEN_REFRESHED", "ana", "ana")).toBe("none");
    expect(localDataAction("USER_UPDATED", "ana", "ana")).toBe("none");
  });

  it("sin sesión y sin salir (sesión inicial vacía) no se borra", () => {
    expect(localDataAction("INITIAL_SESSION", "ana", null)).toBe("none");
    expect(localDataAction("INITIAL_SESSION", null, null)).toBe("none");
  });
});
