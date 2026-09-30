import { afterEach, beforeEach, describe, expect, it, jest, mock, setSystemTime } from "bun:test";

import type { PendingDish, ResolvedDishes } from "./day-settle";

// El lote del día no se pierde si la app se cierra mientras `settleDay` vuela
// (ticket 27, PERF-11). Se prueban las dos copias con el mismo guion: la web
// (`localStorage` + `deps.settle`) y la móvil (`AsyncStorage` + `apiPost`).

type Body = { today: string; changes: { label: string; dish: string }[] };

let settled: Body[] = [];
/** Cómo responde la siguiente llamada a `settleDay`. */
let settleMode: "ok" | "fail" | "hold" = "ok";
let release: (() => void) | null = null;

async function settle(body: Body) {
  if (settleMode === "fail") throw new Error("day/settle 500");
  if (settleMode === "hold") await new Promise<void>((r) => (release = r));
  settled.push(body);
  return { outcome: "adjusted", kcal: 0 };
}

const store = new Map<string, string>();
const storageMethods: Record<string, unknown> = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
// `resume` lista las claves con `Object.keys(localStorage)`: como el de verdad,
// el doble enumera lo guardado y no sus métodos.
(globalThis as { localStorage?: unknown }).localStorage = new Proxy(storageMethods, {
  ownKeys: () => [...store.keys()],
  getOwnPropertyDescriptor: (_t, k) =>
    typeof k === "string" && store.has(k)
      ? { enumerable: true, configurable: true, value: store.get(k) }
      : undefined,
});

// Paquetes del móvil: en CI no hay mobile/node_modules, así que van sustituidos.
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
    getAllKeys: async () => [...store.keys()],
    multiRemove: async (ks: string[]) => ks.forEach((k) => store.delete(k)),
  },
}));
mock.module("react-native", () => ({ AppState: { addEventListener: () => {} } }));
mock.module("../../mobile/lib/api", () => ({
  apiPost: (_path: string, body: Body) => settle(body),
}));

const web = await import("./day-settle");
// Ruta en variable: el tsc de los tests no arrastra las dependencias de Expo.
const MOBILE_LIB = "../../mobile/lib";
const mobile = (await import(`${MOBILE_LIB}/day-settle`)) as typeof web;

const today = "2026-09-30";
const key = `day-settle:${today}`;
const NOW = new Date(`${today}T12:00:00Z`).getTime();
const MIN = 60_000;

const dish = (label: string, name: string): PendingDish => ({
  label,
  slot: label === "Cena" ? "cena" : "comida",
  dish: name,
  plannedDish: `${label} del plan`,
  prevKcal: 480,
});

type Stored = {
  dishes: PendingDish[];
  plain: boolean;
  inFlight?: { at: number; date: string; dishes: PendingDish[]; plain: boolean }[];
};
const stored = (k = key) => {
  const raw = store.get(k);
  return raw ? (JSON.parse(raw) as Stored) : null;
};

/** Deja correr las promesas encadenadas (IA, settle, AsyncStorage). */
async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe.each([
  ["web", web],
  ["móvil", mobile],
])("day-settle (%s): el lote en vuelo sigue guardado hasta que se asienta", (_name, lib) => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    settled = [];
    settleMode = "ok";
    release = null;
    store.clear();
    lib.bindDaySettleDeps({
      resolveDishDeltas: async (dishes: PendingDish[]): Promise<ResolvedDishes> => ({
        deltas: dishes.map((d) => ({ ...d, kcalDelta: 300, proteinDelta: null })),
        unresolved: [],
      }),
      settle: (opts: { data: Body }) => settle(opts.data),
      onDone: () => {},
    } as never);
  });

  afterEach(async () => {
    lib.cancelDaySettle();
    release?.();
    await drain();
    await lib.daySettleInFlight();
    jest.useRealTimers();
    setSystemTime();
  });

  it("mientras settle vuela, el lote está guardado; al acabar bien, se borra", async () => {
    settleMode = "hold";
    lib.queueDishChange(today, dish("Cena", "Pizza"));
    lib.flushDaySettle();
    await drain();

    // Si la app se cerrara ahora, el cambio seguiría en el almacenamiento.
    expect(stored()?.inFlight?.[0]?.dishes.map((d) => d.dish)).toEqual(["Pizza"]);

    release!();
    await drain();
    expect(settled).toHaveLength(1);
    expect(stored()).toBeNull();
  });

  it("si settle falla, el lote vuelve a la cola guardada, ya sin marca de vuelo", async () => {
    settleMode = "fail";
    lib.queueDishChange(today, dish("Cena", "Pizza"));
    lib.flushDaySettle();
    await drain();

    expect(stored()?.dishes.map((d) => d.dish)).toEqual(["Pizza"]);
    expect(stored()?.inFlight ?? []).toEqual([]);
  });

  it("lo que entra mientras vuela se guarda aparte y se queda al acabar", async () => {
    settleMode = "hold";
    lib.queueDishChange(today, dish("Cena", "Pizza"));
    lib.flushDaySettle();
    await drain();
    lib.queueDishChange(today, dish("Comida", "Lentejas"));
    await drain();
    expect(stored()?.dishes.map((d) => d.dish)).toEqual(["Lentejas"]);
    expect(stored()?.inFlight?.[0]?.dishes.map((d) => d.dish)).toEqual(["Pizza"]);

    release!();
    await drain();
    expect(stored()?.dishes.map((d) => d.dish)).toEqual(["Lentejas"]);
    expect(stored()?.inFlight ?? []).toEqual([]);
  });

  it("al abrir, un lote en vuelo de hace más de 5 min se trata como pendiente", async () => {
    store.set(
      key,
      JSON.stringify({
        dishes: [],
        plain: false,
        inFlight: [
          { at: NOW - 6 * MIN, date: today, dishes: [dish("Cena", "Pizza")], plain: false },
        ],
      }),
    );
    await lib.resumeDaySettle(today);
    await drain();

    expect(settled.map((b) => b.changes.map((c) => c.dish))).toEqual([["Pizza"]]);
    expect(stored()).toBeNull();
  });

  it("uno de hace 2 min puede seguir en el servidor: espera a cumplir 5", async () => {
    store.set(
      key,
      JSON.stringify({
        dishes: [],
        plain: true,
        inFlight: [
          { at: NOW - 2 * MIN, date: today, dishes: [dish("Cena", "Pizza")], plain: false },
        ],
      }),
    );
    await lib.resumeDaySettle(today);
    await drain();
    // Lo pendiente de verdad (picoteo) sale; el lote en vuelo, no.
    expect(settled.map((b) => b.changes.length)).toEqual([0]);
    expect(stored()?.inFlight?.[0]?.dishes.map((d) => d.dish)).toEqual(["Pizza"]);

    setSystemTime(NOW + 3 * MIN);
    jest.advanceTimersByTime(3 * MIN);
    await drain();
    expect(settled.map((b) => b.changes.map((c) => c.dish))).toEqual([[], ["Pizza"]]);
    expect(stored()).toBeNull();
  });

  it("un cambio nuevo de la misma comida manda sobre el lote que esperaba", async () => {
    store.set(
      key,
      JSON.stringify({
        dishes: [],
        plain: false,
        inFlight: [
          { at: NOW - 2 * MIN, date: today, dishes: [dish("Cena", "Pizza")], plain: false },
        ],
      }),
    );
    await lib.resumeDaySettle(today);
    lib.queueDishChange(today, dish("Cena", "Ensalada"));
    lib.flushDaySettle();
    await drain();

    setSystemTime(NOW + 3 * MIN);
    jest.advanceTimersByTime(3 * MIN);
    await drain();
    const sent = settled.flatMap((b) => b.changes.map((c) => c.dish));
    expect(sent).toEqual(["Ensalada"]);
  });

  it("un lote en vuelo de otro día se tira sin mandarse", async () => {
    const yesterday = "day-settle:2026-09-29";
    store.set(
      yesterday,
      JSON.stringify({
        dishes: [],
        plain: false,
        inFlight: [
          { at: NOW - 60 * MIN, date: "2026-09-29", dishes: [dish("Cena", "Pizza")], plain: false },
        ],
      }),
    );
    await lib.resumeDaySettle(today);
    await drain();

    expect(settled).toHaveLength(0);
    expect(store.has(yesterday)).toBe(false);
  });
});
