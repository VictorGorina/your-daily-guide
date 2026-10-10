import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Portada del onboarding: cuántas preguntas son y el botón de empezar. */
export function IntroStep({ total, onStart }: { total: number; onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex h-[100dvh] max-w-lg flex-col items-center justify-center px-6">
      <div className="w-full space-y-6 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary-ink" aria-hidden />
        <h1 className="font-title text-2xl font-semibold tracking-tight text-foreground">
          {t("onboarding.intro.title")}
        </h1>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
          {t("onboarding.intro.body", { count: total })}
        </p>
        <button
          type="button"
          onClick={onStart}
          className="mx-auto flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          {t("onboarding.intro.start")} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </main>
  );
}
