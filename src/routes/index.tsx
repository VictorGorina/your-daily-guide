import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { HeartPulse, Sparkle, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { useLocale } from "@/lib/use-locale";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Peppers — Tu asistente de alimentación con IA" },
      {
        name: "description",
        content:
          "Come mejor cada día, sin complicaciones: guía matutina, repaso nocturno y un objetivo medible con progreso visual. Sin dietas rígidas.",
      },
      { property: "og:title", content: "Peppers — Tu asistente de alimentación con IA" },
      {
        property: "og:description",
        content: "Hábitos, no restricciones. Un asistente que te acompaña cada día.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/hoy", replace: true });
    });
    // The confirmation link's tokens (in the URL hash) are parsed asynchronously
    // by supabase-js. Listening for SIGNED_IN too, not just the getSession()
    // check above, makes sure clicking "confirm email" reliably lands the user
    // in the app even if that parsing is still in flight on mount.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/hoy", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-between px-6 pb-10 pt-16">
      <div className="animate-rise">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
            <Sparkle className="h-3.5 w-3.5" /> {t("auth.landing.badge")}
          </span>
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
        </div>
        <h1 className="mt-6 font-display text-5xl leading-[1.05] text-foreground">
          <span className="text-gradient-primary">Peppers</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {t("auth.landing.tagline")}
        </p>

        <ul className="mt-10 space-y-3">
          {[
            { icon: HeartPulse, text: t("auth.landing.bullet1") },
            { icon: TrendingUp, text: t("auth.landing.bullet2") },
            { icon: Sparkle, text: t("auth.landing.bullet3") },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="surface-card flex items-center gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-sm text-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12 space-y-3">
        <Link
          to="/auth"
          className="flex h-13 w-full items-center justify-center rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          {t("auth.landing.cta")}
        </Link>
        <p className="text-center text-xs text-muted-foreground">{t("auth.landing.disclaimer")}</p>
      </div>
    </main>
  );
}
