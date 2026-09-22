import { X } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { exerciseTotals, type DayExercise } from "../lib/exercise";

/**
 * "Deporte de hoy" en Hoy: lo apuntado, con sus kcal quemadas y una X para
 * quitarlo.
 *
 * Solo la lista, por el mismo motivo que `snack-card.tsx`: qué ha pasado con el
 * plan lo cuenta `DayBalanceCard`, con el desvío del día entero. Copia nativa
 * de `src/components/exercise-card.tsx`.
 */
export function ExerciseCard({
  exercise,
  removingId,
  onRemove,
}: {
  exercise: DayExercise | null;
  removingId: string | null;
  onRemove: (id: string) => void;
}) {
  const entries = exercise?.entries ?? [];
  if (!entries.length) return null;

  const total = -exerciseTotals(exercise);

  return (
    <View className="mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-semibold text-[11.5px] text-foreground">Deporte de hoy</Text>
        <Text className="font-mono text-[10.5px] text-muted-foreground">~{total} kcal</Text>
      </View>

      <View className="mt-2 gap-1.5">
        {entries.map((e) => (
          <View key={e.id} className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 font-body text-[13px] text-foreground"
              numberOfLines={2}
            >
              {e.activity} · {e.minutes} min · {e.intensity.toLowerCase()}
            </Text>
            <Text className="font-mono text-[11px] text-muted-foreground">{-e.kcal} kcal</Text>
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
