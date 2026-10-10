import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { DailyLog } from "@/lib/daily";
import { cleanDayAdjustment, dayBalance } from "@/lib/day-balance";
import { scheduleDaySettle, useDaySettle } from "@/lib/day-settle";
import { cleanDayExercise } from "@/lib/exercise";
import { removeExercise as removeExerciseFn } from "@/lib/exercise.functions";
import type { MealChange } from "@/lib/plan-shared";
import { cleanDaySnacks } from "@/lib/snacks";
import { removeSnack as removeSnackFn } from "@/lib/snacks.functions";

/**
 * Picoteo, deporte y balance del día: lo apuntado, quitarlo y lo que el día ha
 * movido en los próximos. `log` puede ser el registro de hoy o, sin plan, la
 * fila que picoteo y deporte crean al guardar. Copia en
 * `mobile/lib/use-day-extras.ts`.
 */
export function useDayExtras(
  today: string,
  habits: DailyLog["habits"],
  log: DailyLog | null | undefined,
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [removingExercise, setRemovingExercise] = useState<string | null>(null);
  const [removingSnack, setRemovingSnack] = useState<string | null>(null);

  // El picoteo del día (`daily_logs.snacks`) suma en la barra de macros: es
  // comida de verdad, aunque no cuente como comida del plan.
  const snacks = cleanDaySnacks(log?.snacks);
  // El deporte del día (`daily_logs.exercise`) no suma a las macros: es un
  // gasto, no algo que se coma.
  const exercise = cleanDayExercise(log?.exercise);

  // Picoteo, deporte y cambios de plato comparten UN solo asentamiento por
  // ráfaga (`day-settle.ts`): el desvío que decide si se recolocan los próximos
  // días es el del día entero, no el de cada origen por su cuenta. Ver
  // `day-balance.ts`.
  const daySettle = useDaySettle(today, () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["plan"] });
  });
  const afterDayChange = () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    scheduleDaySettle(today);
  };

  const removeExerciseCall = useServerFn(removeExerciseFn);
  const removeExercise = async (id: string) => {
    setRemovingExercise(id);
    try {
      await removeExerciseCall({ data: { today: today, id } });
      afterDayChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("hoy.errors.removeExercise"));
    } finally {
      setRemovingExercise(null);
    }
  };

  const removeSnackCall = useServerFn(removeSnackFn);
  const removeSnack = async (id: string) => {
    setRemovingSnack(id);
    try {
      await removeSnackCall({ data: { today: today, id } });
      afterDayChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("hoy.errors.removeSnack"));
    } finally {
      setRemovingSnack(null);
    }
  };

  // El desvío del día, sumando los tres orígenes, y lo que ya ha movido. Es lo
  // que pinta `DayBalanceCard` — el desglose sale de datos que ya estaban, no
  // de estado nuevo (ver `day-balance.ts`).
  const balance = dayBalance(habits, snacks, exercise);
  const adjustmentRecord = cleanDayAdjustment(log?.adjustment);
  const balanceChanges: MealChange[] = adjustmentRecord?.adjustment?.changes ?? [];

  return {
    snacks,
    exercise,
    balance,
    adjustmentRecord,
    balanceChanges,
    daySettle,
    afterDayChange,
    removeExercise,
    removingExercise,
    removeSnack,
    removingSnack,
  };
}

export type DayExtras = ReturnType<typeof useDayExtras>;
