import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { type FlatNode, SCREENS, screenSubtitleKey, screenTitleKey } from "@/lib/onboarding-script";

import { OverlayHeader, Shell } from "./shell";

type Props = {
  flat: FlatNode[];
  answers: Record<string, string>;
  /** Índice de la etapa en la que está la persona. */
  currentStage: number;
  onClose: () => void;
  onGoTo: (key: string) => void;
  onSummary: () => void;
};

/** Índice de las etapas: cuánto lleva cada una y salto a su primera pregunta. */
export function StageIndex({ flat, answers, currentStage, onClose, onGoTo, onSummary }: Props) {
  const { t } = useTranslation();
  return (
    <Shell>
      <OverlayHeader
        eyebrow={t("onboarding.index.eyebrow")}
        title={t("onboarding.index.title")}
        closeLabel={t("onboarding.chat.close")}
        onClose={onClose}
      />
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
        {t("onboarding.index.body")}
      </p>
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {SCREENS.map((s, si) => {
          const nodes = flat.filter((n) => n.si === si);
          const doneN = nodes.filter((n) => answers[n.key] !== undefined).length;
          const complete = doneN === nodes.length;
          const isCur = si === currentStage;
          const first = nodes[0];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => first && onGoTo(first.key)}
              className="flex w-full items-center gap-3.5 rounded-2xl bg-surface p-4 text-left transition-transform active:scale-[0.99]"
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-num text-xs ${
                  complete
                    ? "bg-success text-success-foreground"
                    : isCur
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {complete ? <Check className="h-4 w-4" strokeWidth={2.6} /> : si + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold tracking-tight">
                  {t(screenTitleKey(s))}
                </span>
                <span className="font-num text-[10.5px] text-muted-foreground">
                  {t(screenSubtitleKey(s)).toLowerCase()} · {doneN}/{nodes.length}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSummary}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
      >
        {t("onboarding.index.seeSummary")} <ArrowRight className="h-4 w-4" />
      </button>
    </Shell>
  );
}
