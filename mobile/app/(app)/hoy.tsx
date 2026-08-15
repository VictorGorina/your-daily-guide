import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

/**
 * Provisional: solo confirma que la sesión llega hasta aquí. La pantalla de
 * verdad (guía del día, comidas, hábitos) se porta en la Fase 3.
 */
export default function Hoy() {
  const { session } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center gap-4 px-6">
        <Text className="text-4xl font-semibold text-foreground">Hoy</Text>
        <Text className="text-sm text-muted-foreground">
          Sesión iniciada como{" "}
          {session?.user.is_anonymous ? "perfil de prueba" : (session?.user.email ?? "—")}
        </Text>

        <Pressable
          onPress={() => supabase.auth.signOut()}
          className="mt-4 w-full items-center rounded-full border border-input bg-surface py-4 active:opacity-90"
        >
          <Text className="text-sm font-medium text-foreground">Cerrar sesión</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
