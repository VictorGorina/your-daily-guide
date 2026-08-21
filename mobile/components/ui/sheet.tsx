import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Panel inferior deslizante, equivalente RN del <Sheet side="bottom"> de Radix
 * que usa la web. Sustituye al portal + overlay del DOM por el Modal nativo:
 * toque fuera para cerrar, y el contenido va en un ScrollView porque en móvil
 * el teclado y los paneles largos necesitan poder desplazarse.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={() => onOpenChange(false)}
    >
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/40" onPress={() => onOpenChange(false)} />
        <View className="max-h-[88%] rounded-t-3xl border-t border-border bg-background">
          <SafeAreaView edges={["bottom"]}>
            <View className="items-center pt-3">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>
            {title != null ? (
              <View className="gap-1 px-4 pt-4">
                <Text className="text-lg font-sans-semibold text-foreground">{title}</Text>
                {description ? (
                  <Text className="text-sm text-muted-foreground">{description}</Text>
                ) : null}
              </View>
            ) : null}
            <ScrollView
              className="px-4"
              contentContainerClassName="pb-2"
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
