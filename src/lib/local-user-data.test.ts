import { beforeEach, describe, expect, it } from "bun:test";

// `localStorage` y `sessionStorage` en memoria: el runner de Bun no los trae.
function memoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}
const local = memoryStorage();
const session = memoryStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session });

const { clearLocalUserData, syncLocalUserData } = await import("./local-user-data");
const { STORAGE_OWNER_KEY } = await import("./user-storage");

function seed(owner: string | null) {
  local.store.clear();
  session.store.clear();
  if (owner) local.setItem(STORAGE_OWNER_KEY, owner);
  local.setItem("peppers-onboarding-progress-v3", '{"step":4}');
  local.setItem("day-settle:2026-09-29", "{}");
  local.setItem("plan-recalc:2026-09", "{}");
  local.setItem("plan-updated-notice:2026-09", "1");
  local.setItem("recipe-warm:done", "[]");
  local.setItem("peppers.locale", "es");
  local.setItem("senda-theme", "oscuro");
  local.setItem("sb-proyecto-auth-token", "{}");
  session.setItem("ydg:pendingChatMessage", "hola");
}

const deviceKeys = ["peppers.locale", "senda-theme", "sb-proyecto-auth-token"];

describe("clearLocalUserData", () => {
  beforeEach(() => seed("ana"));

  it("borra todo lo de la persona y deja lo del dispositivo", () => {
    clearLocalUserData();
    expect([...local.store.keys()].sort()).toEqual([...deviceKeys].sort());
    expect(session.store.size).toBe(0);
  });
});

describe("syncLocalUserData", () => {
  it("al salir no queda nada de la persona ni su dueño", () => {
    seed("ana");
    syncLocalUserData("SIGNED_OUT", null);
    expect([...local.store.keys()].sort()).toEqual([...deviceKeys].sort());
  });

  it("entra otra cuenta: se borra lo de la anterior y se apunta la nueva", () => {
    seed("ana");
    syncLocalUserData("SIGNED_IN", "bea");
    expect(local.getItem(STORAGE_OWNER_KEY)).toBe("bea");
    expect(local.getItem("peppers-onboarding-progress-v3")).toBeNull();
    expect(local.getItem("peppers.locale")).toBe("es");
  });

  it("al actualizar (sin dueño) el borrador sigue ahí para quien tiene la sesión", () => {
    seed(null);
    syncLocalUserData("INITIAL_SESSION", "ana");
    expect(local.getItem(STORAGE_OWNER_KEY)).toBe("ana");
    expect(local.getItem("peppers-onboarding-progress-v3")).toBe('{"step":4}');
    expect(local.getItem("day-settle:2026-09-29")).toBe("{}");
  });

  it("la misma cuenta no toca nada", () => {
    seed("ana");
    syncLocalUserData("TOKEN_REFRESHED", "ana");
    expect(local.store.size).toBe(9);
    expect(session.store.size).toBe(1);
  });
});
