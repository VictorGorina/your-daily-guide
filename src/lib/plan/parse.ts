import { MEAL_KEYS, type MealKey } from "@/lib/household-shared";
import type { PlanFitChange, PlanFitMark } from "../plan-shared";
import type { ShoppingCadence } from "../shopping/model";
import { DAY_NAMES } from "./grid";
import { MEAL_SLOTS, type MealSlot } from "./slots";
import type { ChildMeal, MonthlyPlan, PlanCoverage, PlanDay } from "./types";

const cleanExtras = (raw: unknown): PlanDay["extras"] => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const entries = MEAL_SLOTS.map(
    (slot) =>
      [
        slot,
        (Array.isArray(o[slot]) ? (o[slot] as unknown[]) : [])
          .map((n) => String(n).trim())
          .filter(Boolean)
          .slice(0, 6),
      ] as const,
  ).filter(([, list]) => list.length);
  return entries.length ? Object.fromEntries(entries) : undefined;
};

/**
 * Valida la lista de platos de niño de un día: descarta entradas sin `childId`,
 * sin plato o con un `slot` que no sea una de las 3 comidas principales (el
 * snack nunca se comparte ni lleva plato aparte, D5), deduplica por niño+comida
 * (una sola alternativa por niño y momento) y recorta `off` como `extras`.
 */
const cleanKids = (raw: unknown): ChildMeal[] | undefined => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: ChildMeal[] = [];
  for (const entry of list.slice(0, 12)) {
    const o = (entry ?? {}) as Record<string, unknown>;
    const childId = String(o.childId ?? "").trim();
    const slot = MEAL_KEYS.includes(o.slot as MealKey) ? (o.slot as MealSlot) : null;
    const dish = String(o.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!childId || !slot || !dish) continue;
    const key = `${childId}|${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const off = (Array.isArray(o.off) ? o.off : [])
      .map((n) => String(n).trim())
      .filter(Boolean)
      .slice(0, 6);
    out.push({ childId, slot, dish, ...(off.length ? { off } : {}) });
  }
  return out.length ? out.slice(0, 6) : undefined;
};

const cleanDay = (raw: unknown): PlanDay => {
  const d = (raw ?? {}) as Record<string, unknown>;
  const day: PlanDay = {
    day: String(d.day ?? ""),
    lunch: String(d.lunch ?? ""),
    dinner: String(d.dinner ?? ""),
  };
  const breakfast = String(d.breakfast ?? "").trim();
  const snack = String(d.snack ?? "").trim();
  const extras = cleanExtras(d.extras);
  const kids = cleanKids(d.kids);
  const rawPinned: unknown[] = Array.isArray(d.pinned) ? d.pinned : [];
  const pinned = MEAL_SLOTS.filter((s) => rawPinned.includes(s));
  const kcalAdjust = cleanKcalAdjust(d.kcalAdjust);
  if (breakfast) day.breakfast = breakfast;
  if (snack) day.snack = snack;
  if (extras) day.extras = extras;
  if (kids) day.kids = kids;
  if (pinned.length) day.pinned = pinned;
  if (kcalAdjust) day.kcalAdjust = kcalAdjust;
  return day;
};

/** Tope de `kcalAdjust` por comida: por encima es un dato roto, no una compensación. */
const KCAL_ADJUST_MAX = 1500;

export function cleanKcalAdjust(raw: unknown): PlanDay["kcalAdjust"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<MealSlot, number>> = {};
  for (const slot of MEAL_SLOTS) {
    const n = Math.round(Number((raw as Record<string, unknown>)[slot]));
    if (Number.isFinite(n) && n !== 0 && Math.abs(n) <= KCAL_ADJUST_MAX) out[slot] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

const cleanCoverage = (raw: unknown): PlanCoverage | undefined => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const fromDay = Number(o.fromDay);
  const toDay = Number(o.toDay);
  if (!Number.isFinite(fromDay) || !Number.isFinite(toDay)) return undefined;
  const from = Math.min(Math.max(Math.round(fromDay), 1), 31);
  const to = Math.min(Math.max(Math.round(toDay), from), 31);
  return { fromDay: from, toDay: to };
};

const FIT_SLOTS: readonly PlanFitChange["slot"][] = ["comida", "cena", "desayuno", "merienda"];

const cleanFitMark = (raw: unknown): PlanFitMark | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const at = String(o.at ?? "");
  if (!at) return undefined;
  const share = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
  const changed = (Array.isArray(o.changed) ? o.changed : [])
    .map((c) => (c ?? {}) as Record<string, unknown>)
    .filter((c) => FIT_SLOTS.includes(c.slot as PlanFitChange["slot"]))
    .map((c) => {
      const int = (n: unknown) =>
        Number.isInteger(Number(n)) && Number(n) >= 0 ? Number(n) : null;
      const week = int(c.week);
      const option = int(c.option);
      const days = int(c.days);
      return {
        date: String(c.date ?? ""),
        slot: c.slot as PlanFitChange["slot"],
        from: String(c.from ?? "").slice(0, 200),
        to: String(c.to ?? "").slice(0, 200),
        ...(week != null ? { week } : {}),
        ...(option != null ? { option } : {}),
        ...(days ? { days } : {}),
      };
    })
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.to)
    .slice(0, 62);
  return { at, before: share(o.before), after: share(o.after), changed };
};

const cleanCadence = (raw: unknown): ShoppingCadence | undefined =>
  raw === "semanal" || raw === "bisemanal" || raw === "mensual" ? raw : undefined;

export const cleanPlan = (raw: unknown): MonthlyPlan | null => {
  const plan = (raw ?? {}) as Partial<MonthlyPlan>;
  if (!plan.weeks?.length) return null;
  const coverage = cleanCoverage(plan.coverage);
  const cadence = cleanCadence(plan.cadence);
  const fit = cleanFitMark(plan.fit);
  return {
    intro: String(plan.intro ?? ""),
    focus: (plan.focus ?? []).slice(0, 4).map(String),
    weeks: plan.weeks.slice(0, 5).map((w) => ({
      label: String(w?.label ?? ""),
      focus: String(w?.focus ?? ""),
      breakfasts: (w?.breakfasts ?? []).slice(0, 3).map(String),
      snacks: (w?.snacks ?? []).slice(0, 3).map(String),
      days: (w?.days ?? []).slice(0, 7).map(cleanDay),
    })),
    ...(coverage ? { coverage } : {}),
    ...(cadence ? { cadence } : {}),
    ...(Number(plan.targetsVersion) > 0 ? { targetsVersion: Number(plan.targetsVersion) } : {}),
    ...(fit ? { fit } : {}),
  };
};

/** Extrae el primer objeto JSON de una respuesta, tolerando ```json, texto alrededor y cortes. */
export const parseJsonLoose = (raw: string): unknown => {
  const text = String(raw ?? "")
    .replace(/```json/gi, "")
    .replace(/```/g, "");
  const start = text.indexOf("{");
  if (start < 0) return null;

  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(text.slice(start, text.lastIndexOf("}") + 1));
  if (direct !== undefined) return direct;

  // Recorre equilibrando llaves/corchetes; si la respuesta quedó cortada, la cierra.
  let depth = 0;
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
      depth++;
    } else if (c === "}" || c === "]") {
      stack.pop();
      depth--;
      if (depth === 0) {
        const done = tryParse(text.slice(start, i + 1));
        if (done !== undefined) return done;
      }
    }
  }

  // Cierre de emergencia de un JSON truncado.
  let candidate = text.slice(start).replace(/,\s*$/, "");
  if (inString) candidate += '"';
  for (let i = stack.length - 1; i >= 0; i--) candidate += stack[i];
  const repaired = tryParse(candidate);
  return repaired === undefined ? null : repaired;
};

/** Rellena huecos del plan (semanas y días que falten) reutilizando lo que sí generó la IA. */
export const completePlan = (plan: MonthlyPlan | null): MonthlyPlan | null => {
  if (!plan) return null;
  const sourceDays = plan.weeks.flatMap((w) => w.days).filter((d) => d.lunch || d.dinner);
  if (!sourceDays.length) return null;

  const pick = (i: number) => sourceDays[i % sourceDays.length]!;
  let cursor = 0;

  const weeks = Array.from({ length: 4 }, (_, wi) => {
    const base = plan.weeks[wi] ?? plan.weeks[plan.weeks.length - 1]!;
    const days = DAY_NAMES.map((name, di) => {
      const existing = base.days[di];
      if (existing && existing.lunch && existing.dinner) {
        return { ...existing, day: existing.day || name };
      }
      const fill = pick(cursor++);
      return {
        ...(existing ?? {}),
        day: existing?.day || name,
        lunch: existing?.lunch || fill.lunch || fill.dinner,
        dinner: existing?.dinner || fill.dinner || fill.lunch,
      };
    });
    const fallbackBreakfasts = plan.weeks.flatMap((w) => w.breakfasts).filter(Boolean);
    const fallbackSnacks = plan.weeks.flatMap((w) => w.snacks).filter(Boolean);
    return {
      label: base.label || `Semana ${wi + 1}`,
      focus: base.focus || plan.focus[0] || "",
      breakfasts: base.breakfasts.length ? base.breakfasts : fallbackBreakfasts.slice(0, 2),
      snacks: base.snacks.length ? base.snacks : fallbackSnacks.slice(0, 2),
      days,
    };
  });

  return {
    intro: plan.intro || "Este mes vamos paso a paso, con comidas sencillas y sin presiones.",
    focus: plan.focus.length
      ? plan.focus
      : ["Comidas sencillas", "Verdura a diario", "Moverte cada día"],
    weeks,
    ...(plan.coverage ? { coverage: plan.coverage } : {}),
    ...(plan.cadence ? { cadence: plan.cadence } : {}),
  };
};
