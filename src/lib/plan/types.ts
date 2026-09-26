import { isSharedSlot, type SharedSlots } from "@/lib/household-shared";
import type { PlanFitMark } from "./fit-mark";
import type { ShoppingCadence } from "../shopping/model";
import type { MealSlot } from "./slots";

/**
 * Plato aparte de un niño para un día concreto, cuando el plato compartido del
 * hogar no le sirve (su alérgeno, su edad, o no lo come). Lo emite la IA al
 * generar el plan o lo pone el planificador a mano (`setChildMeal`). Vive en la
 * fila del planificador y se espeja a los demás miembros como el resto de
 * comidas compartidas. `off` = ingredientes que pide y no están en la compra.
 */
export type ChildMeal = { childId: string; slot: MealSlot; dish: string; off?: string[] };

/**
 * Un día del plan. `lunch`/`dinner` vienen siempre del plan generado; el plan
 * base deja el desayuno y el snack a nivel de semana (una lista que rota por
 * día), así que `breakfast`/`snack` sólo aparecen cuando se ha pedido un plato
 * concreto para ESE día — un cambio a mano manda sobre la rotación semanal.
 * `extras` guarda, por comida, los ingredientes de ese plato que no salen de la
 * lista de la compra, para poder avisar en pantalla. `kids` guarda los platos
 * aparte de un niño para ESE día (issue 07); el resto de comidas el niño come
 * el plato compartido.
 *
 * `pinned` son las comidas de ese día que la persona eligió a mano
 * (`setPlanMeal`). Ninguna recolocación automática las pisa (`applyPlanChanges`,
 * `mergeFuturePlan`): sin esta marca, una comida o cena cambiada a mano se
 * perdía en el siguiente reajuste, porque se guarda en el mismo campo que
 * escribe la IA. Los días 29-31 comparten celda con los de la semana 3 (el plan
 * tiene 4 filas), así que la marca vale para las dos fechas de esa celda.
 */
export type PlanDay = {
  day: string;
  lunch: string;
  dinner: string;
  breakfast?: string;
  snack?: string;
  extras?: Partial<Record<MealSlot, string[]>>;
  kids?: ChildMeal[];
  pinned?: MealSlot[];
  /**
   * kcal que la compensación de un día anterior (`settleDay`) movió a esta
   * comida: negativo = más ligera. Los platos del plan se escalan al objetivo
   * de su comida (`plannedMacros`), así que cambiar un plato por otro más ligero
   * ya no mueve kcal por sí solo; lo que mueve es este ajuste del objetivo. Solo
   * en comidas propias (se compensa con `soloOnly`); en una compartida se ignora.
   */
  kcalAdjust?: Partial<Record<MealSlot, number>>;
};

/** ¿Esta comida del día la eligió la persona a mano? */
export const isPinned = (day: PlanDay | null | undefined, slot: MealSlot): boolean =>
  !!day?.pinned?.includes(slot);

/**
 * Lo que hace falta saber del hogar para distinguir "lo cambié yo" de "lo
 * cambió el hogar" en un slot concreto — ver `dishChangeIsMine`.
 */
export type HouseholdPinContext = {
  isPlanner: boolean;
  sharedSlots: SharedSlots;
  weekday: number;
};

/**
 * ¿Un cambio de plato en este slot, si lo hay, lo hizo la propia persona que
 * está mirando la pantalla? En un slot compartido de un hogar solo quien
 * planifica puede cambiarlo (`guardSharedSlotWrite` bloquea al resto), así
 * que para cualquier otro miembro un plato distinto al esperado siempre vino
 * de fuera. Sin hogar (`home` null), o en un slot en solitario (merienda, o
 * una comida ese día no compartida), el cambio es siempre propio.
 */
export function dishChangeIsMine(slot: MealSlot, home: HouseholdPinContext | null): boolean {
  if (!home || home.isPlanner || slot === "snack") return true;
  return !isSharedSlot(home.sharedSlots, slot, home.weekday);
}

/**
 * ¿La eligió a mano la propia persona que está mirando la pantalla, y no
 * otra? En un slot compartido del hogar, `pinned` viaja siempre desde la fila
 * del planificador (`mirrorPinned`), así que un no planificador puede verlo
 * fijado sin haber tocado nada él mismo.
 */
export function isPinnedByViewer(
  day: PlanDay | null | undefined,
  slot: MealSlot,
  home: HouseholdPinContext | null,
): boolean {
  return isPinned(day, slot) && dishChangeIsMine(slot, home);
}

/**
 * Días del mes que cubre el plan. Un plan creado a media de mes solo cubre de
 * hoy a fin de mes (ver `monthCoverage`), y de ahí salen tanto la prorrata del
 * presupuesto como los rangos de días de cada compra.
 */
export type PlanCoverage = { fromDay: number; toDay: number };

export type MonthlyPlan = {
  intro: string;
  focus: string[];
  weeks: {
    label: string;
    focus: string;
    breakfasts: string[];
    snacks: string[];
    days: PlanDay[];
  }[];
  /** Rango de días del mes que cubre este plan (ausente en planes antiguos = mes completo). */
  coverage?: PlanCoverage;
  /** Cada cuánto se compra. Fuente de verdad de la cadencia; el reparto de `trip` la refleja. */
  cadence?: ShoppingCadence;
  /**
   * El plan se generó conociendo el objetivo por comida y con estructura de
   * comida (ticket 23 de `precision-nutricional`). Sin él, Hoy explica que el
   * plan del mes es anterior y que el que viene cuadrará.
   */
  targetsVersion?: number;
  /**
   * La comprobación del plan contra el objetivo ya pasó (ticket 10 de
   * `precision-nutricional`, `fitMonthlyPlan`): como mucho UNA ronda por plan
   * generado. Un plan nuevo nace sin ella.
   */
  fit?: PlanFitMark;
};
