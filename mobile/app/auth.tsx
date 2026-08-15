import { Redirect } from "expo-router";
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
          <Text className="text-4xl font-semibold text-foreground">
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
                placeholderTextColor="#677380"
              />
              <TextInput
                className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password}
                onChangeText={setPassword}
                placeholder="Contraseña"
                placeholderTextColor="#677380"
              />

              <Pressable
                onPress={submit}
                disabled={loading}
                className="w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <ActivityIndicator color="#f9fcff" />
                ) : (
                  <Text className="text-sm font-semibold text-primary-foreground">
                    {mode === "in" ? "Entrar" : "Crear cuenta"}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={() => setMode(mode === "in" ? "up" : "in")} className="w-full py-2">
                <Text className="text-center text-xs text-muted-foreground">
                  {mode === "in"
                    ? "No tengo cuenta todavía, quiero crearla"
                    : "Ya tengo cuenta, quiero entrar"}
                </Text>
              </Pressable>

              <Pressable
                onPress={demo}
                disabled={demoLoading}
                className="mt-3 w-full items-center rounded-full border border-dashed border-input bg-surface py-3.5 active:opacity-90 disabled:opacity-60"
              >
                <Text className="text-sm font-medium text-muted-foreground">
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
