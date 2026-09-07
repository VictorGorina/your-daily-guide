import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDeepLinkUrl } from "../lib/deep-link";
import { supabase } from "../lib/supabase";

/**
 * Destino del enlace del correo de confirmación de alta cuando el alta se pidió
 * desde el móvil (`platform: "mobile"` → `dailyguide://confirmado`, ver
 * requestSignupConfirmation en la web). Confirmar el correo deja la sesión
 * abierta, así que aquí solo hay que instalarla y entrar.
 *
 * El enlace llega de dos formas, igual que en app/restablecer.tsx:
 *
 *   - `#access_token=…&refresh_token=…` — el caso normal aquí, porque el enlace
 *     lo genera la Admin API y no pasa por el flujo PKCE de este dispositivo.
 *   - `?code=…` si en algún momento se generase dentro del flujo PKCE.
 *
 * Si caducó o ya se usó, Supabase redirige sin ninguna de las dos cosas y con
 * el motivo en `error`/`error_description`.
 */
export default function Confirmado() {
  const router = useRouter();
  const { code, error_description } = useLocalSearchParams<{
    code?: string;
    error_description?: string;
  }>();
  const url = useDeepLinkUrl();

  const [status, setStatus] = useState<"waiting" | "done" | "error">("waiting");
  const resolved = useRef(false);

  // Red de seguridad: si a los 12 s seguimos esperando, el enlace no era válido
  // y no dejamos a nadie mirando un spinner para siempre.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setStatus((current) => (current === "waiting" ? "error" : current));
    }, 12000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const hash = url && url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
    const hashParams = new URLSearchParams(hash);
    const rawError =
      (typeof error_description === "string" ? error_description : "") ||
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      "";

    // El motivo de Supabase viene en inglés y a veces muy técnico. No se enseña:
    // la salida siempre es la misma, pedir otro correo desde la pantalla de
    // entrar.
    if (rawError) {
      setStatus("error");
      return;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!code && !(accessToken && refreshToken)) return;

    // Una sola vez: un doble render o un cambio de `url` no debe reintentarlo.
    if (resolved.current) return;
    resolved.current = true;

    const resolve =
      accessToken && refreshToken
        ? supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        : supabase.auth.exchangeCodeForSession(code as string);

    resolve
      .then(({ error }) => {
        if (error) {
          setStatus("error");
          return;
        }
        setStatus("done");
        // Deja leer el "¡confirmada!" un momento antes de entrar.
        setTimeout(() => router.replace("/hoy"), 1200);
      })
      .catch(() => setStatus("error"));
  }, [code, error_description, router, url]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-14">
        {status === "waiting" && (
          <View className="items-center">
            <ActivityIndicator color="#ff8a3d" />
            <Text className="mt-6 text-2xl font-display text-foreground">
              Confirmando tu cuenta…
            </Text>
            <Text className="mt-2 text-sm text-muted-foreground">Un momento, ya casi está.</Text>
          </View>
        )}

        {status === "done" && (
          <View className="items-center">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
              <Check color="#ff8a3d" size={28} />
            </View>
            <Text className="mt-6 text-2xl font-display text-foreground">¡Cuenta confirmada!</Text>
            <Text className="mt-2 text-sm text-muted-foreground">Entrando en Peppers…</Text>
          </View>
        )}

        {status === "error" && (
          <View className="items-center">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
              <AlertCircle color="#e2685f" size={28} />
            </View>
            <Text className="mt-6 text-2xl font-display text-foreground">
              Este enlace ya no funciona
            </Text>
            <Text className="mt-2 text-center text-sm text-muted-foreground">
              Puede haber caducado o haberse usado ya. Entra con tu correo y te reenviamos uno
              nuevo.
            </Text>
            <Pressable
              onPress={() => router.replace("/auth")}
              className="mt-8 w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                Volver a entrar
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
