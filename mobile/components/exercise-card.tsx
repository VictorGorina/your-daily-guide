import { X } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { exerciseTotals, type DayExercise } from "../lib/exercise";

/** "Dentro de tu rutina (2 de 3 esta semana) · ya está en tu plan" (ticket 16). */
const routineLine = (index?: number, of?: number) =>
  `Dentro de tu rutina${index && of ? ` (${index} de ${of} esta semana)` : ""} · ya está en tu plan`;

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
  const entries = exercise?.entries ?? [];
  if (!entries.length) return null;

  // Solo lo que desvía el día: la parte de rutina ya va en el objetivo (ticket 16).
  const total = -exerciseTotals(exercise);
  const anyRoutine = entries.some((e) => e.routine);

  return (
    <View className="mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-semibold text-[11.5px] text-foreground">Deporte de hoy</Text>
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
                {e.activity} · {e.minutes} min · {e.intensity.toLowerCase()}
              </Text>
              {e.routine ? (
                <Text className="font-body text-[11px] text-muted-foreground">
                  {routineLine(e.routineIndex, e.routineOf)}
                  {showNumbers && e.kcal < 0 ? ` · ${-e.kcal} kcal extra` : ""}
                </Text>
              ) : null}
            </View>
            {showNumbers && !e.routine ? (
              <Text className="font-mono text-[11px] text-muted-foreground">{-e.kcal} kcal</Text>
            ) : null}
            <Pressable
              onPress={() => onRemove(e.id)}
              disabled={removingId != null}
              hitSlop={6}
              accessibilityLabel={`Quitar ${e.activity}`}
              className="h-7 w-7 items-center justify-center rounded-full bg-background active:opacity-70"
            >
              {removingId === e.id ? (
                <ActivityIndicator size="small" color="#83796c" />
              ) : (
                <X size={13} color="#83796c" />
              )}
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
