import { X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

/**
 * Aviso: la mesa del hogar ha cambiado (entró o salió alguien, cambió una
 * ración, una alergia o una etapa) y el recálculo automático ya ha rehecho el
 * plan y, sobre todo, las CANTIDADES de la compra.
 *
 * No es un paso de confirmación —el recálculo se hace solo, por decisión de
 * producto— sino la constancia de que ha pasado. Copia nativa de
 * `src/components/plan-updated-banner.tsx`.
 */
export function PlanUpdatedBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View className="mb-4 flex-row items-start justify-between gap-3 rounded-2xl bg-warning/15 px-3.5 py-3">
      <Text className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground">
        <Text className="font-body-semibold">La mesa ha cambiado.</Text> Hemos actualizado tu plan y
        las cantidades de la compra.
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityLabel="Descartar aviso"
        className="h-6 w-6 items-center justify-center rounded-full active:opacity-70"
      >
        <X size={14} color="#83796c" />
      </Pressable>
    </View>
  );
}
