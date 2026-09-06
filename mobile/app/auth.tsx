import { makeRedirectUri } from "expo-auth-session";
import * as Linking from "expo-linking";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Bean, Beef, Carrot, Drumstick, Fish, Milk, Wheat } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
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

// ── Fila de pimientos ────────────────────────────────────────────────────────
// El mismo motivo decorativo del artboard 3a del rediseño ("Rediseño Peppers
// nutrición"): siete círculos, uno por familia de alimento, con el icono Lucide
// de categoría (la misma familia que `DishCategoryIcon` en food-category-bg.tsx
// y los encabezados de Ingredientes). RN no tiene `color-mix`, así que el tinte
// del círculo y el color del icono se calculan a mano igual que `mixHex` allí.
const SURFACE = "#fbfaf7";
const FOREGROUND = "#3e3d39";

function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const PEPPERS: { accent: string; Icon: typeof Carrot }[] = [
  { accent: "#6dbe7b", Icon: Carrot }, // verduras
  { accent: "#4c9bd6", Icon: Fish }, // pescado
  { accent: "#9a7655", Icon: Bean }, // legumbres
  { accent: "#d7b58a", Icon: Wheat }, // cereales
  { accent: "#f2c14e", Icon: Drumstick }, // aves
  { accent: "#f5e6c8", Icon: Milk }, // lácteos
  { accent: "#e57373", Icon: Beef }, // carne
];

function PepperRow() {
  return (
    <View className="mb-5 flex-row items-center justify-between px-1">
      {PEPPERS.map(({ accent, Icon }, i) => (
        <View
          key={i}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: mix(SURFACE, accent, 0.2) }}
        >
          <Icon size={18} color={mix(FOREGROUND, accent, 0.45)} />
        </View>
      ))}
    </View>
  );
}

/**
 * Entrada a la app. Una sola pantalla con dos estados, como el artboard 3a del
 * rediseño: primero la portada (marca, claim y un botón), y al pulsar "Empezar"
 * / "ya tengo cuenta" se despliega el formulario de acceso sin cambiar de
 * pantalla. Los textos y el orden del formulario son los mismos que la ruta
 * /auth de la web para que las dos se sientan la misma app. Cuando el login
 * crea sesión, el `onAuthStateChange` de `AuthProvider` la refleja y el
 * Redirect de abajo saca de aquí: no se navega a mano tras cada método.
 */
export default function Auth() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const [stage, setStage] = useState<"intro" | "access">("intro");
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const openAccess = (m: "in" | "up") => {
    setMode(m);
    setSent(false);
    setStage("access");
  };
  const backToIntro = () => {
    setSent(false);
    setMode("in");
    setStage("intro");
  };

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

  const primaryLabel =
    stage === "intro"
      ? t("auth.intro.start")
      : mode === "forgot"
        ? t("auth.sendLink")
        : mode === "up"
          ? t("auth.signUp")
          : t("auth.signIn");

  const onPrimary = () => {
    if (stage === "intro") {
      openAccess("up");
      return;
    }
    if (mode === "forgot") void forgotPassword();
    else void submit();
  };

  const disclaimer = stage === "intro" ? t("auth.intro.disclaimer") : t("auth.landing.disclaimer");

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow px-5 pb-8 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* Cabecera: marca + (en acceso) botón atrás. La marca encoge al
              pasar al formulario, como en el artboard 3a. */}
          <View className="flex-row items-start justify-between">
            {stage === "intro" ? (
              <View className="pt-2">
                <Image
                  source={require("../assets/splash-icon.png")}
                  style={{ width: 104, height: 104, marginLeft: -8 }}
                  resizeMode="contain"
                />
                <Text className="-mt-1 text-xl font-heading text-foreground">Peppers</Text>
              </View>
            ) : (
              <View className="flex-row items-center gap-2.5 pt-1">
                <Image
                  source={require("../assets/splash-icon.png")}
                  style={{ width: 40, height: 40 }}
                  resizeMode="contain"
                />
                <Text className="text-base font-heading text-foreground">Peppers</Text>
              </View>
            )}

            <View className="flex-row items-center gap-2 pt-1">
              {stage === "access" && (
                <Pressable
                  onPress={backToIntro}
                  className="rounded-full bg-surface px-3.5 py-2 active:opacity-80"
                >
                  <Text className="text-xs font-body-medium text-muted-foreground">
                    {t("auth.back")}
                  </Text>
                </Pressable>
              )}
              {stage === "intro" && (
                <View className="flex-row gap-1 rounded-full bg-secondary p-0.5">
                  {SUPPORTED_LOCALES.map((l) => (
                    <Pressable
                      key={l}
                      onPress={() => void setLocale(l)}
                      className={`rounded-full px-2 py-1 ${l === locale ? "bg-foreground" : ""}`}
                    >
                      <Text
                        className={`text-[11px] font-body-medium uppercase ${l === locale ? "text-background" : "text-muted-foreground"}`}
                      >
                        {l}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Cuerpo */}
          {stage === "intro" ? (
            <View className="mt-6">
              <Text className="text-[36px] font-heading leading-[1.02] tracking-[-0.03em] text-foreground">
                {t("auth.intro.title")}
              </Text>
              <Text className="mt-3.5 max-w-[300px] text-[13.5px] font-body leading-[1.55] text-muted-foreground">
                {t("auth.intro.body")}
              </Text>
            </View>
          ) : (
            <View className="mt-6">
              <Text className="text-[26px] font-heading leading-[1.05] tracking-[-0.03em] text-foreground">
                {mode === "in"
                  ? t("auth.titleIn")
                  : mode === "up"
                    ? t("auth.titleUp")
                    : t("auth.titleForgot")}
              </Text>
              <Text className="mt-2 max-w-[300px] text-[13px] font-body leading-[1.5] text-muted-foreground">
                {mode === "in"
                  ? t("auth.subtitleIn")
                  : mode === "up"
                    ? t("auth.subtitleUp")
                    : t("auth.subtitleForgot")}
              </Text>

              {sent ? (
                <View className="mt-5 gap-2.5">
                  <View className="rounded-3xl bg-primary-soft px-4 py-4">
                    <Text className="text-sm font-body text-foreground">
                      {mode === "forgot" ? t("auth.sentReset") : t("auth.sentConfirm")}
                    </Text>
                  </View>
                  <Pressable onPress={backToIntro} className="w-full py-2">
                    <Text className="text-center text-xs font-body text-muted-foreground">
                      {t("auth.backToSignIn")}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View className="mt-5 gap-2.5">
                  <TextInput
                    className="h-[52px] w-full rounded-full bg-muted px-5 text-sm font-body text-foreground"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t("auth.emailPlaceholder")}
                    placeholderTextColor="#a8a093"
                  />
                  {mode !== "forgot" && (
                    <TextInput
                      className="h-[52px] w-full rounded-full bg-muted px-5 text-sm font-body text-foreground"
                      secureTextEntry
                      autoCapitalize="none"
                      autoComplete={mode === "in" ? "current-password" : "new-password"}
                      value={password}
                      onChangeText={setPassword}
                      placeholder={t("auth.passwordPlaceholder")}
                      placeholderTextColor="#a8a093"
                    />
                  )}

                  {mode === "in" && (
                    <Pressable onPress={() => setMode("forgot")} className="w-full py-1">
                      <Text className="text-right text-xs font-body text-muted-foreground">
                        {t("auth.forgotLink")}
                      </Text>
                    </Pressable>
                  )}

                  {mode !== "forgot" && (
                    <>
                      <View className="my-1 flex-row items-center gap-3">
                        <View className="h-px flex-1 bg-border" />
                        <Text className="text-xs font-body text-muted-foreground">
                          {t("auth.or")}
                        </Text>
                        <View className="h-px flex-1 bg-border" />
                      </View>

                      <Pressable
                        onPress={google}
                        disabled={googleLoading}
                        className="w-full flex-row items-center justify-center rounded-full bg-surface py-3.5 active:opacity-90 disabled:opacity-60"
                      >
                        {googleLoading ? (
                          <ActivityIndicator color="#83796c" />
                        ) : (
                          <Text className="text-sm font-body-medium text-foreground">
                            {t("auth.google")}
                          </Text>
                        )}
                      </Pressable>

                      <Pressable
                        onPress={demo}
                        disabled={demoLoading}
                        className="w-full items-center py-2.5 active:opacity-80 disabled:opacity-60"
                      >
                        <Text className="text-xs font-body-medium text-muted-foreground">
                          {demoLoading ? t("auth.demoCreating") : t("auth.tryNoAccount")}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}
            </View>
          )}

          <View className="flex-grow" />

          <PepperRow />

          <Pressable
            onPress={onPrimary}
            disabled={loading}
            className="w-full flex-row items-center justify-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
          >
            {loading ? (
              <ActivityIndicator color="#fbfaf7" />
            ) : (
              <Text className="text-sm font-body-semibold text-primary-foreground">
                {primaryLabel}
              </Text>
            )}
          </Pressable>

          {stage === "intro" && (
            <Pressable onPress={() => openAccess("in")} className="w-full py-2.5 active:opacity-80">
              <Text className="text-center text-xs font-body-medium text-muted-foreground">
                {t("auth.intro.haveAccount")}
              </Text>
            </Pressable>
          )}

          {stage === "access" && !sent && (
            <Pressable
              onPress={() => setMode(mode === "in" ? "up" : mode === "up" ? "in" : "in")}
              className="w-full py-2.5 active:opacity-80"
            >
              <Text className="text-center text-xs font-body text-muted-foreground">
                {mode === "in" ? t("auth.toSignUp") : t("auth.toSignIn")}
              </Text>
            </Pressable>
          )}

          <Text className="mt-3 text-center text-[11px] font-body leading-[1.45] text-muted-foreground">
            {disclaimer}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
