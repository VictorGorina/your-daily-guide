import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Shell } from "./shell";

type Props = {
  answeredCount: number;
  total: number;
  onContinue: () => void;
  onReview: () => void;
};

/** "Guardar y salir": confirma que el progreso queda guardado. */
export function SavedPanel({ answeredCount, total, onContinue, onReview }: Props) {
  const { t } = useTranslation();
  return (
    <Shell>
      <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
        <span className="relative grid h-24 w-24 place-items-center">
          <span className="animate-coach-pulse absolute h-24 w-24 rounded-full bg-primary/12" />
          <span className="relative grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary-ink">
            <Check className="h-6 w-6" strokeWidth={2.6} />
          </span>
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t("onboarding.saved.title")}
        </h1>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          {t("onboarding.saved.body", { done: answeredCount, total })}
        </p>
        <div className="flex w-full max-w-xs flex-col gap-2.5">
          <button
            type="button"
            onClick={onContinue}
            className="rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {t("onboarding.saved.continue")}
          </button>
          <button
            type="button"
            onClick={onReview}
            className="rounded-full bg-surface py-4 text-sm font-semibold text-muted-foreground transition-transform active:scale-[0.98]"
          >
            {t("onboarding.saved.review")}
          </button>
        </div>
      </div>
    </Shell>
  );
}
