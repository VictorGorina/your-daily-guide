import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useDeepLinkUrl } from "../lib/deep-link";
import { supabase } from "../lib/supabase";

/**
 * Destino del enlace del correo de "he olvidado la contraseña" (ver
 * `forgotPassword` en app/auth.tsx). Supabase redirige aquí con el scheme de la
 * app — `dailyguide://restablecer?code=...` — y expo-router abre esta pantalla
 * dejando el `code` en los search params.
 *
 * Por qué el flujo es nativo y no reutiliza la página `/restablecer` de la web:
 * el cliente de móvil usa PKCE (lib/supabase.ts), así que el code verifier vive
 * en el AsyncStorage de este dispositivo y `exchangeCodeForSession` sólo puede
 * canjear el código aquí, no en un navegador.
 *
 * Si el enlace caducó o ya se usó, Supabase redirige sin `code` (con el motivo
 * unas veces en la query `?error_description=` y otras en el fragmento
 * `#error_description=`, como los tokens del flujo implícito). En cualquiera de
 * esos casos mostramos el estado de error y se pide un enlace nuevo.
 */
export default function Restablecer() {
  const router = useRouter();
  const { code, error_description } = useLocalSearchParams<{
    code?: string;
    error_description?: string;
  }>();
  const url = useDeepLinkUrl();

  const [status, setStatus] = useState<"waiting" | "ready" | "done" | "error">("waiting");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const exchanged = useRef(false);

  // Red de seguridad: si a los 12 s seguimos "comprobando" (canje colgado, o se
  // ha llegado aquí sin enlace válido), damos el enlace por muerto.
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

    // Supabase manda el motivo (`rawError`) en inglés y a veces muy técnico
    // ("PKCE code verifier not found…"). No se enseña tal cual: el estado de
    // error ya explica en español qué hacer, y da igual el motivo exacto —
    // la salida siempre es pedir un enlace nuevo desde este móvil.
    if (rawError) {
      setStatus("error");
      return;
    }

    // El enlace llega de dos formas según cómo se pidiera el reset:
    //
    //   - `?code=…` cuando lo pidió esta app. Es el caso normal: el cliente de
    //     móvil es PKCE (lib/supabase.ts), así que hay un code verifier en el
    //     AsyncStorage de este dispositivo con el que canjearlo.
    //   - `#access_token=…&refresh_token=…` cuando el enlace se generó fuera del
    //     flujo PKCE — por ejemplo desde el panel de Supabase o con la Admin
    //     API. No hay nada que canjear: los tokens ya vienen puestos y basta con
    //     instalarlos como sesión.
    //
    // Sin ninguna de las dos cosas puede ser que `url` aún no haya resuelto: se
    // espera, y si no llega nada lo cierra el timeout de arriba.
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!code && !(accessToken && refreshToken)) return;

    // El enlace se resuelve una sola vez: un doble render (Strict Mode) o un
    // cambio de `url` no debe reintentarlo.
    if (exchanged.current) return;
    exchanged.current = true;

    const resolve =
      accessToken && refreshToken
        ? supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        : supabase.auth.exchangeCodeForSession(code as string);

    resolve
      .then(({ error }) => setStatus(error ? "error" : "ready"))
      .catch(() => setStatus("error"));
  }, [code, error_description, url]);

  const submit = async () => {
    if (password.length < 6) {
      Alert.alert("Contraseña muy corta", "Tiene que tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("No coinciden", "Las dos contraseñas tienen que ser iguales.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      // Deja leer el "¡hecho!" un momento antes de entrar. La sesión de
      // recuperación ya es una sesión normal, así que el guard de (app)/ deja pasar.
      setTimeout(() => router.replace("/hoy"), 1200);
    } catch (error) {
      Alert.alert(
        "No hemos podido guardar la contraseña",
        error instanceof Error ? error.message : "Inténtalo otra vez.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-14"
          keyboardShouldPersistTaps="handled"
        >
          {status === "waiting" && (
            <View className="items-center">
              <ActivityIndicator color="#ff8a3d" />
              <Text className="mt-6 text-2xl font-display text-foreground">
                Comprobando el enlace…
              </Text>
              <Text className="mt-2 text-sm text-muted-foreground">Un momento, ya casi está.</Text>
            </View>
          )}

          {status === "ready" && (
            <View>
              <Text className="text-4xl font-display text-foreground">
                Crea tu contraseña nueva
              </Text>
              <Text className="mt-2 text-sm text-muted-foreground">
                Elige una de al menos 6 caracteres.
              </Text>

              <View className="mt-8 gap-3">
                <TextInput
                  className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Contraseña nueva"
                  placeholderTextColor="#83796c"
                />
                <TextInput
                  className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Repite la contraseña"
                  placeholderTextColor="#83796c"
                />

                <Pressable
                  onPress={submit}
                  disabled={saving}
                  className="w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
                >
                  {saving ? (
                    <ActivityIndicator color="#3e3d39" />
                  ) : (
                    <Text className="text-sm font-sans-semibold text-primary-foreground">
                      Guardar contraseña
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {status === "done" && (
            <View className="items-center">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
                <Check color="#ff8a3d" size={28} />
              </View>
              <Text className="mt-6 text-2xl font-display text-foreground">
                ¡Contraseña actualizada!
              </Text>
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
                Puede haber caducado o haberse usado ya. Pide uno nuevo desde la pantalla de entrar
                y ábrelo en este mismo móvil.
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
