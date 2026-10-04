import type { ChatMessage, DailyGuide, DailyLog, DailyLogHistory } from "@/lib/daily";
import type { MacroEstimate, MealMacroEstimate } from "@/lib/guide.functions";
import type { MealHabit } from "@/lib/plan-shared";
import { cleanDayAdjustment } from "@/lib/day-balance";
import { cleanDayExercise } from "@/lib/exercise";
import { cleanDaySnacks } from "@/lib/snacks";

/**
 * De la fila que devuelve la base de datos al tipo de la app (CAL-02, ticket 24
 * de la auditoría). Las columnas jsonb llegan como "JSON cualquiera": aquí se
 * comprueban al leer en vez de convertirlas con `as unknown as`.
 *
 * Regla: ante la duda se deja pasar. Una clave que este módulo no conoce se
 * CONSERVA (un campo nuevo no desaparece por no estar aquí); una clave conocida
 * con el tipo equivocado se quita, o cae en su valor por defecto si es
 * obligatoria. Solo se descarta entera una entrada sin lo mínimo para pintarla
 * (una comida sin `label`, un plato calculado sin `moment` o sin cifras).
 *
 * Puro, sin Supabase. Copia en `mobile/lib/day-row.ts`.
 */

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const texts = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** Quita de `o` las claves de `keys` cuyo valor no pasa `ok`. */
function dropUnless(o: Bag, keys: readonly string[], ok: (v: unknown) => boolean) {
  for (const k of keys) if (k in o && !ok(o[k])) delete o[k];
}

const HABIT_TEXT = ["plannedIdea", "wasIdea", "actual", "adjustmentSummary", "confirmedIdea"];
const HABIT_NUMBER = [
  "plannedKcal",
  "plannedProtein",
  "manualKcal",
  "adjustmentKcal",
  "swapKcalDelta",
  "swapProteinDelta",
];
const MEAL_STATUS = ["plan", "distinto", "salteo"];
const PORTION_SIZE = ["pequena", "normal", "grande"];

/** `daily_logs.habits`: las comidas del día. Sin `label` no hay comida que pintar. */
export function cleanHabits(raw: unknown): MealHabit[] {
  if (!Array.isArray(raw)) return [];
  const out: MealHabit[] = [];
  for (const entry of raw) {
    if (!isBag(entry) || !text(entry.label).trim()) continue;
    const o: Bag = { ...entry, done: entry.done === true };
    dropUnless(o, HABIT_TEXT, (v) => typeof v === "string");
    dropUnless(o, HABIT_NUMBER, isNum);
    dropUnless(o, ["status"], (v) => MEAL_STATUS.includes(v as string));
    dropUnless(o, ["portionSize"], (v) => PORTION_SIZE.includes(v as string));
    dropUnless(o, ["swapCompensated"], (v) => typeof v === "boolean");
    if ("adjustmentChanges" in o) {
      if (Array.isArray(o.adjustmentChanges))
        o.adjustmentChanges = o.adjustmentChanges.filter(isBag);
      else delete o.adjustmentChanges;
    }
    out.push(o as MealHabit);
  }
  return out;
}

const MACRO_KEYS = ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"] as const;

/** Las cinco cifras, o `null` si falta alguna: media cifra no es una cifra. */
function cleanMacros(raw: unknown): MacroEstimate | null {
  if (!isBag(raw) || !MACRO_KEYS.every((k) => isNum(raw[k]))) return null;
  return raw as MacroEstimate;
}

/** `guide.mealMacros`: el plato sin `moment` o sin cifras se vuelve a pedir, no se inventa. */
function cleanMealMacros(raw: unknown): MealMacroEstimate[] {
  if (!Array.isArray(raw)) return [];
  const out: MealMacroEstimate[] = [];
  for (const entry of raw) {
    if (!cleanMacros(entry) || !isBag(entry) || !text(entry.moment)) continue;
    const o: Bag = { ...entry };
    dropUnless(o, ["idea"], (v) => typeof v === "string");
    dropUnless(o, ["status"], (v) => v === "calculado" || v === "calculando");
    dropUnless(o, ["vague", "manual"], (v) => typeof v === "boolean");
    dropUnless(o, ["portion"], isNum);
    out.push(o as MealMacroEstimate);
  }
  return out;
}

/** `daily_logs.guide`: la guía del día. `null` si la fila aún no la tiene. */
export function cleanGuide(raw: unknown): DailyGuide | null {
  if (!isBag(raw)) return null;
  const o: Bag = {
    ...raw,
    intro: text(raw.intro),
    calories: text(raw.calories),
    macros: text(raw.macros),
    behaviors: texts(raw.behaviors),
  };
  if ("macroEstimate" in o) o.macroEstimate = cleanMacros(o.macroEstimate);
  if ("targets" in o) o.targets = cleanMacros(o.targets);
  if ("mealMacros" in o) o.mealMacros = o.mealMacros == null ? null : cleanMealMacros(o.mealMacros);
  dropUnless(o, ["portionFactor"], isNum);
  if ("tips" in o) o.tips = texts(o.tips);
  if ("meals" in o) {
    o.meals = (Array.isArray(o.meals) ? o.meals : [])
      .filter((m): m is Bag => isBag(m) && !!text(m.moment))
      .map((m) => ({ ...m, moment: text(m.moment), idea: text(m.idea) }));
  }
  return o as DailyGuide;
}

/** Lo que `fetchLogs` pide de cada día. `null` si la fila no trae fecha. */
export function toDailyLogHistory(raw: unknown): DailyLogHistory | null {
  if (!isBag(raw) || !text(raw.log_date)) return null;
  return {
    log_date: text(raw.log_date),
    weight_kg: isNum(raw.weight_kg) ? raw.weight_kg : null,
    habits: cleanHabits(raw.habits),
  };
}

/**
 * La fila de `daily_logs`. Picoteo, deporte y ajuste solo se rellenan si la
 * lectura los pidió: una columna que no se seleccionó sigue sin estar.
 */
export function toDailyLog(raw: unknown): DailyLog | null {
  const base = toDailyLogHistory(raw);
  if (!base || !isBag(raw)) return null;
  return {
    id: text(raw.id),
    user_id: text(raw.user_id),
    ...base,
    guide: cleanGuide(raw.guide),
    mood: typeof raw.mood === "string" ? raw.mood : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    evening_done: raw.evening_done === true,
    ...("snacks" in raw ? { snacks: cleanDaySnacks(raw.snacks) } : {}),
    ...("exercise" in raw ? { exercise: cleanDayExercise(raw.exercise) } : {}),
    ...("adjustment" in raw ? { adjustment: cleanDayAdjustment(raw.adjustment) } : {}),
  };
}

/** Las filas que se pueden leer; la que no trae ni fecha se salta. */
export const toDailyLogs = (rows: readonly unknown[] | null | undefined): DailyLog[] =>
  (rows ?? []).map(toDailyLog).filter((l): l is DailyLog => !!l);

/** Un mensaje del chat. Un `role` que no sea de la persona ni del coach no se pinta. */
export function toChatMessage(raw: unknown): ChatMessage | null {
  if (!isBag(raw) || (raw.role !== "user" && raw.role !== "assistant")) return null;
  return {
    id: text(raw.id),
    log_date: text(raw.log_date),
    role: raw.role,
    content: text(raw.content),
    created_at: text(raw.created_at),
  };
}
