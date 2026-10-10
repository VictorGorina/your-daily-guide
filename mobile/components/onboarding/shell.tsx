import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Colores de icono (RN no entiende currentColor): el tema móvil es monocolor
// naranja, ver tailwind.config.js.
// Contraste AA (ticket 33): el naranja como icono es el tostado (primary-ink)
// y lo que va SOBRE el naranja, oscuro; sobre verde u oscuro sigue claro.
export const C = {
  primary: "#a84a17",
  onPrimary: "#3e3d39",
  onDark: "#fbfaf7",
  fg: "#3e3d39",
  muted: "#6b6256",
  success: "#4cae64",
  danger: "#b8433b",
};

/** Marco de los paneles que tapan el chat (índice, resumen, guardado). */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 px-5 pt-2">{children}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function OverlayHeader({
  eyebrow,
  title,
  closeLabel,
  onClose,
}: {
  eyebrow: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text className="font-mono text-[9.5px] uppercase tracking-[1px] text-muted-foreground">
          {eyebrow}
        </Text>
        <Text className="mt-0.5 font-display text-[22px] text-foreground">{title}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        accessibilityLabel={closeLabel}
        className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80"
      >
        <X size={18} color={C.fg} />
      </Pressable>
    </View>
  );
}
