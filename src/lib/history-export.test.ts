import { describe, expect, it } from "bun:test";

import type { DailyLog } from "./daily";
import { buildHistoryCsv, historyFileName } from "./history-export";

const macro = (moment: string, idea: string, kcal: number, extra: object = {}) => ({
  moment,
  idea,
  kcal,
  protein_g: 30.26,
  carbs_g: 40,
  fat_g: 12.5,
  fiber_g: 6,
  status: "calculado" as const,
  ...extra,
});

const log = (patch: Partial<DailyLog>): DailyLog =>
  ({
    id: "l",
    user_id: "u",
    log_date: "2026-10-02",
    weight_kg: null,
    habits: [],
    guide: null,
    mood: null,
    notes: null,
    evening_done: false,
    ...patch,
  }) as DailyLog;

const lines = (csv: string) =>
  csv
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split("\r\n");

describe("buildHistoryCsv", () => {
  it("lleva BOM, cabecera y una fila por comida con las cifras de la guía de ese día", () => {
    const csv = buildHistoryCsv(
      [
        log({
          habits: [{ label: "Comida", done: true, status: "plan" }],
          guide: { mealMacros: [macro("Comida", "Lentejas con arroz", 612.4)] } as never,
        }),
      ],
      { numbers: true },
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines(csv)).toEqual([
      "fecha;tipo;momento;plato_del_plan;detalle;estado;kcal;proteina_g;hidratos_g;grasa_g;fibra_g;minutos;peso_kg",
      "2026-10-02;Comida;Comida;Lentejas con arroz;Lentejas con arroz;Comí lo del plan;612;30,3;40;12,5;6;;",
    ]);
  });

  it("un cambio de plato enseña el del plan y lo que se comió", () => {
    const [, row] = lines(
      buildHistoryCsv(
        [
          log({
            habits: [
              {
                label: "Cena",
                done: true,
                status: "distinto",
                plannedIdea: "Merluza al horno",
                actual: "Pizza margarita",
              },
            ],
            guide: { mealMacros: [macro("Cena", "Pizza", 900)] } as never,
          }),
        ],
        { numbers: true },
      ),
    );
    expect(row).toStartWith(
      "2026-10-02;Comida;Cena;Merluza al horno;Pizza margarita;Comí distinto;900;",
    );
  });

  it("sin cifra no se inventa nada: saltada, sin registrar o calculando salen vacías", () => {
    const rows = lines(
      buildHistoryCsv(
        [
          log({
            habits: [
              { label: "Desayuno", done: false, status: "salteo" },
              { label: "Comida", done: false },
              { label: "Cena", done: true, status: "plan" },
            ],
            guide: {
              mealMacros: [
                macro("Desayuno", "Tostada", 300),
                macro("Comida", "Arroz", 500),
                macro("Cena", "Sopa", 0, { status: "calculando" }),
              ],
            } as never,
          }),
        ],
        { numbers: true },
      ),
    ).slice(1);
    expect(rows).toEqual([
      "2026-10-02;Comida;Desayuno;Tostada;;Me lo salté;;;;;;;",
      "2026-10-02;Comida;Comida;Arroz;;Sin registrar;;;;;;;",
      "2026-10-02;Comida;Cena;Sopa;Sopa;Comí lo del plan;;;;;;;",
    ]);
  });

  it("una cifra apuntada a mano solo trae kcal", () => {
    const [, row] = lines(
      buildHistoryCsv(
        [
          log({
            habits: [{ label: "Cena", done: true, status: "distinto" }],
            guide: { mealMacros: [macro("Cena", "Algo rápido", 700, { manual: true })] } as never,
          }),
        ],
        { numbers: true },
      ),
    );
    expect(row).toEndWith(";Comí distinto;700;;;;;;");
  });

  it("añade peso, picoteo y deporte, y ordena los días de antiguo a reciente", () => {
    const rows = lines(
      buildHistoryCsv(
        [
          log({
            log_date: "2026-10-03",
            weight_kg: 71.25,
            snacks: {
              entries: [
                {
                  id: "s",
                  text: "Almendras",
                  at: "2026-10-03T17:00:00Z",
                  kcal: 180,
                  protein_g: 6,
                  carbs_g: 3,
                  fat_g: 15,
                  fiber_g: 3,
                  source: "lookup",
                },
              ],
              compensatedKcal: 0,
            },
            exercise: {
              entries: [
                {
                  id: "e",
                  activity: "Correr",
                  minutes: 40,
                  intensity: "Moderada",
                  kcal: -120,
                  routine: true,
                  routineKcal: 280,
                  at: "2026-10-03T19:00:00Z",
                },
              ],
              compensatedKcal: 0,
            },
          }),
          log({ log_date: "2026-09-30", weight_kg: 72 }),
        ],
        { numbers: true },
      ),
    ).slice(1);
    expect(rows).toEqual([
      "2026-09-30;Peso;;;;;;;;;;;72",
      "2026-10-03;Peso;;;;;;;;;;;71,3",
      "2026-10-03;Picoteo;;;Almendras;;180;6;3;15;3;;",
      "2026-10-03;Deporte;;;Correr · Moderada;;-400;;;;;40;",
    ]);
  });

  it("con las cifras ocultas no hay columnas de kcal ni macros", () => {
    const rows = lines(
      buildHistoryCsv(
        [
          log({
            weight_kg: 70,
            habits: [{ label: "Comida", done: true, status: "plan" }],
            guide: { mealMacros: [macro("Comida", "Lentejas", 600)] } as never,
          }),
        ],
        { numbers: false },
      ),
    );
    expect(rows).toEqual([
      "fecha;tipo;momento;plato_del_plan;detalle;estado;minutos;peso_kg",
      "2026-10-02;Peso;;;;;;70",
      "2026-10-02;Comida;Comida;Lentejas;Lentejas;Comí lo del plan;;",
    ]);
  });

  it("escapa separadores y comillas, y desactiva lo que una hoja leería como fórmula", () => {
    const [, a, b] = lines(
      buildHistoryCsv(
        [
          log({
            habits: [
              { label: "Comida", done: true, status: "distinto", actual: 'Pasta; con "pesto"' },
              { label: "Cena", done: true, status: "distinto", actual: "=HYPERLINK(1)\nmalo" },
            ],
          }),
        ],
        { numbers: false },
      ),
    );
    expect(a).toContain(';"Pasta; con ""pesto""";');
    expect(b).toContain(";'=HYPERLINK(1) malo;");
  });
});

describe("historyFileName", () => {
  it("lleva la fecha de la descarga", () => {
    expect(historyFileName("2026-10-04")).toBe("peppers-historial-2026-10-04.csv");
  });
});
