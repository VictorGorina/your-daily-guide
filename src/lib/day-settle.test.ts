import { beforeEach, describe, expect, it } from "bun:test";

import {
  bindDaySettleDeps,
  cancelDaySettle,
  daySettleInFlight,
  flushDaySettle,
  queueDishChange,
  scheduleDaySettle,
  type PendingDish,
  type ResolvedDishes,
} from "./day-settle";

// `localStorage` en memoria: el runner de Bun no trae uno.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const today = "2026-09-29";
const dish: PendingDish = {
  label: "Cena",
  slot: "cena",
  dish: "Pizza",
  plannedDish: "Merluza con brócoli",
  prevKcal: 480,
};

let settled: unknown[] = [];
let releaseResolve: (() => void) | null = null;

function bind({ holdResolve = false } = {}) {
  bindDaySettleDeps({
    resolveDishDeltas: async (dishes): Promise<ResolvedDishes> => {
      if (holdResolve) await new Promise<void>((r) => (releaseResolve = r));
      return {
        deltas: dishes.map((d) => ({ ...d, kcalDelta: 300, proteinDelta: -10 })),
        unresolved: [],
      };
    },
    settle: async (opts) => {
      settled.push(opts.data);
      return null as never;
    },
    onDone: () => {},
  });
}

beforeEach(async () => {
  cancelDaySettle();
  await daySettleInFlight();
  settled = [];
  releaseResolve = null;
  store.clear();
});

describe("cancelDaySettle (ticket 18)", () => {
  it("sin cancelar, el lote se manda", async () => {
    bind();
    queueDishChange(today, dish);
    flushDaySettle();
    await daySettleInFlight();
    expect(settled).toHaveLength(1);
  });

  it("lo encolado de quien sale ya no se manda", async () => {
    bind();
    queueDishChange(today, dish);
    scheduleDaySettle(today);
    cancelDaySettle();
    flushDaySettle();
    await daySettleInFlight();
    expect(settled).toHaveLength(0);
  });

  it("un lote que esperaba a la IA no se asienta ni vuelve a la cola", async () => {
    bind({ holdResolve: true });
    queueDishChange(today, dish);
    flushDaySettle();
    const inFlight = daySettleInFlight();
    cancelDaySettle();
    releaseResolve?.();
    await inFlight;
    expect(settled).toHaveLength(0);
    flushDaySettle();
    await daySettleInFlight();
    expect(settled).toHaveLength(0);
  });
});
