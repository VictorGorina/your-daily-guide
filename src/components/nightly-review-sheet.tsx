import { Moon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MealStatus, WeeklyTrend } from "@/lib/daily";

/** Frases de cierre del catálogo (`nightly.closing`): una por día, en rotación. */
const CLOSING_LINES = 6;

function closingLineIndex(date: Date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return dayOfYear % CLOSING_LINES;
}

// El coach de chat ya adapta su tono vía toneLine en ai-provider.server.ts;
// esto lleva el mismo matiz a un texto puramente local, sin llamada a IA. El
// texto de cada tono está en el catálogo (`nightly.reaction`, `nightly.trend`).
type Tone = "relajado" | "neutro" | "exigente";
const toneOf = (tone?: string | null): Tone =>
  tone === "relajado" || tone === "exigente" ? tone : "neutro";

const reactionKey = (ratio: number) => (ratio >= 1 ? "full" : ratio > 0 ? "partial" : "none");

// Tendencia semanal (en vez de fijarse solo en el cumplimiento de hoy).
// weeklyTrendFrom exige al menos 2 días registrados en cada una de las dos
// semanas, así que null es habitual al principio.
const trendKey = (trend: WeeklyTrend) =>
  trend.deltaPts >= 5 ? "up" : trend.deltaPts <= -5 ? "down" : "flat";

type Meal = { label: string; done: boolean; status?: MealStatus };

export function NightlyReviewSheet({
  open,
  onOpenChange,
  habits,
  impulso,
  weeklyTrend,
  tone,
  onDone,
  onSkipPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habits: Meal[];
  impulso: number;
  weeklyTrend: WeeklyTrend | null;
  tone?: string | null;
  onDone: () => void;
  /** Cierra en bloque, como saltadas, las comidas que se quedaron sin marcar. */
  onSkipPending?: () => void;
}) {
  const total = habits.length;
  const doneCount = habits.filter((h) => h.status === "plan").length;
  const distintoCount = habits.filter((h) => h.status === "distinto").length;
  const skippedCount = habits.filter((h) => h.status === "salteo").length;
  const pending = habits.filter((h) => h.status == null);
  const ratio = total ? habits.filter((h) => h.done).length / total : 0;
  const { t } = useTranslation();
  const toneKey = toneOf(tone);
  const trendLine = weeklyTrend
    ? t(`nightly.trend.${trendKey(weeklyTrend)}.${toneKey}`, {
        thisWeek: weeklyTrend.thisWeek,
        lastWeek: weeklyTrend.lastWeek,
      })
    : null;
  const summary = total
    ? t("nightly.summaryPlan", { count: doneCount }) +
      (distintoCount ? t("nightly.summaryDifferent", { count: distintoCount }) : "") +
      (skippedCount ? t("nightly.summarySkipped", { count: skippedCount }) : "") +
      t("nightly.summaryTotal", { count: total })
    : t("nightly.noMeals");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 font-title font-semibold tracking-[-0.02em]">
            <Moon className="h-4 w-4 text-primary-ink" /> {t("nightly.title")}
          </SheetTitle>
          <SheetDescription>{t("nightly.subtitle")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          {pending.length > 0 && onSkipPending ? (
            <div className="rounded-3xl bg-primary-soft p-4">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("nightly.pendingTitle")}
              </span>
              <p className="mt-1 text-sm text-foreground">
                {t("nightly.pendingBody", {
                  meals: pending
                    .map((h) => t(`moments.${h.label}`, { defaultValue: h.label }))
                    .join(", "),
                })}
              </p>
              <Button variant="secondary" className="mt-3 w-full" onClick={onSkipPending}>
                {t("nightly.skipPending")}
              </Button>
            </div>
          ) : null}

          <div className="surface-card p-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("nightly.mealsTitle")}
            </span>
            <p className="mt-1 text-sm text-foreground">{summary}</p>
            <p className="mt-2 text-sm text-foreground">
              {t(`nightly.reaction.${reactionKey(ratio)}.${toneKey}`)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("nightly.momentum", { value: impulso })}
            </p>
          </div>

          {trendLine ? (
            <div className="surface-card p-4">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("nightly.weekTitle")}
              </span>
              <p className="mt-1 text-sm text-foreground">{trendLine}</p>
            </div>
          ) : null}

          <div className="surface-card p-4">
            <p className="text-sm leading-relaxed text-foreground">
              {t(`nightly.closing.${closingLineIndex()}`)}
            </p>
          </div>

          <Button className="w-full" onClick={onDone}>
            {t("nightly.done")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
