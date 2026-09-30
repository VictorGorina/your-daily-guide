import * as Sentry from "@sentry/react-native";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
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
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nextProvider } from "react-i18next";
import { useEffect, useRef } from "react";
import { AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "../global.css";
import { ErrorFallback } from "../components/error-fallback";
import { authCacheAction } from "../lib/auth-cache";
import { AuthProvider } from "../lib/auth-context";
import { syncLocalUserData } from "../lib/local-user-data";
import { initSentry, sentryEnabled } from "../lib/sentry";
import i18n from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { useLocale } from "../lib/use-locale";
// Importado aquí a propósito: empieza a escuchar deep links desde el arranque,
// antes de cualquier navegación, para que /restablecer no se pierda el
// fragmento del enlace de recuperación. Ver lib/deep-link.ts.
import "../lib/deep-link";

// Lo antes posible, para no perder un error del arranque.
initSentry();

// Un único QueryClient para toda la app, igual que la web: las pantallas
// comparten caché por `queryKey` (["profile"], ["today"], ["logs"]...) para no
// repetir consultas a Supabase entre pestañas. Un dato vale 30 s antes de volver
// a pedirlo al montar una pantalla (antes, cada montaje lo repetía todo);
// cada escritura invalida lo que cambia, así que esto solo retrasa ver un
// cambio hecho en OTRO dispositivo (ticket 36, PERF-07).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } },
});

// En React Native, React Query no sabe cuándo la app vuelve al primer plano:
// sin esto, `refetchOnWindowFocus` no hace nada.
AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));

/**
 * Aplica a la caché lo que toca con cada evento de sesión (`auth-cache.ts`) y
 * a lo guardado en el dispositivo (`user-storage.ts`). Sin UI.
 */
function AuthCacheSync() {
  const qc = useQueryClient();
  const userId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      const action = authCacheAction(event, userId.current, next);
      userId.current = next;
      void syncLocalUserData(event, next);
      if (action === "reset") void qc.resetQueries();
      else if (action === "clear") qc.clear();
      else if (action === "invalidate") void qc.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);
  return null;
}

/** Mantiene i18next en sintonía con el locale del perfil (o el del dispositivo
 *  antes de tener sesión). Sin UI. */
function LocaleSync() {
  useLocale();
  return null;
}

function RootLayout() {
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
            <AuthCacheSync />
            <LocaleSync />
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }} />
          </AuthProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

/** Un error de render en la raíz, en vez de pantalla en blanco (ticket 27). */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} showHome={false} />;
}

// Sentry envuelve la raíz (captura los errores de render) solo si está activo.
export default sentryEnabled ? Sentry.wrap(RootLayout) : RootLayout;
