import { Moon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import type { MealStatus, WeeklyTrend } from "../lib/daily";
import { Sheet } from "./ui/sheet";

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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <View className="flex-row items-center gap-2">
          <Moon size={16} color="#6dbe7b" />
          <Text className="font-heading-medium text-lg text-foreground">{t("nightly.title")}</Text>
        </View>
      }
      description={t("nightly.subtitle")}
    >
      <View className="gap-4 pb-8 pt-4">
        {pending.length > 0 && onSkipPending ? (
          <View className="rounded-3xl bg-primary-soft p-4">
            <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
              {t("nightly.pendingTitle")}
            </Text>
            <Text className="mt-1 text-sm text-foreground">
              {t("nightly.pendingBody", {
                meals: pending
                  .map((h) => t(`moments.${h.label}`, { defaultValue: h.label }))
                  .join(", "),
              })}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onSkipPending}
              className="mt-3 w-full items-center rounded-full bg-secondary py-3 active:opacity-90"
            >
              <Text className="text-sm font-sans-medium text-secondary-foreground">
                {t("nightly.skipPending")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View className="rounded-3xl bg-surface p-4">
          <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
            {t("nightly.mealsTitle")}
          </Text>
          <Text className="mt-1 text-sm text-foreground">{summary}</Text>
          <Text className="mt-2 text-sm text-foreground">
            {t(`nightly.reaction.${reactionKey(ratio)}.${toneKey}`)}
          </Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            {t("nightly.momentum", { value: impulso })}
          </Text>
        </View>

        {trendLine ? (
          <View className="rounded-3xl bg-surface p-4">
            <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
              {t("nightly.weekTitle")}
            </Text>
            <Text className="mt-1 text-sm text-foreground">{trendLine}</Text>
          </View>
        ) : null}

        <View className="rounded-3xl bg-surface p-4">
          <Text className="text-sm leading-relaxed text-foreground">
            {t(`nightly.closing.${closingLineIndex()}`)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          className="w-full items-center rounded-full bg-primary py-4 active:opacity-90"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {t("nightly.done")}
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
