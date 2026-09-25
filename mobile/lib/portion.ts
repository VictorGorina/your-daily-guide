/**
 * Ración personal (tickets 21 y 17 de `precision-nutricional`, D10).
 *
 * La receta canónica es UNA ración de AESAN, pensada para un adulto de
 * referencia de 2.000 kcal (Reglamento UE 1169/2011, anexo XIII). Una mujer de
 * 1.300 kcal y un hombre de 3.400 no se sirven lo mismo, así que cada persona
 * tiene dos factores:
 *
 * - `plan` = su objetivo ÷ 2.000: el tamaño de los platos DEL PLAN.
 * - `habitual` = su gasto de mantenimiento ÷ 2.000: lo que se sirve fuera del
 *   plan ("comí distinto"). Fuera del plan, lo normal es servirse el plato de
 *   siempre, no el de la dieta.
 *
 * Los dos entre 0,6 y 1,7. Sin datos para el objetivo (falta altura, peso o
 * edad), por sexo: hombre 1,25 · mujer 1,0 · otro 1,12 (2.500, 2.000 y 2.250).
 *
 * Escalado lineal de todos los ingredientes, aceite incluido: es "tu plato",
 * una aproximación. El escalado fino por grupos (ticket 08) partirá de aquí.
 *
 * Puro. Copia de `src/lib/nutrition/portion.ts` de la web (no hay código compartido).
 */

import type { EnergyTargets } from "./energy";

export const REFERENCE_KCAL = 2000;
export const PORTION_MIN = 0.6;
export const PORTION_MAX = 1.7;

export type PortionFactors = {
  /** Platos del plan: objetivo ÷ 2.000. */
  plan: number;
  /** Fuera del plan ("comí distinto"): mantenimiento ÷ 2.000. */
  habitual: number;
  /** De dónde sale: el objetivo calculado, o el sexo si faltan datos. */
  basis: "objetivo" | "sexo";
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => round2(Math.min(PORTION_MAX, Math.max(PORTION_MIN, n)));

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/** Factor por sexo cuando no hay objetivo: la ingesta de referencia de cada uno ÷ 2.000. */
export function sexPortion(sex: string | null | undefined): number {
  const s = plain(String(sex ?? ""));
  if (/^(hombre|varon|masculin)/.test(s)) return 1.25;
  if (/^(mujer|femenin)/.test(s)) return 1;
  return 1.12;
}

export function portionFactors(
  targets: Pick<EnergyTargets, "kcal" | "basis"> | null | undefined,
  profile: { sex?: string | null } | null | undefined,
): PortionFactors {
  if (!targets) {
    const f = sexPortion(profile?.sex);
    return { plan: f, habitual: f, basis: "sexo" };
  }
  return {
    plan: clamp(targets.kcal / REFERENCE_KCAL),
    habitual: clamp(targets.basis.tdee / REFERENCE_KCAL),
    basis: "objetivo",
  };
}

/**
 * La ración de una comida compartida del hogar (D4): la media del factor `plan`
 * de los adultos con cuenta que la comen. El mismo número para todos. `null` si
 * no hay nadie (la comida no es compartida ese día).
 */
export function sharedPortion(planFactors: readonly number[]): number | null {
  const valid = planFactors.filter((f) => Number.isFinite(f) && f > 0);
  if (!valid.length) return null;
  return clamp(valid.reduce((sum, f) => sum + f, 0) / valid.length);
}

/** "×1,2" con coma decimal, para Ajustes. */
export function formatPortion(factor: number): string {
  return `×${factor.toLocaleString("es-ES", { maximumFractionDigits: 2 })}`;
}

/** La línea de Ajustes (ticket 21, transparencia): de dónde sale el tamaño de sus platos. */
export function portionExplanation(f: PortionFactors): string {
  const why = f.basis === "objetivo" ? "según tu objetivo" : "a falta de tu altura, peso o edad";
  return `Tus raciones: ${formatPortion(f.plan)} de la ración de referencia (${why}).`;
}

// ---------------------------------------------------------------------------
// "Comí distinto": cuánto se comió (ticket 17, D10)
// ---------------------------------------------------------------------------

export const PORTION_SIZES = ["pequena", "normal", "grande"] as const;
export type PortionSize = (typeof PORTION_SIZES)[number];

/** Chips de tamaño, para el apetito del momento: sobre la cantidad de 2 o 3. */
export const SIZE_FACTOR: Record<PortionSize, number> = {
  pequena: 0.75,
  normal: 1,
  grande: 1.3,
};

export const PORTION_SIZE_LABEL: Record<PortionSize, string> = {
  pequena: "Pequeño",
  normal: "Normal",
  grande: "Grande",
};

export const parsePortionSize = (raw: unknown): PortionSize | null =>
  (PORTION_SIZES as readonly string[]).includes(String(raw)) ? (raw as PortionSize) : null;

/**
 * Cuántas raciones base (o piezas) se comió alguien fuera del plan, por este
 * orden (D10):
 *
 *  1. Lo que diga el texto ("media pizza" 0,5, "dos platos de lentejas" 2),
 *     aplicado sobre 2 o 3. Sin chips: el texto ya lo dice.
 *  2. Una pieza con tamaño propio (pizza, hamburguesa, bocadillo): 1, sin
 *     escalar por persona. Una pizza pesa lo que pesa.
 *  3. Un plato: la ración base × el factor `habitual` de la persona.
 *
 * Encima, el chip de tamaño (pequeño · normal · grande), salvo con cantidad en
 * el texto.
 */
export function eatenPortion(opts: {
  servingKind: "plato" | "unidad";
  textQuantity: number | null;
  habitual: number;
  size?: PortionSize | null;
}): number {
  const base = opts.servingKind === "unidad" ? 1 : opts.habitual;
  if (opts.textQuantity != null && opts.textQuantity > 0) return round2(base * opts.textQuantity);
  return round2(base * SIZE_FACTOR[opts.size ?? "normal"]);
}

/** ¿Se enseñan los chips? No si el texto ya dice cuánto. */
export const showsSizeChips = (textQuantity: number | null | undefined) =>
  !(textQuantity != null && textQuantity > 0);

/** Veces seguidas con el mismo tamaño para darlo por "el suyo". */
export const LEARNED_SIZE_STREAK = 5;

/**
 * El tamaño que viene preseleccionado: si las últimas 5 veces eligió el mismo y
 * no es "normal", ese ("Sueles servirte más"). `history` va de la más antigua a
 * la más reciente.
 */
export function learnedPortionSize(
  history: readonly (PortionSize | null | undefined)[],
): PortionSize {
  const recent = history.filter((s): s is PortionSize => !!s).slice(-LEARNED_SIZE_STREAK);
  if (recent.length < LEARNED_SIZE_STREAK) return "normal";
  const first = recent[0]!;
  return first !== "normal" && recent.every((s) => s === first) ? first : "normal";
}

/**
 * ¿El texto ya dice cuánto se comió? ("media pizza", "dos platos", "un plato
 * pequeño"). En el cliente, antes de descomponer: si lo dice, no hay chips (la
 * cantidad del texto manda también en el servidor, `eatenPortion`).
 */
export function textMentionsQuantity(text: string): boolean {
  return /\b(medi[oa]s?|mitad|dos|tres|cuatro|doble|triple|\d+([.,]\d+)?|un cuarto|peque(n|ñ)[oa]s?|grandes?|racion(es)? (grande|pequena))\b/i.test(
    text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
}

/**
 * Tamaños elegidos en "comí distinto", de los registros de días (en cualquier
 * orden), de la más antigua a la más reciente: lo que lee `learnedPortionSize`.
 */
export function portionSizeHistory(
  logs: readonly {
    log_date: string;
    habits?: readonly { status?: string; portionSize?: string | null }[] | null;
  }[],
): PortionSize[] {
  return [...logs]
    .sort((a, b) => a.log_date.localeCompare(b.log_date))
    .flatMap((log) =>
      (log.habits ?? [])
        .filter((h) => h.status === "distinto")
        .map((h) => parsePortionSize(h.portionSize))
        .filter((s): s is PortionSize => !!s),
    );
}
