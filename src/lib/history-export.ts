import type { DailyLog } from "@/lib/daily";
import { cleanDayExercise } from "@/lib/exercise";
import { isMealCalculated } from "@/lib/macros";
import { cleanDaySnacks } from "@/lib/snacks";

/**
 * El historial de la persona en CSV (Ajustes → Datos y cuenta): una fila por
 * comida, picoteo, sesión de deporte y pesaje. No calcula nada: las cifras de
 * cada comida son las que ya guardó la guía de ese día (`guide.mealMacros`),
 * las mismas que suma el detalle del día, así que el archivo y la app no
 * pueden decir cosas distintas. Una comida sin cifra (saltada, sin registrar o
 * todavía "calculando") sale con las columnas vacías, nunca con un promedio.
 *
 * Formato para hojas de cálculo en español: separador `;`, coma decimal y BOM
 * (sin él Excel lee los acentos como Latin-1).
 */

const STATUS_LABEL: Record<string, string> = {
  plan: "Comí lo del plan",
  distinto: "Comí distinto",
  salteo: "Me lo salté",
};

const TEXT_COLUMNS = ["fecha", "tipo", "momento", "plato_del_plan", "detalle", "estado"];
const NUMBER_COLUMNS = ["kcal", "proteina_g", "hidratos_g", "grasa_g", "fibra_g"];
const TAIL_COLUMNS = ["minutos", "peso_kg"];

type Figures = {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
};

type Row = {
  date: string;
  kind: "Comida" | "Picoteo" | "Deporte" | "Peso";
  moment?: string;
  planned?: string;
  detail?: string;
  status?: string;
  figures?: Figures;
  minutes?: number;
  weightKg?: number;
};

/**
 * Un texto dentro de una celda. Lo que empieza por `=`, `+`, `-` o `@` lo
 * ejecutaría la hoja de cálculo como fórmula: se le antepone un apóstrofo. Los
 * platos los escribe la persona (y, en un hogar, otra persona).
 */
const cell = (value: string | undefined): string => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[;"]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const num = (value: number | undefined, digits: number): string => {
  if (value == null || !Number.isFinite(value)) return "";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor).replace(".", ",");
};

/** Las filas de un día, en el orden en que pasan: peso, comidas, picoteo, deporte. */
const rowsOfDay = (log: DailyLog): Row[] => {
  const date = log.log_date;
  const rows: Row[] = [];
  if (log.weight_kg != null) rows.push({ date, kind: "Peso", weightKg: Number(log.weight_kg) });

  const mealMacros = log.guide?.mealMacros ?? [];
  for (const habit of log.habits ?? []) {
    const macro = mealMacros.find((m) => m.moment === habit.label);
    const onPlan =
      macro?.idea ?? log.guide?.meals?.find((m) => m.moment === habit.label)?.idea ?? "";
    const eaten = habit.status === "plan" || habit.status === "distinto";
    // Una cifra apuntada a mano solo trae kcal: sus macros a 0 no son un dato.
    const figures: Figures | undefined =
      eaten && macro && isMealCalculated(macro)
        ? macro.manual
          ? { kcal: macro.kcal }
          : macro
        : undefined;
    rows.push({
      date,
      kind: "Comida",
      moment: habit.label,
      planned: habit.plannedIdea || habit.wasIdea || onPlan,
      detail: !eaten ? "" : habit.status === "distinto" ? habit.actual || onPlan : onPlan,
      status: habit.status ? STATUS_LABEL[habit.status] : "Sin registrar",
      figures,
    });
  }

  for (const snack of cleanDaySnacks(log.snacks)?.entries ?? []) {
    rows.push({
      date,
      kind: "Picoteo",
      detail: snack.text,
      figures: snack.source === "manual" ? { kcal: snack.kcal } : snack,
    });
  }

  for (const session of cleanDayExercise(log.exercise)?.entries ?? []) {
    rows.push({
      date,
      kind: "Deporte",
      detail: [session.activity, session.intensity].filter(Boolean).join(" · "),
      // La sesión entera, en negativo (es gasto): `kcal` solo guarda la parte
      // que desvía el día y `routineKcal` la que ya iba en el objetivo.
      figures: { kcal: -(Math.abs(session.kcal) + (session.routineKcal ?? 0)) },
      minutes: session.minutes,
    });
  }
  return rows;
};

/**
 * `numbers: false` (la persona eligió no ver cifras, `showsNutritionNumbers`)
 * deja fuera las columnas de kcal y macros: el archivo no enseña lo que la app
 * le oculta. El peso y los minutos de deporte no son cifras de nutrición.
 */
export function buildHistoryCsv(logs: readonly DailyLog[], opts: { numbers: boolean }): string {
  const columns = [...TEXT_COLUMNS, ...(opts.numbers ? NUMBER_COLUMNS : []), ...TAIL_COLUMNS];
  const lines = [columns.join(";")];
  const sorted = [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date));
  for (const row of sorted.flatMap(rowsOfDay)) {
    const f = row.figures;
    lines.push(
      [
        row.date,
        row.kind,
        cell(row.moment),
        cell(row.planned),
        cell(row.detail),
        cell(row.status),
        ...(opts.numbers
          ? [
              num(f?.kcal, 0),
              num(f?.protein_g, 1),
              num(f?.carbs_g, 1),
              num(f?.fat_g, 1),
              num(f?.fiber_g, 1),
            ]
          : []),
        num(row.minutes, 0),
        num(row.weightKg, 1),
      ].join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Nombre del archivo: "peppers-historial-2026-10-04.csv". */
export const historyFileName = (today: string) => `peppers-historial-${today}.csv`;
