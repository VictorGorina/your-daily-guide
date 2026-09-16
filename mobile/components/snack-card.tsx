import { Info, X } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { snackOutcomeNote, snackTotals, type DaySnacks } from "../lib/snacks";

/**
 * "Picoteo de hoy" en Hoy (feature `picoteo-hoy`): lo apuntado, con sus kcal y
 * una X para quitarlo, y debajo qué ha pasado con el plan. Solo se pinta si hay
 * algo que enseñar. Copia nativa de `src/components/snack-card.tsx`.
 */
export function SnackCard({
  snacks,
  settling,
  failed,
  removingId,
  onRemove,
  onShowAdjustment,
}: {
  snacks: DaySnacks | null;
  /** Hay un asentamiento pendiente o en vuelo. */
  settling: boolean;
  /** El último asentamiento falló. */
  failed: boolean;
  removingId: string | null;
  onRemove: (id: string) => void;
  onShowAdjustment: () => void;
}) {
  const entries = snacks?.entries ?? [];
  const adjustment = snacks?.adjustment;
  if (!entries.length && !adjustment?.changes.length) return null;

  const total = snackTotals(snacks).kcal;
  const note = snackOutcomeNote(snacks?.lastOutcome);
  const moved = adjustment?.changes.length ?? 0;

  return (
    <View className="mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-semibold text-[11.5px] text-foreground">Picoteo de hoy</Text>
        {entries.length ? (
          <Text className="font-mono text-[10.5px] text-muted-foreground">~{total} kcal</Text>
        ) : null}
      </View>

      {entries.length ? (
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
      ) : null}

      {settling ? (
        <View className="mt-2.5 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#ff8a3d" />
          <Text className="font-body text-[11.5px] text-muted-foreground">Revisando tu plan…</Text>
        </View>
      ) : (
        <>
          {moved ? (
            <Pressable
              onPress={onShowAdjustment}
              className="mt-2.5 flex-row items-center gap-1.5 active:opacity-70"
            >
              <Info size={13} color="#ff8a3d" />
              <Text className="font-body-medium text-[11.5px] text-primary">
                He ajustado {moved} {moved === 1 ? "comida" : "comidas"} para compensarlo · Ver
              </Text>
            </Pressable>
          ) : null}
          {failed ? (
            <Text className="mt-2.5 font-body text-[11.5px] text-muted-foreground">
              No he podido revisar el plan ahora; lo intento de nuevo más tarde.
            </Text>
          ) : note ? (
            <Text className="mt-2.5 font-body text-[11.5px] text-muted-foreground">{note}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}
