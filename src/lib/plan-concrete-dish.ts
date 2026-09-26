/**
 * Un plato del plan dice QUÉ se come, nunca DÓNDE: "Comida fuera de casa:
 * Paella o similar" o "Menú del día" no son un plato (no se pueden calcular ni
 * comprar, y no ayudan a nadie a decidir). La única excepción es un cheat day
 * puntual, cuya forma aceptada es `CHEAT_DAY_DISH`.
 *
 * El prompt ya lo pide, pero el modelo barato se lo salta a veces (eval
 * `plan-lite`, 2026-09-26: un domingo de alguien muy activo salió "Comida fuera
 * de casa: Paella o similar"). Esta es la red determinista, solo sobre la
 * salida del modelo — nunca sobre lo que la persona escribe a mano
 * (`setPlanMeal` guarda lo pedido tal cual) ni al leer un plan guardado.
 *
 * Puro y testeado (`plan-concrete-dish.test.ts`).
 */

// Solo tipos: `plan-shared` importa este módulo (`cleanReflowChanges`).
import type { MonthlyPlan } from "@/lib/plan-shared";

/** La forma aceptada de un cheat day: abierta a propósito, y como mucho una por semana. */
export const CHEAT_DAY_DISH = "Plato libre que te apetezca";

export type DishVerdict =
  /** Plato concreto; `dish` ya sin el "fuera de casa" ni el "o similar". */
  | { kind: "ok"; dish: string }
  /** Cheat day: se acepta, pero cuenta para el tope semanal. */
  | { kind: "cheat"; dish: string }
  /** Comer fuera sin nada concreto que comer: no vale como plato. */
  | { kind: "generic" };

// Límites de palabra con letras acentuadas (`\b` de JS solo entiende ASCII).
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";
const MEAL_WORD = "(?:comida|cena|almuerzo|desayuno|merienda|comer|cenar|come)";
const VENUE = "(?:restaurante|bar|cafeter[ií]a|terraza)";
/** Dónde, no qué: "fuera (de casa)", "en un restaurante", "de bar". */
const PLACE = `(?:fuera(?:\\s+de\\s+casa)?|(?:en|de)\\s+(?:un\\s+|una\\s+|el\\s+|la\\s+)?${VENUE}|${VENUE})`;

/** "Comida fuera de casa: …", "Menú del día - …", "Restaurante: …". */
const PREFIX = new RegExp(
  `^\\s*(?:${MEAL_WORD}\\s+)?(?:${PLACE}|men[uú](?:\\s+del\\s+d[ií]a)?)\\s*[:\\-–—,]\\s*`,
  "iu",
);
/** "Paella en un restaurante", "Bocadillo, fuera de casa". */
const SUFFIX = new RegExp(`\\s*,?\\s+(?:${MEAL_WORD}\\s+)?${PLACE}\\s*$`, "iu");
/** "(comes fuera)", "(menú del día)". */
const PAREN = new RegExp(`\\s*\\([^)]*${B}(?:fuera|men[uú]|${VENUE})${E}[^)]*\\)`, "giu");
/** "o similar", "u otro parecido", "o lo que te apetezca". */
const HEDGE = new RegExp(
  `\\s*,?\\s+[ou]\\s+(?:(?:algo|otro|otra)\\s+)?(?:similar|parecid[oa]|equivalente)${E}` +
    `|\\s*,?\\s+o\\s+lo\\s+que\\s+(?:te\\s+)?(?:apetezca|haya|elijas|prefieras|pidas|quieras)${E}`,
  "giu",
);

/** Minúsculas, sin tildes y con espacios normales: solo para comparar. */
const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const CHEAT =
  /(?:^|[^a-z])(?:plato libre|comida libre|cena libre|dia libre|cheat(?: day| meal)?)(?:$|[^a-z])/;
/** Lo que queda de un plato que solo dice dónde o "lo que sea". */
const GENERIC_WHOLE =
  /^(?:comida|cena|almuerzo|desayuno|merienda|comer|cenar|come|desayunar|merendar|menu|fuera|tapas|picoteo)?$/;
const GENERIC_ANY =
  /(?:^|[^a-z])(?:restaurante|menu del dia|fuera de casa|(?:comer|come|comida|cena|cenar) fuera|lo que (?:te )?(?:apetezca|quieras|pidas)|a elegir|libre eleccion)(?:$|[^a-z])/;

const SEP = " · ";

/**
 * ¿Es un plato concreto? Quita el "fuera de casa" y el "o similar" que
 * envuelven a un plato de verdad, y marca como `generic` lo que no deja nada
 * que comer. No inventa platos: eso lo decide quien llama.
 */
export function concreteDish(text: string): DishVerdict {
  const raw = String(text ?? "").trim();
  const n = norm(raw);
  if (CHEAT.test(n)) {
    // Un cheat day es abierto por definición, pero "comida libre fuera de
    // casa" sigue diciendo dónde: se deja en su forma aceptada.
    return { kind: "cheat", dish: GENERIC_ANY.test(n) ? CHEAT_DAY_DISH : raw };
  }
  const parts = raw
    .replace(PAREN, "")
    .replace(HEDGE, "")
    .split(SEP)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length) {
    parts[0] = parts[0].replace(PREFIX, "").replace(SUFFIX, "").trim();
    // La primera letra, en mayúscula como la escribió el modelo al principio.
    parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  }
  const main = norm(parts[0] ?? "")
    .replace(/[.,;:\-–—]+$/, "")
    .trim();
  if (GENERIC_WHOLE.test(main) || GENERIC_ANY.test(main)) return { kind: "generic" };
  return { kind: "ok", dish: parts.filter(Boolean).join(SEP) };
}

export type ConcretePlanReport = {
  /** Platos a los que se les quitó el "fuera de casa" / "o similar". */
  rewritten: number;
  /**
   * Comidas genéricas (o cheat days de más) cambiadas por otro plato de la
   * semana, más desayunos/meriendas genéricos quitados.
   */
  replaced: number;
  /** Genéricas sin ningún plato concreto con el que cambiarlas. */
  unresolved: number;
};

type MainSlot = "lunch" | "dinner";
const MAIN_SLOTS: readonly MainSlot[] = ["lunch", "dinner"];
const PIN_SLOT = { lunch: "comida", dinner: "cena" } as const;

/**
 * Aplica `concreteDish` a un plan recién generado. Una comida o cena genérica
 * se cambia por un plato concreto de la MISMA semana (sus ingredientes ya van
 * en la compra de esa semana), mejor uno que no esté en el día de al lado; si
 * la semana no tiene ninguno, el del mismo día de otra semana. Un cheat day
 * vale una vez por semana; los demás cuentan como genéricos. Un desayuno o
 * merienda genérico se quita (manda la rotación semanal) y una idea semanal
 * genérica sale de la lista si queda otra. Nunca toca una comida fijada a mano.
 */
export function concretizePlan(plan: MonthlyPlan): {
  plan: MonthlyPlan;
  report: ConcretePlanReport;
} {
  const report: ConcretePlanReport = { rewritten: 0, replaced: 0, unresolved: 0 };
  const weeks = plan.weeks.map((w) => ({ ...w, days: w.days.map((d) => ({ ...d })) }));
  /** Celdas a sustituir: `semana:día:slot`. */
  const pending: { wi: number; di: number; slot: MainSlot }[] = [];

  weeks.forEach((week, wi) => {
    let cheats = 0;
    week.days.forEach((day, di) => {
      for (const slot of MAIN_SLOTS) {
        const text = day[slot];
        if (!text || day.pinned?.includes(PIN_SLOT[slot])) continue;
        const v = concreteDish(text);
        if (v.kind === "cheat" && cheats === 0) {
          cheats++;
          if (v.dish !== text) report.rewritten++;
          day[slot] = v.dish;
        } else if (v.kind === "ok") {
          if (v.dish !== text) report.rewritten++;
          day[slot] = v.dish;
        } else {
          pending.push({ wi, di, slot });
        }
      }
      for (const slot of ["breakfast", "snack"] as const) {
        const text = day[slot];
        if (!text) continue;
        const v = concreteDish(text);
        if (v.kind === "ok") {
          if (v.dish !== text) report.rewritten++;
          day[slot] = v.dish;
        } else {
          delete day[slot];
          report.replaced++;
        }
      }
    });
    for (const list of ["breakfasts", "snacks"] as const) {
      const kept = week[list].flatMap((from) => {
        const v = concreteDish(from);
        return v.kind === "ok" ? [{ from, dish: v.dish }] : [];
      });
      if (!kept.length) continue;
      report.rewritten += kept.filter((k) => k.dish !== k.from).length;
      report.replaced += week[list].length - kept.length;
      week[list] = kept.map((k) => k.dish);
    }
  });

  const isPending = (wi: number, di: number, slot: MainSlot) =>
    pending.some((p) => p.wi === wi && p.di === di && p.slot === slot);
  const usable = (wi: number, di: number, slot: MainSlot) => {
    const d = weeks[wi]?.days[di];
    return d && d[slot] && !isPending(wi, di, slot) ? d[slot] : null;
  };

  for (const { wi, di, slot } of pending) {
    const sameWeek = weeks[wi]!.days.map((_, dj) => dj)
      .filter((dj) => dj !== di && usable(wi, dj, slot))
      // Lejos del día primero (no repetir en días seguidos), luego el más cercano.
      .sort((a, b) => {
        const da = Math.abs(a - di);
        const db = Math.abs(b - di);
        return Number(da < 2) - Number(db < 2) || da - db;
      });
    const otherWeeks = weeks.map((_, wj) => wj).filter((wj) => wj !== wi && usable(wj, di, slot));
    const dish =
      sameWeek.length > 0
        ? usable(wi, sameWeek[0]!, slot)
        : otherWeeks.length > 0
          ? usable(otherWeeks[0]!, di, slot)
          : null;
    if (dish) {
      weeks[wi]!.days[di]![slot] = dish;
      report.replaced++;
    } else {
      report.unresolved++;
    }
  }

  return { plan: { ...plan, weeks }, report };
}
