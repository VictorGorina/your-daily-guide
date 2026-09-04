import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { requestPasswordReset } from "@/lib/auth.functions";
import { saveProfile } from "@/lib/daily";
import { randomDemoProfile } from "@/lib/demo-profile";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { safeInternalPath } from "@/lib/safe-next";
import { useLocale } from "@/lib/use-locale";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: safeInternalPath(search.next as string | undefined),
  }),
  head: () => ({
    meta: [
      { title: "Entrar en Peppers" },
      { name: "description", content: "Accede a tu asistente de alimentación con IA." },
      { property: "og:title", content: "Entrar en Peppers" },
      { property: "og:description", content: "Accede a tu asistente de alimentación con IA." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const { next } = Route.useSearch();
  const goNext = () => {
    if (next) {
      window.location.replace(next);
      return true;
    }
    return false;
  };

  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        if (!goNext()) navigate({ to: "/hoy", replace: true });
      }
    });
    // Same race as on "/": a confirmation/magic-link redirect's URL tokens are
    // parsed asynchronously, so getSession() above can run before that finishes.
    // Catch the SIGNED_IN event it fires once the session is actually ready.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        if (!goNext()) navigate({ to: "/hoy", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, next]);

  const forgotPassword = async () => {
    if (!email.trim().includes("@")) {
      toast.error(t("auth.errNeedEmail"));
      return;
    }
    setLoading(true);
    try {
      // El correo lo manda nuestro backend, no el SMTP de Supabase Auth: así el
      // motivo de un fallo de envío queda en nuestros logs en vez de perderse en
      // un `unexpected_failure` genérico, y la plantilla es nuestra. La URL de
      // destino la decide el servidor a partir de `platform` — ver
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
    // estar habilitado en el dashboard de Supabase del proyecto: Authentication
    // → Providers → Google). Al volver, el listener SIGNED_IN de arriba lleva
    // a la persona a donde tocaba.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: next ? `${window.location.origin}${next}` : window.location.origin,
      },
    });
    if (error) toast.error(t("auth.errGoogle"));
  };

  const field =
    "h-12 w-full rounded-2xl bg-muted px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-14">
      <div className="animate-rise">
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-title text-4xl font-semibold tracking-[-0.03em]">
            {mode === "in"
              ? t("auth.titleIn")
              : mode === "up"
                ? t("auth.titleUp")
                : t("auth.titleForgot")}
          </h1>
          <div className="mt-1 flex shrink-0 gap-1 rounded-full bg-secondary p-0.5 text-[11px] font-medium">
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
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "in"
            ? t("auth.subtitleIn")
            : mode === "up"
              ? t("auth.subtitleUp")
              : t("auth.subtitleForgot")}
        </p>

        {sent ? (
          <div className="mt-8 space-y-3">
            <div className="rounded-2xl bg-primary-soft px-4 py-4 text-sm">
              {mode === "forgot" ? t("auth.sentReset") : t("auth.sentConfirm")}
            </div>
            {mode === "forgot" && (
              <button
                onClick={() => {
                  setSent(false);
                  setMode("in");
                }}
                className="w-full py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("auth.backToSignIn")}
              </button>
            )}
          </div>
        ) : mode === "forgot" ? (
          <div className="mt-8 space-y-3">
            <input
              className={field}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
            />
            <button
              onClick={forgotPassword}
              disabled={loading}
              className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? t("auth.sending") : t("auth.sendLink")}
            </button>
            <button
              onClick={() => setMode("in")}
              className="w-full py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("auth.rememberLink")}
            </button>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            <input
              className={field}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
            />
            <input
              className={field}
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
            />
            {mode === "in" && (
              <button
                onClick={() => setMode("forgot")}
                className="w-full text-right text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("auth.forgotLink")}
              </button>
            )}
            <button
              onClick={submit}
              disabled={loading}
              className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? t("auth.working") : mode === "in" ? t("auth.signIn") : t("auth.signUp")}
            </button>
            <button
              onClick={() => setMode(mode === "in" ? "up" : "in")}
              className="w-full py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {mode === "in" ? t("auth.toSignUp") : t("auth.toSignIn")}
            </button>
          </div>
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> {t("auth.or")}{" "}
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={google}
          className="w-full rounded-full bg-surface py-4 text-sm font-medium text-foreground transition-transform active:scale-[0.98]"
        >
          {t("auth.google")}
        </button>

        <button
          onClick={demo}
          disabled={demoLoading}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-3.5 text-sm font-medium text-muted-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          <Shuffle className="h-4 w-4" />
          {demoLoading ? t("auth.demoCreating") : t("auth.demo")}
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">{t("auth.accountNote")}</p>
      </div>
    </main>
  );
}
