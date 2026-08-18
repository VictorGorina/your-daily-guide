import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_600SemiBold,
  WorkSans_700Bold,
} from "@expo-google-fonts/work-sans";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "../global.css";
import { AuthProvider } from "../lib/auth-context";

// Un único QueryClient para toda la app, igual que la web: las pantallas
// comparten caché por `queryKey` (["profile"], ["today"], ["logs"]...) para no
// repetir consultas a Supabase entre pestañas.
const queryClient = new QueryClient();

export default function RootLayout() {
  // React Native no sintetiza negrita sobre una tipografía cargada: cada peso
  // que se usa en la app (ver tailwind.config.js `fontFamily`) necesita su
  // propio archivo. Fraunces solo hace falta en el peso de los títulos (600).
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
    WorkSans_700Bold,
  });

  // Fondo liso mientras cargan las fuentes (instantáneo en la práctica: son
  // pocos KB empaquetados con la app, no una descarga de red) para no pintar
  // texto con la tipografía del sistema y que salte al cambiar.
  if (!fontsLoaded) return <View className="flex-1 bg-background" />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
