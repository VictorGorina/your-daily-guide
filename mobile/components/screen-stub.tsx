import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "./bottom-nav";

/**
 * Placeholder de las pantallas que aún no se han portado a la app nativa. La
 * pantalla Hoy ya es completa; el resto (Plan, Historial, Ajustes, chat,
 * onboarding) se portan una a una en las siguientes fases. Mantiene la barra de
 * pestañas para que la navegación se sienta coherente mientras tanto.
 */
export function ScreenStub({
  title,
  note,
  withNav = true,
  back,
}: {
  title: string;
  note?: string;
  withNav?: boolean;
  back?: boolean;
}) {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-1 justify-center gap-3 px-6">
        <Text className="text-4xl font-semibold text-foreground">{title}</Text>
        <Text className="text-sm text-muted-foreground">
          {note ?? "Esta pantalla aún no está portada a la app. Llegará en una próxima versión."}
        </Text>
        {back ? (
          <Text
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/hoy"))}
            className="mt-2 text-sm font-medium text-primary"
          >
            ← Volver
          </Text>
        ) : null}
      </View>
      {withNav ? <BottomNav /> : null}
    </SafeAreaView>
  );
}
