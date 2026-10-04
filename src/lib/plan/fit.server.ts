import type { ProfilePart } from "@/integrations/supabase/db-client";
import { coachSystemPrompt, PLAN_MODEL } from "@/lib/ai-provider.server";
import type { Deadline } from "@/lib/deadline";
import type { Misfit, WeeklyIdea } from "@/lib/nutrition/plan-fit";
import type { RotationMisfit } from "@/lib/nutrition/plan-fit.server";
import { PLAN_STRUCTURE_REMINDER } from "@/lib/nutrition/plan-targets";
import {
  cleanReflowChanges,
  ingredientNames,
  type MonthlyPlan,
  type PlanChange,
  type ShoppingList,
} from "@/lib/plan-shared";
import { askForJson } from "./ai.server";

/**
 * La petición de cambios de la ronda de `planFit` (ticket 10): cada plato que no
 * encaja, con el objetivo de su comida y el motivo en cifras. Misma forma de
 * respuesta que `reflowMeals` (`{"cambios": [...]}` + `cleanReflowChanges`), y
 * solo con los ingredientes de la compra: la lista no cambia al recolocar.
 */
export function askPlanFit(opts: {
  key: string;
  userId: string;
  profile: ProfilePart | null;
  homeText: string;
  shopping: ShoppingList;
  pantry: string[];
  deadline?: Deadline;
}) {
  return async (
    misfits: Misfit[],
    rotations: RotationMisfit[],
  ): Promise<{ changes: PlanChange[]; ideas: WeeklyIdea[] }> => {
    const { cleanWeeklyIdeas, misfitReasonText } = await import("@/lib/nutrition/plan-fit");
    const allowedDates = [...new Set(misfits.map((m) => m.date))];
    const allowedIdeas = new Set(rotations.map((r) => `${r.week}|${r.slot}|${r.option}`));
    const goal = (m: Misfit) =>
      `~${Math.round(m.kcalGoal / 10) * 10} kcal y ${m.proteinGoal} g de proteína`;
    const dishes = misfits.map((m) => ({
      fecha: m.date,
      comida: m.slot,
      plato: m.dish,
      objetivo: goal(m),
      motivo: misfitReasonText(m),
    }));
    const weekly = rotations.map((r) => ({
      semana: r.week + 1,
      comida: r.slot === "snack" ? "merienda" : "desayuno",
      opcion: r.option + 1,
      plato: r.misfit.dish,
      objetivo: goal(r.misfit),
      motivo: misfitReasonText(r.misfit),
    }));
    return askForJson(
      {
        key: opts.key,
        userId: opts.userId,
        model: PLAN_MODEL,
        deadline: opts.deadline,
        system: coachSystemPrompt(opts.profile, opts.homeText),
        prompt:
          "El sistema ajusta la cantidad de cada plato al objetivo de su comida, pero solo hasta " +
          "un límite para que siga siendo el mismo plato. Estos platos del plan no llegan a su " +
          "objetivo ni ajustando la cantidad.\n" +
          (dishes.length ? `Platos de comida y cena:\n${JSON.stringify(dishes)}\n` : "") +
          (weekly.length
            ? `Ideas de desayuno y merienda de la semana (cada una se repite varios días):\n${JSON.stringify(weekly)}\n`
            : "") +
          "\nPropón para CADA uno otro que sí pueda llegar: si se queda corto, con más energía " +
          "(legumbre, arroz, pasta, patata o pan, y un postre lácteo o fruta); si se pasa, más " +
          "ligero; si le falta proteína, con una fuente clara (carne, pescado, huevo, legumbre, " +
          "yogur griego o skyr, queso fresco). Un desayuno o una merienda nunca es solo fruta o " +
          `verdura. ${PLAN_STRUCTURE_REMINDER} ` +
          `Usa SOLO estos ingredientes (más sal, aceite, agua y especias): ${ingredientNames(opts.shopping)}` +
          (opts.pantry.length ? `, ${opts.pantry.join(", ")}` : "") +
          ". No repitas el mismo plato en días seguidos. Platos concretos y realistas.\n" +
          'Devuelve solo JSON válido: {"cambios": [{"fecha": "AAAA-MM-DD", "comida": string, "cena": string}], ' +
          '"ideas": [{"semana": número, "comida": "desayuno"|"merienda", "opcion": número, "plato": string}]}, ' +
          'con "comida" o "cena" solo en la que se pide cambiar y la misma "semana" y "opcion" de cada idea. ' +
          "Listas vacías si no hay nada que cambiar. Sin markdown.",
      },
      (parsed) => {
        const o = (parsed ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.cambios) && !Array.isArray(o.ideas)) return null;
        const changes =
          cleanReflowChanges({ cambios: Array.isArray(o.cambios) ? o.cambios : [] }, allowedDates)
            ?.changes ?? [];
        return { changes, ideas: cleanWeeklyIdeas(o, allowedIdeas) };
      },
    );
  };
}

/** Solo para `bun run eval:plan-lite`: la misma ronda que producción, sin base de datos. */
export async function _fitPlanForEval(opts: {
  key: string;
  plan: MonthlyPlan;
  shopping: ShoppingList;
  month: string;
  profile: ProfilePart | null;
}) {
  const { fitPlanMeals } = await import("@/lib/nutrition/plan-fit.server");
  return fitPlanMeals({
    plan: opts.plan,
    month: opts.month,
    after: `${opts.month}-00`,
    profile: opts.profile,
    shared: () => ({}),
    canTouchShared: true,
    apiKey: opts.key,
    userId: null,
    ask: askPlanFit({
      key: opts.key,
      userId: "",
      profile: opts.profile,
      homeText: "",
      shopping: opts.shopping,
      pantry: [],
    }),
  });
}
