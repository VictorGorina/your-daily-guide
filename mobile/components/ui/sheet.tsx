import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Panel inferior deslizante, equivalente RN del <Sheet side="bottom"> de Radix
 * que usa la web. Sustituye al portal + overlay del DOM por el Modal nativo. Se
 * cierra igual que en la web: tocando fuera o con la "X" de la esquina (el
 * tirador de arriba es decorativo). El contenido va en un ScrollView porque en
 * móvil el teclado y los paneles largos necesitan poder desplazarse.
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
        <Pressable
          className="absolute inset-0 bg-foreground/30"
          onPress={() => onOpenChange(false)}
        />
        <View className="max-h-[88%] rounded-t-3xl bg-background">
          <SafeAreaView edges={["bottom"]}>
            <View className="items-center pt-3">
              <View className="h-1 w-10 rounded-full bg-secondary" />
            </View>
            <Pressable
              onPress={() => onOpenChange(false)}
              hitSlop={8}
              accessibilityLabel="Cerrar"
              className="absolute right-3 top-3 z-10 h-8 w-8 items-center justify-center rounded-full bg-secondary active:opacity-70"
            >
              <X size={16} color="#83796c" />
            </Pressable>
            {title != null ? (
              <View className="gap-1 px-4 pt-4">
                <Text className="font-heading-medium text-lg text-foreground">{title}</Text>
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
