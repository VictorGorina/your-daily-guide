import { beforeEach, describe, expect, it, mock } from "bun:test";

import { createFakeSupabase, type FakeRow, type FakeTables } from "@/test/fake-supabase";

// Columnas explícitas en las lecturas de `daily_logs` (ticket 17, PERF-07). El
// doble proyecta como PostgREST: un campo que no se pidió llega `undefined`.
// Así se prueba lo que importa — que los consumidores den lo mismo con las
// filas que de verdad llegan que con la fila entera —, en las dos apps.

const tables: FakeTables = { daily_logs: [] };
const fake = createFakeSupabase(tables);
mock.module("@/integrations/supabase/client", () => ({ supabase: fake.db }));
mock.module("../../mobile/lib/supabase", () => ({ supabase: fake.db }));
// La carga exige EXPO_PUBLIC_API_URL; ninguna lectura de logs pasa por la API.
mock.module("../../mobile/lib/api", () => ({
  apiPost: () => Promise.reject(new Error("sin API")),
}));

const web = await import("./daily");
const webPortion = await import("./nutrition/portion");
// Rutas en variable: tsc no sigue el import, y el typecheck de tests no arrastra
// las dependencias de Expo de mobile/lib/supabase.ts (en CI no hay
// mobile/node_modules; `portion` llega ahí por energy → daily). Los tipos del
// móvil los comprueba su propio tsc.
const MOBILE_LIB = "../../mobile/lib";
const mobile = (await import(`${MOBILE_LIB}/daily`)) as typeof web;
const mobilePortion = (await import(`${MOBILE_LIB}/portion`)) as typeof webPortion;
const { addDaysISO } = await import("./dates");

const DAILY_LOG_KEYS = [
  "id",
  "user_id",
  "log_date",
  "weight_kg",
  "habits",
  "guide",
  "mood",
  "notes",
  "evening_done",
  "snacks",
  "exercise",
  "adjustment",
].sort();

/** 20 días hacia atrás desde hoy, con todo lo que guarda la fila de verdad. */
function fullRows(today: string): FakeRow[] {
  return Array.from({ length: 20 }, (_, i) => ({
    id: `log-${i}`,
    user_id: "u1",
    log_date: addDaysISO(today, -i),
    weight_kg: i % 3 === 0 ? 70 + i / 10 : null,
    habits: [
      { label: "Comida", done: i % 2 === 0, status: i % 4 === 0 ? "distinto" : "plan" },
      {
        label: "Cena",
        done: i % 5 !== 0,
        status: "distinto",
        portionSize: i % 2 ? "grande" : "pequena",
      },
    ],
    guide: { text: "x".repeat(2000), targets: { kcal: 2000 } },
    mood: "bien",
    notes: "nota",
    evening_done: true,
    snacks: { items: [{ text: "manzana", kcal: 80 }] },
    exercise: { items: [] },
    adjustment: { record: null },
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-01T08:00:00Z",
  }));
}

const apps = [
  { name: "web", daily: web, portion: webPortion },
  { name: "móvil", daily: mobile, portion: mobilePortion },
] as const;

for (const { name, daily, portion } of apps) {
  describe(`lecturas de daily_logs (${name})`, () => {
    beforeEach(() => {
      tables.daily_logs = fullRows(daily.todayISO());
      fake.calls.length = 0;
    });

    it("fetchLogs pide solo lo que usan sus consumidores", async () => {
      await daily.fetchLogs();
      expect(fake.calls[0]?.columns.slice().sort()).toEqual(["habits", "log_date", "weight_kg"]);
    });

    it("los consumidores de fetchLogs dan lo mismo que con la fila entera", async () => {
      const full = tables.daily_logs as never[];
      const fetched = (await daily.fetchLogs()) as never[];
      expect(Object.keys(fetched[0] ?? {}).sort()).toEqual(["habits", "log_date", "weight_kg"]);
      expect(daily.impulsoFrom(fetched)).toBe(daily.impulsoFrom(full));
      expect(daily.weeklyTrendFrom(fetched)).toEqual(daily.weeklyTrendFrom(full));
      expect(daily.weeklyTrendFrom(full)).not.toBeNull();
      expect(portion.portionSizeHistory(fetched)).toEqual(portion.portionSizeHistory(full));
      expect(portion.portionSizeHistory(full).length).toBeGreaterThan(0);
    });

    it("fetchLogsForMonth trae los campos de DailyLog y nada más", async () => {
      const month = daily.todayISO().slice(0, 7);
      const logs = await daily.fetchLogsForMonth(month);
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) expect(Object.keys(log).sort()).toEqual(DAILY_LOG_KEYS);
    });
  });
}
