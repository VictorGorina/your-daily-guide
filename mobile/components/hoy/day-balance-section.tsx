import { Activity, Cookie } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Text } from "react-native";

import { onlyRoutineExercise } from "../../lib/exercise";
import type { DayExtras } from "../../lib/use-day-extras";
import { DayBalanceCard } from "../day-balance-card";
import { ExerciseCard } from "../exercise-card";
import { SnackCard } from "../snack-card";

/**
 * Lo que desvía el día además de las comidas: el picoteo y el deporte
 * apuntados, los dos botones para añadirlos y el balance que los suma.
 */
export function DayBalanceSection({
  showNumbers,
  extras,
  onAddSnack,
  onAddExercise,
  onShowAdjustment,
}: {
  showNumbers: boolean;
  extras: DayExtras;
  onAddSnack: () => void;
  onAddExercise: () => void;
  onShowAdjustment: () => void;
}) {
  const { t } = useTranslation();
  const {
    snacks,
    exercise,
    balance,
    adjustmentRecord,
    daySettle,
    removeSnack,
    removingSnack,
    removeExercise,
    removingExercise,
  } = extras;
  return (
    <>
      {/* ── Picoteo de hoy: lo apuntado y qué ha pasado con el plan ── */}
      <SnackCard
        showNumbers={showNumbers}
        snacks={snacks}
        removingId={removingSnack}
        onRemove={(id) => void removeSnack(id)}
      />

      {/* ── Deporte de hoy: mismo formato que el picoteo ── */}
      <ExerciseCard
        showNumbers={showNumbers}
        exercise={exercise}
        removingId={removingExercise}
        onRemove={(id) => void removeExercise(id)}
      />

      {/* ── Añadir picoteo: justo encima de "Registrar deporte" ── */}
      <Pressable
        accessibilityRole="button"
        onPress={() => onAddSnack()}
        className="mt-6 flex-row items-center justify-center gap-2 rounded-full bg-surface py-3.5 active:opacity-80"
      >
        <Cookie size={16} color="#3e3d39" />
        <Text className="font-body-semibold text-sm text-foreground">{t("hoy.addSnack")}</Text>
      </Pressable>

      {/* ── Registrar deporte: pegado encima de la tira de la semana ── */}
      <Pressable
        accessibilityRole="button"
        onPress={() => onAddExercise()}
        className="mt-2.5 flex-row items-center justify-center gap-2 rounded-full bg-surface py-3.5 active:opacity-80"
      >
        <Activity size={16} color="#3e3d39" />
        <Text className="font-body-semibold text-sm text-foreground">{t("hoy.addExercise")}</Text>
      </Pressable>

      {/* ── Balance del día: la suma de los tres orígenes y lo que ha movido
           en los próximos días. Va DEBAJO de los dos botones que la
           alimentan, así que se lee como el resumen de todo lo de arriba. ── */}
      <DayBalanceCard
        showNumbers={showNumbers}
        onlyRoutineExercise={onlyRoutineExercise(exercise)}
        balance={balance}
        record={adjustmentRecord}
        settling={daySettle.pending || daySettle.running}
        failed={daySettle.failed}
        onShowAdjustment={() => onShowAdjustment()}
      />
    </>
  );
}
