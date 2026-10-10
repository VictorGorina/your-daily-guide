import { Activity, Cookie } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DayBalanceCard } from "@/components/day-balance-card";
import { ExerciseCard } from "@/components/exercise-card";
import { SnackCard } from "@/components/snack-card";
import { onlyRoutineExercise } from "@/lib/exercise";
import type { DayExtras } from "@/lib/use-day-extras";

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
      {/* Picoteo de hoy: solo lo apuntado. El efecto sobre el plan lo cuenta
        `DayBalanceCard`, una vez y para el día entero. */}
      <SnackCard
        showNumbers={showNumbers}
        snacks={snacks}
        removingId={removingSnack}
        onRemove={(id) => void removeSnack(id)}
      />

      {/* Deporte de hoy: mismo formato que el picoteo. */}
      <ExerciseCard
        showNumbers={showNumbers}
        exercise={exercise}
        removingId={removingExercise}
        onRemove={(id) => void removeExercise(id)}
      />

      {/* Añadir picoteo: justo encima de "Registrar deporte", como en móvil. */}
      <button
        type="button"
        onClick={() => onAddSnack()}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-3.5 text-sm font-semibold text-foreground transition-transform active:scale-[0.99]"
      >
        <Cookie className="h-4 w-4" aria-hidden />
        {t("hoy.addSnack")}
      </button>

      {/* Registrar deporte: mismo formato que "Añadir picoteo", pegado encima
        de la tira de la semana, como en la app móvil. */}
      <button
        type="button"
        onClick={() => onAddExercise()}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-3.5 text-sm font-semibold text-foreground transition-transform active:scale-[0.99]"
      >
        <Activity className="h-4 w-4" aria-hidden />
        {t("hoy.addExercise")}
      </button>

      {/* Balance del día: la suma de los tres orígenes y lo que ha movido en
        los próximos días. Va DEBAJO de los dos botones que la alimentan, así
        que se lee como el resumen de todo lo de arriba. */}
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
