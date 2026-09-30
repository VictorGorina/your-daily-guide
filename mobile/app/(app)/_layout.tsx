import { Redirect, Stack, type ErrorBoundaryProps } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { ErrorFallback } from "../../components/error-fallback";
import { useAuth } from "../../lib/auth-context";

/**
 * Guardia de las pantallas autenticadas. Todo lo que cuelga de `(app)/`
 * requiere sesión: sin ella, de vuelta a la entrada. Así el resto de pantallas
 * (Fase 3) no repiten la comprobación cada una. El paréntesis en el nombre es
 * un grupo de expo-router: no aparece en la URL, `(app)/hoy` sigue siendo
 * `/hoy`.
 */
/** Un error de render en una pantalla con sesión, en vez de pantalla en blanco (ticket 27). */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} showHome />;
}

export default function AppLayout() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#6dbe7b" />
      </View>
    );
  }

  if (!session) return <Redirect href="/auth" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
