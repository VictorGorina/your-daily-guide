import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { exerciseTotals, type DayExercise } from "../lib/exercise";

/**
 * "Deporte de hoy" en Hoy: lo apuntado, con sus kcal quemadas y una X para
 * quitarlo. Una sesión de su rutina dice que ya va en el plan: solo cuenta lo
 * que pase de ella.
 *
 * Solo la lista, por el mismo motivo que `snack-card.tsx`: qué ha pasado con el
 * plan lo cuenta `DayBalanceCard`, con el desvío del día entero. Copia nativa
 * de `src/components/exercise-card.tsx`.
 */
export function ExerciseCard({
  exercise,
  removingId,
  onRemove,
  showNumbers = true,
}: {
  exercise: DayExercise | null;
  removingId: string | null;
  onRemove: (id: string) => void;
  /** `false` con la preferencia de no ver cifras (ticket 01): solo la lista. */
  showNumbers?: boolean;
}) {
  const { t } = useTranslation();
  const entries = exercise?.entries ?? [];
  if (!entries.length) return null;

  // Solo lo que desvía el día: la parte de rutina ya va en el objetivo (ticket 16).
  const total = -exerciseTotals(exercise);
  const anyRoutine = entries.some((e) => e.routine);

  return (
    <View className="mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-semibold text-[11.5px] text-foreground">
          {t("exercise.cardTitle")}
        </Text>
        {showNumbers ? (
          <Text className="font-mono text-[10.5px] text-muted-foreground">
            ~{total} kcal{anyRoutine ? " extra" : ""}
          </Text>
        ) : null}
      </View>

      <View className="mt-2 gap-1.5">
        {entries.map((e) => (
          <View key={e.id} className="flex-row items-center gap-2">
            <View className="min-w-0 flex-1">
              <Text className="font-body text-[13px] text-foreground" numberOfLines={2}>
                {t(`exercise.activities.${e.activity}`, { defaultValue: e.activity })} · {e.minutes}{" "}
                min ·{" "}
                {t(`exercise.intensity.${e.intensity}`, {
                  defaultValue: e.intensity,
                }).toLowerCase()}
              </Text>
              {e.routine ? (
                <Text className="font-body text-[11px] text-muted-foreground">
                  {e.routineIndex && e.routineOf
                    ? t("exercise.routineCount", { index: e.routineIndex, of: e.routineOf })
                    : t("exercise.routine")}
                  {showNumbers && e.kcal < 0 ? ` · ${-e.kcal} kcal extra` : ""}
                </Text>
              ) : null}
            </View>
            {showNumbers && !e.routine ? (
              <Text className="font-mono text-[11px] text-muted-foreground">{-e.kcal} kcal</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => onRemove(e.id)}
              disabled={removingId != null}
              hitSlop={6}
              accessibilityLabel={t("common.removeNamed", {
                what: t(`exercise.activities.${e.activity}`, { defaultValue: e.activity }),
              })}
              className="h-7 w-7 items-center justify-center rounded-full bg-background active:opacity-70"
            >
              {removingId === e.id ? (
                <ActivityIndicator size="small" color="#6b6256" />
              ) : (
                <X size={13} color="#6b6256" />
              )}
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
