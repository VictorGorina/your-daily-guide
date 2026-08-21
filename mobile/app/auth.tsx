import { makeRedirectUri } from "expo-auth-session";
import * as Linking from "expo-linking";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
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

import { useAuth } from "../lib/auth-context";
import { supabase } from "../lib/supabase";

// Cierra la pestaña de auth que quedara abierta de un intento anterior.
WebBrowser.maybeCompleteAuthSession();

// A dónde vuelve Google/Supabase tras autenticar. Con el scheme "dailyguide"
// del app.json, esto es dailyguide://. Debe estar dado de alta en el dashboard
// de Supabase (Authentication → URL Configuration → Redirect URLs).
const redirectTo = makeRedirectUri({ scheme: "dailyguide" });

/**
 * Entrada a la app. Mismos textos y mismo orden que la pantalla /auth de la
 * web, para que las dos se sientan la misma app. Cuando el login crea sesión,
 * el `onAuthStateChange` de `AuthProvider` la refleja y el Redirect de abajo
 * saca de aquí: no se navega a mano tras cada método de entrada.
 */
export default function Auth() {
  const { session } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // Sesión anónima, igual que el "perfil aleatorio" de la web: sirve para
  // probar la app sin dar de alta una cuenta real.
  const demo = async () => {
    setDemoLoading(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
    } catch (error) {
      Alert.alert(
        "No hemos podido crear el perfil de prueba",
        error instanceof Error ? error.message : "Inténtalo otra vez.",
      );
    } finally {
      setDemoLoading(false);
    }
  };

  // Entra con Google. En nativo no hay redirect del navegador que Supabase
  // pueda leer solo, así que pedimos la URL de OAuth (skipBrowserRedirect),
  // la abrimos en una pestaña segura del sistema y, al volver por el scheme
  // dailyguide://, canjeamos el ?code= por sesión (flujo PKCE, ver supabase.ts).
  // Cuando setSession crea la sesión, el onAuthStateChange de AuthProvider la
  // refleja y el Redirect de abajo saca de esta pantalla.
  const google = async () => {
    setGoogleLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Supabase no devolvió la URL de Google.");

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return; // cancelado o cerrado por la persona

      const code = Linking.parse(result.url).queryParams?.code;
      if (typeof code !== "string") throw new Error("La respuesta de Google no traía código.");

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
    } catch (error) {
      Alert.alert(
        "No hemos podido conectar con Google",
        error instanceof Error ? error.message : "Inténtalo otra vez.",
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Faltan datos", "Escribe tu correo y tu contraseña.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // Con confirmación por correo activada, signUp no abre sesión: hay que
        // avisar de que toca ir al buzón.
        if (!data.session) setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      Alert.alert(
        "No hemos podido entrar",
        error instanceof Error ? error.message : "Inténtalo otra vez.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Cualquier método de entrada (correo, alta o perfil demo) acaba creando
  // sesión; en cuanto AuthProvider la ve, salimos de la pantalla de entrada.
  if (session) return <Redirect href="/hoy" />;

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
          <Text className="text-4xl font-display text-foreground">
            {mode === "in" ? "Bienvenido de vuelta" : "Empecemos"}
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            {mode === "in"
              ? "Entra con tu correo y sigue donde lo dejaste."
              : "Crea tu cuenta y tu coach te acompaña desde hoy."}
          </Text>

          {sent ? (
            <View className="mt-8 rounded-2xl border border-primary bg-primary-soft px-4 py-4">
              <Text className="text-sm text-foreground">
                Te he enviado un correo para confirmar tu cuenta. Ábrelo y vuelve aquí para entrar.
              </Text>
            </View>
          ) : (
            <View className="mt-8 gap-3">
              <TextInput
                className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                placeholder="tu@correo.com"
                placeholderTextColor="#83796c"
              />
              <TextInput
                className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password}
                onChangeText={setPassword}
                placeholder="Contraseña"
                placeholderTextColor="#83796c"
              />

              <Pressable
                onPress={submit}
                disabled={loading}
                className="w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <ActivityIndicator color="#3e3d39" />
                ) : (
                  <Text className="text-sm font-sans-semibold text-primary-foreground">
                    {mode === "in" ? "Entrar" : "Crear cuenta"}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => setMode(mode === "in" ? "up" : "in")}
                className="w-full py-2"
              >
                <Text className="text-center text-xs text-muted-foreground">
                  {mode === "in"
                    ? "No tengo cuenta todavía, quiero crearla"
                    : "Ya tengo cuenta, quiero entrar"}
                </Text>
              </Pressable>

              <View className="my-3 flex-row items-center gap-3">
                <View className="h-px flex-1 bg-border" />
                <Text className="text-xs text-muted-foreground">o</Text>
                <View className="h-px flex-1 bg-border" />
              </View>

              <Pressable
                onPress={google}
                disabled={googleLoading}
                className="w-full flex-row items-center justify-center rounded-full border border-input bg-surface py-4 active:opacity-90 disabled:opacity-60"
              >
                {googleLoading ? (
                  <ActivityIndicator color="#83796c" />
                ) : (
                  <Text className="text-sm font-sans-medium text-foreground">
                    Continuar con Google
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={demo}
                disabled={demoLoading}
                className="mt-3 w-full items-center rounded-full border border-dashed border-input bg-surface py-3.5 active:opacity-90 disabled:opacity-60"
              >
                <Text className="text-sm font-sans-medium text-muted-foreground">
                  {demoLoading ? "Creando perfil..." : "Probar con un perfil aleatorio"}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
