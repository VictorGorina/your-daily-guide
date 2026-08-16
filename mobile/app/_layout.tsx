import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "../global.css";
import { AuthProvider } from "../lib/auth-context";

// Un único QueryClient para toda la app, igual que la web: las pantallas
// comparten caché por `queryKey` (["profile"], ["today"], ["logs"]...) para no
// repetir consultas a Supabase entre pestañas.
const queryClient = new QueryClient();

export default function RootLayout() {
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
