import { useNavigate } from "@tanstack/react-router";
import { Bean, Beef, Carrot, Drumstick, Fish, Milk, Wheat } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { requestPasswordReset } from "@/lib/auth.functions";
import { saveProfile } from "@/lib/daily";
import { randomDemoProfile } from "@/lib/demo-profile";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { useLocale } from "@/lib/use-locale";

type Stage = "intro" | "access";
type Mode = "in" | "up" | "forgot";

/**
 * Fila de pimientos del artboard 3a ("Rediseño Peppers nutrición"): siete
 * círculos, uno por familia de alimento, con el icono Lucide de categoría — la
 * misma familia que `DishCategoryIcon` (food-category-bg.tsx) y los encabezados
 * de la subpestaña Ingredientes. El tinte del círculo y el color del icono
 * salen de `color-mix` sobre los tokens del tema, así siguen el tema activo.
 */
const PEPPERS: { accent: string; Icon: typeof Carrot }[] = [
  { accent: "#6DBE7B", Icon: Carrot }, // verduras
  { accent: "#4C9BD6", Icon: Fish }, // pescado
  { accent: "#9A7655", Icon: Bean }, // legumbres
  { accent: "#D7B58A", Icon: Wheat }, // cereales
  { accent: "#F2C14E", Icon: Drumstick }, // aves
  { accent: "#F5E6C8", Icon: Milk }, // lácteos
  { accent: "#E57373", Icon: Beef }, // carne
];

function PepperRow() {
  return (
    <div className="mb-6 flex items-center justify-between px-1">
      {PEPPERS.map(({ accent, Icon }, i) => (
        <span
          key={i}
          className="grid h-[34px] w-[34px] place-items-center rounded-full"
          style={{ background: `color-mix(in oklab, ${accent} 20%, var(--color-surface))` }}
        >
          <Icon
            size={18}
            aria-hidden
            style={{ color: `color-mix(in oklab, ${accent} 45%, var(--color-foreground))` }}
          />
        </span>
      ))}
    </div>
  );
}

function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex shrink-0 gap-1 rounded-full bg-secondary p-0.5 text-[11px] font-medium">
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => void setLocale(l)}
          aria-pressed={locale === l}
          className={`rounded-full px-2 py-1 uppercase transition-colors ${
            locale === l
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Pantalla de entrada — portada y acceso en una sola pantalla, como el artboard
 * 3a del rediseño. `/` la monta en el estado `intro`; `/auth` (enlazada desde
 * los correos, conserva `?next=`) la monta directamente en `access`. Toda la
 * lógica de autenticación (correo/contraseña, alta con confirmación, Google,
 * restablecer contraseña y perfil de prueba) es la misma que tenía `/auth`.
 */
export function AuthFlow({ initialStage, next }: { initialStage: Stage; next?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [stage, setStage] = useState<Stage>(initialStage);
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const goNext = () => {
    if (next) {
      window.location.replace(next);
      return true;
    }
    return false;
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !goNext()) navigate({ to: "/hoy", replace: true });
    });
    // El enlace de confirmación trae los tokens en el hash y supabase-js los
    // procesa de forma asíncrona: escuchamos también SIGNED_IN para que pulsar
    // "confirmar correo" acabe siempre dentro de la app aunque ese procesado
    // todavía esté en curso al montar.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session && !goNext()) {
        navigate({ to: "/hoy", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, next]);

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

  const forgotPassword = async () => {
    if (!email.trim().includes("@")) {
      toast.error(t("auth.errNeedEmail"));
      return;
    }
    setLoading(true);
    try {
      // El correo lo manda nuestro backend, no el SMTP de Supabase Auth: así el
      // motivo de un fallo de envío queda en nuestros logs y la plantilla es
      // nuestra. La URL de destino la decide el servidor según `platform` — ver
      // requestPasswordReset en src/lib/auth.functions.ts.
      await requestPasswordReset({ data: { email: email.trim(), platform: "web" } });
      setSent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("auth.errSendLink"));
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      toast.error(t("auth.errNeedCreds"));
      return;
    }
    setLoading(true);
    try {
      if (mode === "up") {
        // El enlace del correo debe apuntar a una URL pública y estable, no a
        // localhost ni al esquema de la app nativa (un correo se abre en otro
        // sitio). En producción el origin ya es peppersfam.es; en local cae a
        // localhost. Esa URL + /confirmado tiene que estar en la allowlist de
        // Redirect URLs del panel de Supabase.
        const base = window.location.origin;
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${base}/confirmado${next ? `?next=${encodeURIComponent(next)}` : ""}`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setSent(true);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      if (!goNext()) navigate({ to: "/hoy", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("auth.errSignIn"));
    } finally {
      setLoading(false);
    }
  };

  const demo = async () => {
    setDemoLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      await saveProfile(randomDemoProfile());
      toast.success(t("auth.demoOk"));
      navigate({ to: "/hoy", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("auth.errDemo"));
    } finally {
      setDemoLoading(false);
    }
  };

  const google = async () => {
    // Redirige el navegador a Google vía el proveedor OAuth de Supabase (debe
    // estar habilitado en Authentication → Providers → Google). Al volver, el
    // listener SIGNED_IN de arriba lleva a la persona a donde tocaba.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: next ? `${window.location.origin}${next}` : window.location.origin,
      },
    });
    if (error) toast.error(t("auth.errGoogle"));
  };

  const field =
    "h-13 w-full rounded-full bg-muted px-5 text-sm text-foreground caret-primary outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/40";

  const primaryLabel =
    stage === "intro"
      ? t("auth.intro.start")
      : loading
        ? mode === "forgot"
          ? t("auth.sending")
          : t("auth.working")
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

  return (
    <main className="mx-auto flex min-h-screen max-w-[26rem] flex-col px-5 pb-8 pt-6 font-ui">
      {/* Cabecera: en acceso, marca pequeña a la izquierda + botón atrás; en la
          portada solo el conmutador de idioma (la marca va centrada, debajo). */}
      <div className="flex min-h-9 items-start justify-between gap-2">
        {stage === "access" ? (
          <div className="flex flex-row items-center gap-2.5">
            <img src="/logo-icon.svg" alt="" className="h-10 w-10" />
            <span className="font-title text-base font-semibold tracking-[-0.02em]">Peppers</span>
          </div>
        ) : (
          <span aria-hidden />
        )}
        <div className="flex shrink-0 items-center gap-2">
          {stage === "access" && (
            <button
              type="button"
              onClick={backToIntro}
              className="rounded-full bg-surface px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
            >
              {t("auth.back")}
            </button>
          )}
          {stage === "intro" && <LocaleSwitch />}
        </div>
      </div>

      {stage === "intro" && (
        <div className="mt-2 flex w-fit flex-col items-center">
          {/* El SVG lleva bastante aire por debajo de los pimientos; se recorta
              con un contenedor de altura fija para pegar la palabra al dibujo.
              El bloque va a la izquierda, con la palabra centrada bajo el logo. */}
          <span className="block h-20 w-24 overflow-hidden">
            <img src="/logo-icon.svg" alt="" className="h-24 w-24" />
          </span>
          <span className="font-title text-xl font-semibold tracking-[-0.02em]">Peppers</span>
        </div>
      )}

      {/* Cuerpo */}
      {stage === "intro" ? (
        <div className="animate-rise">
          <h1 className="mt-6 font-title text-4xl font-semibold leading-[1.02] tracking-[-0.03em] text-pretty">
            {t("auth.intro.title")
              .split("\n")
              .map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
          </h1>
          <p className="mt-3.5 max-w-[19rem] text-[13.5px] leading-[1.55] text-muted-foreground text-pretty">
            {t("auth.intro.body")}
          </p>
        </div>
      ) : (
        <div className="animate-rise">
          <h1 className="mt-6 font-title text-[26px] font-semibold leading-[1.05] tracking-[-0.03em]">
            {mode === "in"
              ? t("auth.titleIn")
              : mode === "up"
                ? t("auth.titleUp")
                : t("auth.titleForgot")}
          </h1>
          <p className="mt-2 max-w-[19rem] text-[13px] leading-[1.5] text-muted-foreground">
            {mode === "in"
              ? t("auth.subtitleIn")
              : mode === "up"
                ? t("auth.subtitleUp")
                : t("auth.subtitleForgot")}
          </p>

          {sent ? (
            <div className="mt-5 space-y-2.5">
              <div className="rounded-3xl bg-primary-soft px-4 py-4 text-sm">
                {mode === "forgot" ? t("auth.sentReset") : t("auth.sentConfirm")}
              </div>
              <button
                type="button"
                onClick={backToIntro}
                className="w-full py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("auth.backToSignIn")}
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-2.5">
              <input
                className={field}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.emailPlaceholder")}
              />
              {mode !== "forgot" && (
                <input
                  className={field}
                  type="password"
                  autoComplete={mode === "in" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                />
              )}
              {mode === "in" && (
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="w-full text-right text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  {t("auth.forgotLink")}
                </button>
              )}

              {mode !== "forgot" && (
                <>
                  <div className="my-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> {t("auth.or")}{" "}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <button
                    type="button"
                    onClick={google}
                    className="w-full rounded-full bg-surface py-3.5 text-sm font-medium text-foreground transition-transform active:scale-[0.98]"
                  >
                    {t("auth.google")}
                  </button>
                  <button
                    type="button"
                    onClick={demo}
                    disabled={demoLoading}
                    className="w-full py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {demoLoading ? t("auth.demoCreating") : t("auth.tryNoAccount")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      <PepperRow />

      <button
        type="button"
        onClick={onPrimary}
        disabled={loading}
        className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
      >
        {primaryLabel}
      </button>

      {stage === "intro" && (
        <button
          type="button"
          onClick={() => openAccess("in")}
          className="mt-2.5 w-full py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("auth.intro.haveAccount")}
        </button>
      )}

      {stage === "access" && !sent && (
        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-2.5 w-full py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {mode === "in" ? t("auth.toSignUp") : t("auth.toSignIn")}
        </button>
      )}

      <p className="mt-3 text-center text-[11px] leading-[1.45] text-muted-foreground/80">
        {stage === "intro" ? t("auth.intro.disclaimer") : t("auth.landing.disclaimer")}
      </p>
    </main>
  );
}
