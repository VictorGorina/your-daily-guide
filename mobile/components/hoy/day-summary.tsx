import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import type { DailyGuide, DailyLog, MacroEstimate, Profile } from "../../lib/daily";
import { caloriesText, type EnergyTargets } from "../../lib/energy";
import { dateLocale } from "../../lib/i18n";
import { donePendingMeals } from "../../lib/macros";
import { MacroBars } from "../macro-bars";

// Fecha de hoy en el idioma de la pantalla
function formatDate(locale: string): string {
  return new Date()
    .toLocaleDateString(dateLocale(locale), {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(",", "");
}

/** Cabecera de Hoy: fecha, título e impulso. */
export function HoyHeader({ impulso }: { impulso: number }) {
  const { t, i18n } = useTranslation();
  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="min-w-0 flex-1">
        <Text className="font-mono-medium text-[11px] uppercase tracking-widest text-muted-foreground">
          {formatDate(i18n.language)}
        </Text>
        <Text
          className="font-heading text-foreground"
          style={{ fontSize: 40, lineHeight: 42, letterSpacing: -1.2 }}
        >
          {t("hoy.title")}
        </Text>
      </View>
      <View className="items-end gap-1">
        <View className="flex-row items-baseline gap-0.5">
          <Text className="font-heading text-foreground" style={{ fontSize: 26, lineHeight: 28 }}>
            {impulso}
          </Text>
          <Text className="font-mono-medium text-[11px] text-muted-foreground">%</Text>
        </View>
        <Text className="font-mono-medium text-[9.5px] uppercase tracking-widest text-muted-foreground">
          {t("hoy.momentum")}
        </Text>
      </View>
    </View>
  );
}

/** Barras de macros de lo ya comido y la línea de la guía del coach. */
export function MacroSection({
  showNumbers,
  doneMacros,
  dayTarget,
  planShortOfTarget,
  guide,
  habits,
  profile,
  energy,
  generating,
  loading,
  requestGuide,
}: {
  showNumbers: boolean;
  doneMacros: MacroEstimate;
  dayTarget: MacroEstimate | null;
  planShortOfTarget: boolean;
  guide: DailyGuide | null;
  habits: DailyLog["habits"];
  profile: Profile | null | undefined;
  energy: EnergyTargets | null;
  generating: boolean;
  /** El registro de hoy aún está cargando. */
  loading: boolean;
  requestGuide: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {/* ── Barras de macros ── */}
      {showNumbers ? (
        <MacroBars
          estimate={doneMacros}
          target={dayTarget ?? guide?.macroEstimate ?? null}
          weightKg={profile?.current_weight_kg ?? null}
          pending={donePendingMeals(guide?.mealMacros, habits).length}
        />
      ) : null}
      {showNumbers && planShortOfTarget ? (
        <Text className="font-body mt-1.5 text-[10.5px] text-muted-foreground">
          {t("hoy.planShort")}
        </Text>
      ) : null}

      {/* ── Guía del coach: solo el rango de calorías del día, sin el resto
          (intro, macros en texto, platos sugeridos, consejos) — se quería
          menos información, no una tarjeta expandible. ── */}
      <View className="mt-6 flex-row items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
        <View
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "#ff8a3d" }}
        />
        <Text className="min-w-0 flex-1 font-body-medium text-xs text-muted-foreground">
          {generating || (!guide && loading)
            ? t("hoy.guide.preparing")
            : guide
              ? t("hoy.guide.withCalories", {
                  calories: caloriesText(energy, showNumbers, t, dateLocale(i18n.language)),
                })
              : t("hoy.guide.label")}
        </Text>
        {!guide && !generating && !loading ? (
          <Pressable accessibilityRole="button" onPress={() => requestGuide()}>
            <Text className="font-body-medium text-xs text-primary-ink">
              {t("hoy.guide.generate")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
