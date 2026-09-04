import { makeRedirectUri } from "expo-auth-session";
import * as Linking from "expo-linking";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

import { apiPostPublic } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { saveProfile } from "../lib/daily";
import { randomDemoProfile } from "../lib/demo-profile";
import { SUPPORTED_LOCALES } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { useLocale } from "../lib/use-locale";

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
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // Sesión anónima + perfil aleatorio con el onboarding ya dado por completado,
  // igual que el "perfil aleatorio" de la web (src/routes/auth.tsx): entra
  // directo al dashboard sin responder las preguntas. `demoLoading` mantiene
  // el Redirect de abajo en pausa hasta que el perfil está guardado, para que
  // /hoy no rebote a onboarding al ver un perfil todavía a medias.
  const demo = async () => {
    setDemoLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      await saveProfile(randomDemoProfile());
    } catch (error) {
      Alert.alert(t("auth.errDemo"), error instanceof Error ? error.message : t("common.retry"));
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
      Alert.alert(t("auth.errGoogle"), error instanceof Error ? error.message : t("common.retry"));
    } finally {
      setGoogleLoading(false);
    }
  };

  // Envía el correo con el enlace para crear una contraseña nueva. Supabase
  // responde igual exista o no una cuenta con ese correo (no filtra qué correos
  // están registrados), así que siempre mostramos la pantalla de "revisa tu
  // buzón".
  const forgotPassword = async () => {
    if (!email.trim().includes("@")) {
      Alert.alert(t("auth.errNeedEmail"));
      return;
    }

    setLoading(true);
    try {
      await apiPostPublic("auth/reset", { email: email.trim(), platform: "mobile" });
      setSent(true);
    } catch (error) {
      Alert.alert(
        t("auth.errSendLink"),
        error instanceof Error ? error.message : t("common.retry"),
      );
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert(t("auth.errNeedCreds"));
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
      Alert.alert(t("auth.errSignIn"), error instanceof Error ? error.message : t("common.retry"));
    } finally {
      setLoading(false);
    }
  };

  // Cualquier método de entrada (correo, alta o perfil demo) acaba creando
  // sesión; en cuanto AuthProvider la ve, salimos de la pantalla de entrada.
  // Excepción: mientras se prepara el perfil demo esperamos a tenerlo guardado
  // antes de redirigir, si no /hoy vería el perfil a medias y rebotaría a
  // onboarding.
  if (session && !demoLoading) return <Redirect href="/hoy" />;

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
          <View className="flex-row items-start justify-between gap-2">
            <Text className="flex-1 text-4xl font-display text-foreground">
              {mode === "in"
                ? t("auth.titleIn")
                : mode === "up"
                  ? t("auth.titleUp")
                  : t("auth.titleForgot")}
            </Text>
            <View className="mt-1 flex-row gap-1 rounded-full bg-secondary p-0.5">
              {SUPPORTED_LOCALES.map((l) => (
                <Pressable
                  key={l}
                  onPress={() => void setLocale(l)}
                  className={`rounded-full px-2 py-1 ${l === locale ? "bg-foreground" : ""}`}
                >
                  <Text
                    className={`text-[11px] font-sans-medium uppercase ${l === locale ? "text-background" : "text-muted-foreground"}`}
                  >
                    {l}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Text className="mt-2 text-sm text-muted-foreground">
            {mode === "in"
              ? t("auth.subtitleIn")
              : mode === "up"
                ? t("auth.subtitleUp")
                : t("auth.subtitleForgot")}
          </Text>

          {sent ? (
            <View className="mt-8 gap-3">
              <View className="rounded-2xl border border-primary bg-primary-soft px-4 py-4">
                <Text className="text-sm text-foreground">
                  {mode === "forgot" ? t("auth.sentReset") : t("auth.sentConfirm")}
                </Text>
              </View>
              {mode === "forgot" && (
                <Pressable
                  onPress={() => {
                    setSent(false);
                    setMode("in");
                  }}
                  className="w-full py-2"
                >
                  <Text className="text-center text-xs text-muted-foreground">
                    {t("auth.backToSignIn")}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : mode === "forgot" ? (
            <View className="mt-8 gap-3">
              <TextInput
                className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                placeholder={t("auth.emailPlaceholder")}
                placeholderTextColor="#83796c"
              />

              <Pressable
                onPress={forgotPassword}
                disabled={loading}
                className="w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <ActivityIndicator color="#3e3d39" />
                ) : (
                  <Text className="text-sm font-sans-semibold text-primary-foreground">
                    {t("auth.sendLink")}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={() => setMode("in")} className="w-full py-2">
                <Text className="text-center text-xs text-muted-foreground">
                  {t("auth.rememberLink")}
                </Text>
              </Pressable>
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
                placeholder={t("auth.emailPlaceholder")}
                placeholderTextColor="#83796c"
              />
              <TextInput
                className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground"
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password}
                onChangeText={setPassword}
                placeholder={t("auth.passwordPlaceholder")}
                placeholderTextColor="#83796c"
              />

              {mode === "in" && (
                <Pressable onPress={() => setMode("forgot")} className="w-full py-1">
                  <Text className="text-right text-xs text-muted-foreground">
                    {t("auth.forgotLink")}
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={submit}
                disabled={loading}
                className="w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
              >
                {loading ? (
                  <ActivityIndicator color="#3e3d39" />
                ) : (
                  <Text className="text-sm font-sans-semibold text-primary-foreground">
                    {mode === "in" ? t("auth.signIn") : t("auth.signUp")}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => setMode(mode === "in" ? "up" : "in")}
                className="w-full py-2"
              >
                <Text className="text-center text-xs text-muted-foreground">
                  {mode === "in" ? t("auth.toSignUp") : t("auth.toSignIn")}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Google y perfil demo salen en todos los modos, igual que en la web:
              si te has quedado fuera, entrar con Google es una salida directa. */}
          {!sent && (
            <>
              <View className="my-3 flex-row items-center gap-3">
                <View className="h-px flex-1 bg-border" />
                <Text className="text-xs text-muted-foreground">{t("auth.or")}</Text>
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
                    {t("auth.google")}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={demo}
                disabled={demoLoading}
                className="mt-3 w-full items-center rounded-full border border-dashed border-input bg-surface py-3.5 active:opacity-90 disabled:opacity-60"
              >
                <Text className="text-sm font-sans-medium text-muted-foreground">
                  {demoLoading ? t("auth.demoCreating") : t("auth.demo")}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
