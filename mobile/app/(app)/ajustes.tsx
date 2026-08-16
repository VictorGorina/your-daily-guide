import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

export default function Ajustes() {
  const { session } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-1 gap-4 px-6 pt-6">
        <Text className="text-4xl font-semibold text-foreground">Ajustes</Text>
        <Text className="text-sm text-muted-foreground">
          Sesión iniciada como{" "}
          {session?.user.is_anonymous ? "perfil de prueba" : (session?.user.email ?? "—")}
        </Text>
        <Text className="text-sm text-muted-foreground">
          Los ajustes completos (perfil, tono, horarios, hogar) se portan a la app en una próxima
          fase.
        </Text>

        <Pressable
          onPress={() => supabase.auth.signOut()}
          className="mt-2 w-full items-center rounded-full border border-input bg-surface py-4 active:opacity-90"
        >
          <Text className="text-sm font-medium text-foreground">Cerrar sesión</Text>
        </Pressable>
      </View>
      <BottomNav />
    </SafeAreaView>
  );
}
