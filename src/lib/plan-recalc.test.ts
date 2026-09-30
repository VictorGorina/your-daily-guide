import { afterAll, afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test";

// Un recálculo pedido mientras otro está en marcha no se pierde (ticket 27,
// PERF-08). Se prueban las dos copias con el mismo guion: la web
// (`localStorage` + `fetch`) y la móvil (`AsyncStorage` + `apiPost`).

type Body = { month: string; today: string; scope: string };
type Call = { body: Body; resolve: () => void; reject: () => void };

// Cada llamada a `plan/reflow` se queda esperando hasta que el test la suelta.
let calls: Call[] = [];
function reflow(body: Body): Promise<{ scope: string }> {
  return new Promise((resolve, reject) => {
    calls.push({
      body,
      resolve: () => resolve({ scope: body.scope }),
      reject: () => reject(new Error("plan/reflow 500")),
    });
  });
}

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));
// Paquetes del móvil: en CI no hay mobile/node_modules, así que van sustituidos.
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));
mock.module("react-native", () => ({ AppState: { addEventListener: () => {} } }));
mock.module("../../mobile/lib/api", () => ({
  apiPost: (_path: string, body: Body) => reflow(body),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const result = await reflow(JSON.parse(init.body) as Body);
  return new Response(JSON.stringify(result));
}) as typeof fetch;

const web = await import("./plan-recalc");
// Ruta en variable: el tsc de los tests no arrastra las dependencias de Expo.
const MOBILE_LIB = "../../mobile/lib";
const mobile = (await import(`${MOBILE_LIB}/plan-recalc`)) as typeof web;

const month = "2026-10";
const today = "2026-10-03";
const key = `plan-recalc:${month}`;

/** Deja correr las promesas encadenadas (sesión, fetch, json, finally). */
async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe.each([
  ["web", web],
  ["móvil", mobile],
])("plan-recalc (%s): no pierde un recálculo pedido mientras corre otro", (_name, lib) => {
  beforeEach(() => {
    jest.useFakeTimers();
    calls = [];
    store.clear();
  });

  afterEach(async () => {
    // Nada de un test pasa al siguiente: se cancela lo encolado y se sueltan
    // las llamadas que queden en vuelo.
    lib.cancelPlanRecalc();
    for (let i = 0; i < 5 && calls.length; i++) {
      for (const c of calls.splice(0)) c.resolve();
      await drain();
    }
    jest.useRealTimers();
  });

  it("programar meals, arranca, programar full mientras corre → al terminar se lanza un full", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();
    expect(calls.map((c) => c.body.scope)).toEqual(["meals"]);

    lib.schedulePlanRecalc(month, today, "full");
    jest.advanceTimersByTime(6000); // el debounce vence con el primero aún en marcha
    await drain();
    expect(calls).toHaveLength(1);

    calls[0].resolve();
    await drain();
    expect(calls.map((c) => c.body.scope)).toEqual(["meals", "full"]);
  });

  it("el pendiente guardado sigue ahí hasta que termina el de la cola", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();
    lib.schedulePlanRecalc(month, today, "meals");
    await drain();

    calls[0].resolve();
    await drain();
    // El primero terminó, pero el segundo aún no: si la app se cerrara ahora,
    // Plan tiene que poder relanzarlo al abrirse.
    expect(store.has(key)).toBe(true);

    jest.advanceTimersByTime(6000);
    await drain();
    expect(calls).toHaveLength(2);
    calls[1].resolve();
    await drain();
    expect(store.has(key)).toBe(false);
  });

  it("si la persona sigue editando, la cola respeta el debounce", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(1000);

    calls[0].resolve();
    await drain();
    expect(calls).toHaveLength(1); // quedan ~5 s de calma

    jest.advanceTimersByTime(5000);
    await drain();
    expect(calls).toHaveLength(2);
  });

  it("dos cambios en cola se funden en uno y full gana a meals", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();
    lib.schedulePlanRecalc(month, today, "full");
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();

    calls[0].resolve();
    await drain();
    expect(calls.map((c) => c.body.scope)).toEqual(["meals", "full"]);
  });

  it("si el que corría falla, el de la cola se lanza igual", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();

    calls[0].reject();
    await drain();
    expect(calls).toHaveLength(2);
  });

  it("salir de la cuenta tira la cola: no se relanza con la sesión de otro", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    await drain();
    lib.schedulePlanRecalc(month, today, "meals");
    jest.advanceTimersByTime(6000);
    lib.cancelPlanRecalc();

    calls[0].resolve();
    await drain();
    expect(calls).toHaveLength(1);
  });

  it("sin nada en cola, al terminar se borra el pendiente guardado", async () => {
    lib.schedulePlanRecalc(month, today, "meals");
    expect(store.has(key)).toBe(true);
    jest.advanceTimersByTime(6000);
    await drain();
    calls[0].resolve();
    await drain();
    expect(calls).toHaveLength(1);
    expect(store.has(key)).toBe(false);
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});
