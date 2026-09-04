import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DMMono_400Regular, DMMono_500Medium } from "@expo-google-fonts/dm-mono";
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
} from "@expo-google-fonts/figtree";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_600SemiBold,
  WorkSans_700Bold,
} from "@expo-google-fonts/work-sans";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nextProvider } from "react-i18next";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "../global.css";
import { AuthProvider } from "../lib/auth-context";
import i18n from "../lib/i18n";
import { useLocale } from "../lib/use-locale";
// Importado aquí a propósito: empieza a escuchar deep links desde el arranque,
// antes de cualquier navegación, para que /restablecer no se pierda el
// fragmento del enlace de recuperación. Ver lib/deep-link.ts.
import "../lib/deep-link";

// Un único QueryClient para toda la app, igual que la web: las pantallas
// comparten caché por `queryKey` (["profile"], ["today"], ["logs"]...) para no
// repetir consultas a Supabase entre pestañas.
const queryClient = new QueryClient();

/** Mantiene i18next en sintonía con el locale del perfil (o el del dispositivo
 *  antes de tener sesión). Sin UI. */
function LocaleSync() {
  useLocale();
  return null;
}

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
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    DMMono_400Regular,
    DMMono_500Medium,
  });

  // Fondo liso mientras cargan las fuentes (instantáneo en la práctica: son
  // pocos KB empaquetados con la app, no una descarga de red) para no pintar
  // texto con la tipografía del sistema y que salte al cambiar.
  if (!fontsLoaded) return <View className="flex-1 bg-background" />;

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LocaleSync />
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }} />
          </AuthProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
