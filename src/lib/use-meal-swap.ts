import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { monthISO, todayISO, updateTodayLog, type DailyGuide, type DailyLog } from "@/lib/daily";
import { generateDailyGuide } from "@/lib/guide.functions";
import { adjustMonthlyPlan, setPlanMeal } from "@/lib/plan.functions";
import {
  diffFutureMeals,
  mealsForDate,
  type MealChange,
  type MealSlot,
  type MonthlyPlan,
} from "@/lib/plan-shared";

export type { MealChange };

/**
 * Info del ajuste que hizo `adjustMonthlyPlan` tras un cambio de plato. Se
 * guarda en el habit del daily log para que persista entre recargas y el badge
 * "i" siga disponible al volver a Hoy.
 */
export type SwapAdjustment = {
  changes: MealChange[];
  summary: string;
};

/**
 * Hook que orquesta el cambio de plato directo desde Hoy, sin pasar por el
 * chat del coach:
 *
 * 1. `setPlanMeal` → cambia el plato al instante (sin IA)
 * 2. Regenera la guía del día para actualizar macros
 * 3. `adjustMonthlyPlan` → recoloca días futuros para compensar (IA, en segundo plano)
 * 4. Diffa el plan antes/después y guarda el resultado en el habit
 *
 * El componente de Hoy usa `adjustingIndex` para saber qué comida está en
 * proceso de ajuste (spinner → badge "i" al terminar).
 */
export function useMealSwap(
  getLog: () => DailyLog | undefined,
  getPlan: () => MonthlyPlan | null | undefined,
) {
  const qc = useQueryClient();
  const changeMeal = useServerFn(setPlanMeal);
  const adjustPlan = useServerFn(adjustMonthlyPlan);
  const makeGuide = useServerFn(generateDailyGuide);
  const [adjustingIndex, setAdjustingIndex] = useState<number | null>(null);

  const today = todayISO();
  const month = monthISO();

  const swapMutation = useMutation({
    mutationFn: async ({
      habitIndex,
      slot,
      dish,
      slotLabel,
    }: {
      habitIndex: number;
      slot: MealSlot;
      dish: string;
      slotLabel: string;
    }) => {
      // --- Paso 1: snapshot del plan actual (para diff) ---
      const planBefore = getPlan() ?? null;

      // --- Paso 2: cambiar el plato al instante ---
      const { plan: planAfterMeal, previousIdea } = await changeMeal({
        data: { date: today, slot, dish, today },
      });

      // --- Paso 3: actualizar habits (wasIdea + status) ---
      const habits = getLog()?.habits ?? [];
      const nextHabits =
        previousIdea && previousIdea !== dish
          ? habits.map((h, i) =>
              i === habitIndex
                ? {
                    ...h,
                    status: "distinto" as const,
                    done: true,
                    wasIdea: h.wasIdea ?? previousIdea,
                  }
                : h,
            )
          : habits.map((h, i) =>
              i === habitIndex ? { ...h, status: "distinto" as const, done: true } : h,
            );

      // --- Paso 4: regenerar guía del día para macros ---
      const composedPlan = planAfterMeal;
      const meals = mealsForDate(composedPlan, today)
        .map((m) =>
          m.slot === slot ? { moment: m.moment, idea: dish } : { moment: m.moment, idea: m.idea },
        )
        .filter((m) => m.idea);
      const freshGuide = await makeGuide({ data: { meals } });
      const currentGuide = getLog()?.guide ?? null;
      const guide: DailyGuide = {
        ...freshGuide,
        macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate,
      };
      await updateTodayLog({ guide, habits: nextHabits });

      // Invalidar queries para refrescar Hoy y el calendario
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
      qc.invalidateQueries({ queryKey: ["plan"] });

      // --- Paso 5: ajustar plan futuro en segundo plano ---
      setAdjustingIndex(habitIndex);
      try {
        const planned = previousIdea || "(plato del plan)";
        const { plan: planAfterAdjust, summary } = await adjustPlan({
          data: {
            month,
            note:
              `${slotLabel} de hoy: el usuario ha comido "${dish}" en vez de "${planned}". ` +
              "Ajusta los días futuros para compensar de forma suave.",
            today,
          },
        });

        // --- Paso 6: diff y guardar en habit ---
        const changes = diffFutureMeals(planBefore, planAfterAdjust, today);
        const updatedHabits = (getLog()?.habits ?? nextHabits).map((h, i) =>
          i === habitIndex ? { ...h, adjustmentChanges: changes, adjustmentSummary: summary } : h,
        );
        await updateTodayLog({ habits: updatedHabits });
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["plan"] });

        return { changes, summary };
      } catch (err) {
        console.error("adjustMonthlyPlan failed after meal swap", err);
        toast.error("El plato se ha cambiado, pero no se han podido ajustar los días futuros.");
        return { changes: [] as MealChange[], summary: "" };
      } finally {
        setAdjustingIndex(null);
      }
    },
  });

  const swap = useCallback(
    (habitIndex: number, slot: MealSlot, dish: string, slotLabel: string) => {
      swapMutation.mutate({ habitIndex, slot, dish, slotLabel });
    },
    [swapMutation],
  );

  return {
    swap,
    isSwapping: swapMutation.isPending,
    adjustingIndex,
  };
}
