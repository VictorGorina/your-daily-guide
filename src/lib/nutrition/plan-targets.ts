/**
 * Lo que el generador del plan sabe del objetivo de cada comida y cómo se
 * compone una comida (ticket 23 de `precision-nutricional`).
 *
 * Con la ración de AESAN, UN plato no llena una comida: los cuatro platos del
 * golden set suman ≈ 960 kcal para la persona de referencia (2.000). Como la
 * ración de cada componente y el objetivo escalan con la misma persona (ticket
 * 21), la ESTRUCTURA vale para todos: lo que cambia entre una mujer de 1.300 kcal
 * y un hombre de 3.400 es el tamaño de cada componente, no cuántos hay.
 *
 * Las cifras son informativas para el modelo: las cantidades las pone el
 * código. Con `nutrition_numbers = ocultar` se calculan igual (la preferencia no
 * cambia el plan, solo lo que se enseña).
 *
 * Puro.
 */

import type { EnergyTargets } from "./energy";

type MealKey = "desayuno" | "comida" | "cena";
type SlotTarget = { kcal: number; protein_g: number };

const SLOT_NAME: Record<MealKey | "snack", string> = {
  desayuno: "desayuno",
  comida: "comida",
  cena: "cena",
  snack: "merienda",
};

/**
 * Parte de la energía del día que es proteína a partir de la cual desayuno y
 * merienda también tienen que llevarla (el tope de `energyTargets` es 0,30).
 */
export const HIGH_PROTEIN_SHARE = 0.25;

/** Parte de las kcal del objetivo que son proteína (4 kcal/g). */
export const proteinShare = (t: Pick<EnergyTargets, "kcal" | "protein_g">) =>
  t.kcal > 0 ? (t.protein_g * 4) / t.kcal : 0;

/** A partir de aquí una comida pide primer y segundo plato. */
export const TWO_COURSES_KCAL = 800;

const describe = (slot: keyof typeof SLOT_NAME, t: SlotTarget) =>
  `${SLOT_NAME[slot]} ~${Math.round(t.kcal / 10) * 10} kcal y ${t.protein_g} g de proteína`;

/**
 * Las líneas del prompt del plan. `shared` = objetivo medio de las comidas
 * compartidas del hogar (`householdMealTargets`), sin cifras de nadie.
 */
export function planTargetsPrompt(opts: {
  targets: EnergyTargets | null;
  shared?: Partial<Record<MealKey, SlotTarget>>;
}): string {
  const { targets, shared = {} } = opts;
  const lines: string[] = [];

  if (targets) {
    const own = (Object.keys(targets.perSlot) as (keyof typeof SLOT_NAME)[])
      .map((slot) => describe(slot, targets.perSlot[slot]!))
      .join("; ");
    lines.push(
      `OBJETIVO POR COMIDA de esta persona (orientativo: las cantidades las ajusta el sistema, ` +
        `tú compón la comida para que pueda llegar): ${own}.`,
    );
  }
  const sharedKeys = Object.keys(shared) as MealKey[];
  if (sharedKeys.length) {
    lines.push(
      `En las comidas compartidas con su casa, el objetivo medio de los adultos: ${sharedKeys
        .map((k) => describe(k, shared[k]!))
        .join("; ")}.`,
    );
  }

  const big = (["comida", "cena"] as const).some(
    (k) => (shared[k]?.kcal ?? targets?.perSlot[k]?.kcal ?? 0) >= TWO_COURSES_KCAL,
  );
  lines.push(
    "ESTRUCTURA DE CADA COMIDA, como se come en España. Comida y cena: plato principal · " +
      "acompañamiento (pan, guarnición o ensalada) · postre (fruta o lácteo)" +
      (big
        ? "; como esta persona necesita bastante energía, primer plato · segundo plato · postre"
        : "") +
      ". Desayuno y merienda: 2 o 3 componentes (lácteo · cereal o pan · fruta, o equivalentes). " +
      'Escribe cada comida en UNA línea con los componentes separados por " · ", por ejemplo ' +
      '"Lentejas estofadas con verduras · pan integral · naranja". Cada componente es concreto.',
  );

  if (targets) {
    const goal = targets.basis.goal;
    if (goal === "perder") {
      lines.push(
        "Como quiere perder peso: platos de volumen (verdura + proteína magra) y cenas más " +
          "ligeras, dentro de su parte del día.",
      );
    } else if (goal === "ganar") {
      lines.push(
        "Como quiere ganar peso: meriendas contundentes y cereal o legumbre en la comida y en la cena.",
      );
    }
    if (targets.protein_g / Math.max(1, targets.basis.refWeightKg) >= 1.6) {
      lines.push(
        "Necesita bastante proteína: una fuente de proteína clara en la comida y en la cena.",
      );
    }
    // Con la proteína en un cuarto de la energía o más (perder peso con pocas
    // kcal), comida y cena solas no llegan: el desayuno y la merienda también
    // la llevan (ticket 10: una merienda de zanahorias dejaba el día en 73 %).
    if (proteinShare(targets) >= HIGH_PROTEIN_SHARE) {
      lines.push(
        "Su proteína es alta para sus calorías: el desayuno y la merienda también llevan una " +
          "fuente de proteína (yogur griego o skyr, queso fresco, huevo, pavo, hummus o un " +
          "puñado de frutos secos con lácteo), nunca solo fruta o verdura.",
      );
    }
  }
  return lines.join(" ");
}

/** Para recolocar platos (`reflowMeals`): que los nuevos mantengan la estructura. */
export const PLAN_STRUCTURE_REMINDER =
  "Mantén la estructura de cada comida al cambiarla (plato principal · acompañamiento · postre, " +
  'separados por " · ").';
