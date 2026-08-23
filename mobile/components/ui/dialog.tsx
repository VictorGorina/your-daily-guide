import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

/**
 * Modal centrado, equivalente RN del <Dialog> de Radix (lo usa el detalle de
 * día del calendario). Toque en el fondo para cerrar.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => onOpenChange(false)}
    >
      <View className="flex-1 items-center justify-center px-6">
        <Pressable
          className="absolute inset-0 bg-foreground/30"
          onPress={() => onOpenChange(false)}
        />
        <View className="max-h-[80%] w-full max-w-md rounded-3xl bg-background p-5">
          {title ? (
            <Text className="font-heading-medium mb-3 text-lg capitalize text-foreground">
              {title}
            </Text>
          ) : null}
          <ScrollView contentContainerClassName="gap-4">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
