import { useQueryClient } from "@tanstack/react-query";
import { makeRedirectUri } from "expo-auth-session";
import * as Linking from "expo-linking";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Bean, Beef, Carrot, Drumstick, Fish, Milk, Wheat } from "lucide-react-native";
import { useEffect, useState } from "react";
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

import { openPrivacyPolicy } from "../components/health-consent";
import { useTurnstile } from "../components/turnstile";
import { apiPostPublic } from "../lib/api";
import { authErrorText, isEmailNotConfirmed, passwordProblem } from "../lib/auth-errors";
import { useAuth } from "../lib/auth-context";
import { saveProfile } from "../lib/daily";
import { randomDemoProfile } from "../lib/demo-profile";
import { ENGLISH_ENABLED, offeredLocales } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { useLocale } from "../lib/use-locale";

// Cierra la pestaña de auth que quedara abierta de un intento anterior.
WebBrowser.maybeCompleteAuthSession();

// Google solo se enseña si está activado en Supabase (Authentication →
// Providers → Google) y se pide aquí con EXPO_PUBLIC_AUTH_GOOGLE=1: sin
// proveedor, el botón solo daba un error (NUEVO-08, decisión P13).
const GOOGLE_AUTH = process.env.EXPO_PUBLIC_AUTH_GOOGLE === "1";

// A dónde vuelve Google/Supabase tras autenticar. Con el scheme "dailyguide"
// del app.json, esto es dailyguide://. Debe estar dado de alta en el dashboard
// de Supabase (Authentication → URL Configuration → Redirect URLs).
const redirectTo = makeRedirectUri({ scheme: "dailyguide" });

/**
 * Lo que hay que esperar para volver a pedir un correo. El servidor descarta
 * otro envío al mismo correo antes de un minuto (`createSendThrottle` en
 * src/lib/auth.server.ts de la web) y responde `ok` igualmente, para no delatar
 * qué correos tienen cuenta: sin esta espera, "Volver a enviar" diría que lo ha
 * reenviado sin que saliera nada. Copia de src/components/auth-flow.tsx.
 */
const RESEND_WAIT_SECONDS = 60;

function useResendWait() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    // Se cuenta desde la respuesta, que llega después de que el servidor
    // apunte el envío: el botón nunca se desbloquea antes que su freno. Con la
    // app en segundo plano el contador se para, que solo alarga la espera.
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  return { seconds, start: () => setSeconds(RESEND_WAIT_SECONDS) };
}

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
  // CAPTCHA (ticket 29): un token nuevo antes de cada llamada de Auth.
  const captcha = useTurnstile();
  const [stage, setStage] = useState<"intro" | "access">("intro");
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const qc = useQueryClient();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // La cuenta existe pero nadie abrió el correo de confirmación. Es el único
  // error de acceso con salida dentro de la app, así que se guarda aparte para
  // poder ofrecer el reenvío en vez de dejar a la persona en un callejón.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const resendWait = useResendWait();

  const openAccess = (m: "in" | "up") => {
    setMode(m);
    setSent(false);
    setNeedsConfirm(false);
    setStage("access");
  };
  const backToIntro = () => {
    setSent(false);
    setNeedsConfirm(false);
    setMode("in");
    setStage("intro");
  };
  // A diferencia de backToIntro: se queda en la pantalla de acceso, no salta a
  // la portada. Es lo que usa "Volver a entrar" tras enviar un correo, igual
  // que en la web; antes obligaba a pulsar otra vez "Ya tengo cuenta".
  const backToSignInForm = () => {
    setSent(false);
    setNeedsConfirm(false);
    setMode("in");
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
        const { error } = await supabase.auth.signInAnonymously({
          options: { captchaToken: await captcha.getToken() },
        });
        if (error) throw error;
      }
      await saveProfile(randomDemoProfile());
      // La raíz (`useLocale`) ya pidió el perfil al aparecer la sesión, todavía
      // vacío: sin esto Hoy lee esa copia y rebota al onboarding.
      await qc.invalidateQueries({ queryKey: ["profile"] });
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
  const sendResetLink = async () =>
    apiPostPublic("auth/reset", {
      email: email.trim(),
      platform: "mobile",
      captchaToken: await captcha.getToken(),
    });

  const forgotPassword = async () => {
    if (!email.trim().includes("@")) {
      Alert.alert(t("auth.errNeedEmail"));
      return;
    }

    setLoading(true);
    try {
      await sendResetLink();
      setSent(true);
      resendWait.start();
    } catch (error) {
      Alert.alert(
        t("auth.errSendLink"),
        error instanceof Error ? error.message : t("common.retry"),
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * Manda (o reenvía) el correo de confirmación. Es la misma operación en los
   * dos casos, y la hace nuestro backend con la plantilla de la casa en vez del
   * SMTP de Supabase — que es por lo que el correo del alta acababa en spam.
   * Ver requestSignupConfirmation en src/lib/auth.functions.ts de la web.
   */
  const sendConfirmation = async () =>
    apiPostPublic("auth/confirm", {
      email: email.trim(),
      password,
      platform: "mobile",
      captchaToken: await captcha.getToken(),
    });

  const resendConfirmation = async () => {
    setLoading(true);
    try {
      await sendConfirmation();
      Alert.alert(t("auth.resendSent"));
    } catch (error) {
      Alert.alert(t("auth.errSendLink"), authErrorText(error, t, "common.retry"));
    } finally {
      setLoading(false);
    }
  };

  /** "Volver a enviar" de la pantalla de "mira tu buzón": el mismo correo otra vez. */
  const resendSentEmail = async () => {
    if (resendWait.seconds > 0) return;
    setLoading(true);
    try {
      await (mode === "forgot" ? sendResetLink() : sendConfirmation());
      resendWait.start();
      Alert.alert(t("auth.resendSent"));
    } catch (error) {
      Alert.alert(t("auth.errSendLink"), authErrorText(error, t, "common.retry"));
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      Alert.alert(t("auth.errNeedCreds"));
      return;
    }
    // Al crear la cuenta, las mismas reglas que Supabase (entrar no las mira:
    // una cuenta antigua puede tener otra contraseña).
    if (mode === "up" && passwordProblem(password)) {
      Alert.alert(t("auth.errWeakPassword"));
      return;
    }

    setLoading(true);
    setNeedsConfirm(false);
    try {
      if (mode === "up") {
        await sendConfirmation();
        // Siempre "mira tu buzón", exista ya la cuenta o no: el servidor
        // responde igual en los dos casos a propósito, para no convertir el
        // alta en un buscador de quién está registrado.
        setSent(true);
        resendWait.start();
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken: await captcha.getToken() },
      });
      if (error) throw error;
    } catch (error) {
      // Nada de `error.message` crudo: Supabase lo manda en inglés y a veces sin
      // relación con lo que la persona acaba de hacer ("Email not confirmed"
      // tras escribir la contraseña). Ver lib/auth-errors.ts.
      if (isEmailNotConfirmed(error)) setNeedsConfirm(true);
      Alert.alert(t("auth.errSignIn"), authErrorText(error, t, "common.retry"));
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

  const resendLabel = mode === "forgot" ? t("auth.resendLink") : t("auth.resendEmail");
  const primaryLabel =
    stage === "intro"
      ? t("auth.intro.start")
      : sent
        ? resendWait.seconds > 0
          ? t("auth.resendWait", { label: resendLabel, seconds: resendWait.seconds })
          : resendLabel
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
    if (sent) void resendSentEmail();
    else if (mode === "forgot") void forgotPassword();
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
          <View className="min-h-9 flex-row items-start justify-between">
            {stage === "access" ? (
              <View className="flex-row items-center gap-2.5 pt-1">
                <Image
                  source={require("../assets/splash-icon.png")}
                  style={{ width: 40, height: 40 }}
                  resizeMode="contain"
                />
                <Text className="text-base font-heading text-foreground">Peppers</Text>
              </View>
            ) : (
              <View />
            )}

            <View className="flex-row items-center gap-2 pt-1">
              {stage === "access" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={backToIntro}
                  className="rounded-full bg-surface px-3.5 py-2 active:opacity-80"
                >
                  <Text className="text-xs font-body-medium text-muted-foreground">
                    {t("auth.back")}
                  </Text>
                </Pressable>
              )}
              {/* B0 del ticket 34: con un solo idioma ofrecido no hay nada que elegir. */}
              {stage === "intro" && offeredLocales(ENGLISH_ENABLED, locale).length > 1 && (
                <View className="flex-row gap-1 rounded-full bg-secondary p-0.5">
                  {offeredLocales(ENGLISH_ENABLED, locale).map((l) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: l === locale }}
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

          {stage === "intro" && (
            <View className="mt-2 items-center self-start">
              {/* El PNG lleva aire alrededor de los pimientos; el contenedor
                  recortado y el margen negativo pegan la palabra al dibujo. El
                  bloque va a la izquierda, con la palabra centrada bajo el logo. */}
              <View style={{ height: 84, width: 104, overflow: "hidden", alignItems: "center" }}>
                <Image
                  source={require("../assets/splash-icon.png")}
                  style={{ width: 104, height: 104 }}
                  resizeMode="contain"
                />
              </View>
              <Text className="-mt-1 text-xl font-heading text-foreground">Peppers</Text>
            </View>
          )}

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
                  <Pressable
                    accessibilityRole="button"
                    onPress={backToSignInForm}
                    className="w-full py-2"
                  >
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
                    onChangeText={(v) => {
                      setEmail(v);
                      setNeedsConfirm(false);
                    }}
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

                  {/* Salida del callejón sin salida: la cuenta existe pero nadie
                      abrió el correo. Antes solo salía "Email not confirmed" y
                      no había forma de pedir otro desde la app. */}
                  {mode === "in" && needsConfirm && (
                    <View className="rounded-3xl bg-primary-soft px-4 py-3.5">
                      <Text className="text-[13px] font-body leading-[1.5] text-foreground">
                        {t("auth.errEmailNotConfirmed")}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={resendConfirmation}
                        disabled={loading}
                        className="mt-2.5 w-full items-center rounded-full bg-surface py-2.5 active:opacity-90 disabled:opacity-60"
                      >
                        <Text className="text-xs font-body-medium text-foreground">
                          {loading ? t("auth.sending") : t("auth.resendConfirm")}
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {mode === "in" && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setMode("forgot")}
                      className="w-full py-1"
                    >
                      <Text className="text-right text-xs font-body text-muted-foreground">
                        {t("auth.forgotLink")}
                      </Text>
                    </Pressable>
                  )}

                  {mode !== "forgot" && (
                    <>
                      {GOOGLE_AUTH && (
                        <>
                          <View className="my-1 flex-row items-center gap-3">
                            <View className="h-px flex-1 bg-border" />
                            <Text className="text-xs font-body text-muted-foreground">
                              {t("auth.or")}
                            </Text>
                            <View className="h-px flex-1 bg-border" />
                          </View>

                          <Pressable
                            accessibilityRole="button"
                            onPress={google}
                            disabled={googleLoading}
                            className="w-full flex-row items-center justify-center rounded-full bg-surface py-3.5 active:opacity-90 disabled:opacity-60"
                          >
                            {googleLoading ? (
                              <ActivityIndicator color="#6b6256" />
                            ) : (
                              <Text className="text-sm font-body-medium text-foreground">
                                {t("auth.google")}
                              </Text>
                            )}
                          </Pressable>
                        </>
                      )}

                      <Pressable
                        accessibilityRole="button"
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

          {captcha.slot}

          {/* Tras enviar un correo pasa a ser "Volver a enviar …", bloqueado
              mientras corre la espera del servidor (`useResendWait`): antes
              seguía diciendo "Enviar enlace" bajo el "te hemos enviado". */}
          <Pressable
            accessibilityRole="button"
            onPress={onPrimary}
            disabled={loading || (sent && resendWait.seconds > 0)}
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
            <Pressable
              accessibilityRole="button"
              onPress={() => openAccess("in")}
              className="w-full py-2.5 active:opacity-80"
            >
              <Text className="text-center text-xs font-body-medium text-muted-foreground">
                {t("auth.intro.haveAccount")}
              </Text>
            </Pressable>
          )}

          {stage === "access" && !sent && (
            <Pressable
              accessibilityRole="button"
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
          <Pressable
            accessibilityRole="link"
            onPress={() => void openPrivacyPolicy()}
            hitSlop={8}
            className="mt-2 self-center active:opacity-70"
          >
            <Text className="text-[11px] font-body-medium text-muted-foreground underline">
              {t("auth.privacy")}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
