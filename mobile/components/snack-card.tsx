import { X } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { snackTotals, type DaySnacks } from "../lib/snacks";

/**
 * "Picoteo de hoy" en Hoy: lo apuntado, con sus kcal y una X para quitarlo.
 *
 * Solo la lista. Qué ha pasado con el plan lo cuenta `DayBalanceCard`, porque
 * el desvío que mueve los días futuros es el del día entero y no el del
 * picoteo: esta tarjeta decía "he recolocado N comidas" al mismo tiempo que la
 * del deporte decía lo suyo, las dos sobre el mismo reajuste (feature
 * `balance-del-dia`). Copia nativa de `src/components/snack-card.tsx`.
 */
export function SnackCard({
  snacks,
  removingId,
  onRemove,
}: {
  snacks: DaySnacks | null;
  removingId: string | null;
  onRemove: (id: string) => void;
}) {
  const entries = snacks?.entries ?? [];
  if (!entries.length) return null;

  const total = Math.round(snackTotals(snacks).kcal);

  return (
    <View className="mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-semibold text-[11.5px] text-foreground">Picoteo de hoy</Text>
        <Text className="font-mono text-[10.5px] text-muted-foreground">~{total} kcal</Text>
      </View>

      <View className="mt-2 gap-1.5">
        {entries.map((e) => (
          <View key={e.id} className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 font-body text-[13px] text-foreground"
              numberOfLines={2}
            >
              {e.text}
            </Text>
            <Text className="font-mono text-[11px] text-muted-foreground">{e.kcal} kcal</Text>
            <Pressable
              onPress={() => onRemove(e.id)}
              disabled={removingId != null}
              hitSlop={6}
              accessibilityLabel={`Quitar ${e.text}`}
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
