import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { apiPost } from "./api";
import type { DailyLog } from "./daily";
import { cleanDayAdjustment, dayBalance } from "./day-balance";
import { scheduleDaySettle, useDaySettle } from "./day-settle";
import { cleanDayExercise } from "./exercise";
import { cleanDaySnacks } from "./snacks";

/**
 * Picoteo, deporte y balance del día: lo apuntado, quitarlo y lo que el día ha
 * movido en los próximos. `log` puede ser el registro de hoy o, sin plan, la
 * fila que picoteo y deporte crean al guardar.
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

  const removeExercise = async (id: string) => {
    setRemovingExercise(id);
    try {
      await apiPost("exercise/remove", { today, id });
      afterDayChange();
    } catch (e) {
      Alert.alert(e instanceof Error ? e.message : t("hoy.errors.removeExercise"));
    } finally {
      setRemovingExercise(null);
    }
  };

  const removeSnack = async (id: string) => {
    setRemovingSnack(id);
    try {
      await apiPost("snacks/remove", { today, id });
      afterDayChange();
    } catch (e) {
      Alert.alert(e instanceof Error ? e.message : t("hoy.errors.removeSnack"));
    } finally {
      setRemovingSnack(null);
    }
  };

  // El desvío del día, sumando los tres orígenes, y lo que ya ha movido. Es lo
  // que pinta `DayBalanceCard` — el desglose sale de datos que ya estaban, no
  // de estado nuevo (ver `day-balance.ts`).
  const balance = dayBalance(habits, snacks, exercise);
  const adjustmentRecord = cleanDayAdjustment(log?.adjustment);
  const balanceChanges = adjustmentRecord?.adjustment?.changes ?? [];

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
