import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { dateLocale } from "../lib/i18n";
import type { PlanFitChange, PlanFitMark } from "../lib/plan-shared";
import type { Translate } from "../lib/week-nav";

/**
 * Lo que cambió la comprobación del plan contra el objetivo (ticket 10 de
 * `precision-nutricional`, `fitMonthlyPlan`), dentro de "Cómo enfocamos el mes".
 * Un cambio automático del plan tiene que verse. Sin cifras: vale igual con
 * `nutrition_numbers = ocultar`. Copia de `src/components/plan-fit-note.tsx`.
 */

/** Cambios a la vista; el resto tras "Ver los N". */
const INLINE_CHANGES = 3;

const dayLabel = (date: string, locale: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric" });

const SLOT_LABEL: Record<PlanFitChange["slot"], string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
  merienda: "Merienda",
};

/** "mar 15 · Cena", o para una idea de la semana "Merienda · 4 días desde mar 15". */
const changeLabel = (c: PlanFitChange, t: Translate, locale: string) => {
  const slot = t(`moments.${SLOT_LABEL[c.slot]}`, { defaultValue: SLOT_LABEL[c.slot] });
  const day = dayLabel(c.date, locale);
  return c.days && c.days > 1
    ? t("planFit.weekIdea", { slot, days: c.days, day })
    : t("planFit.single", { day, slot });
};

export function PlanFitNote({ fit, fitting }: { fit?: PlanFitMark; fitting: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const [all, setAll] = useState(false);
  if (fitting && !fit) {
    return (
      <View className="mt-3 flex-row items-center gap-2">
        <ActivityIndicator size="small" color="#a84a17" />
        <Text className="text-xs text-muted-foreground">{t("planFit.fitting")}</Text>
      </View>
    );
  }
  if (!fit?.changed.length) return null;

  const n = fit.changed.length;
  const shown = all ? fit.changed : fit.changed.slice(0, INLINE_CHANGES);
  return (
    <View className="mt-4 border-t border-border/60 pt-4">
      <Text className="text-sm font-sans-medium text-foreground">
        {t("planFit.title", { count: n })}
      </Text>
      <Text className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("planFit.why")}</Text>
      <View className="mt-3 gap-2">
        {shown.map((c) => (
          <View key={`${c.date}-${c.slot}`} className="rounded-2xl bg-secondary/60 px-3 py-2.5">
            <Text className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              {changeLabel(c, t, locale)}
            </Text>
            <View className="mt-1 flex-row flex-wrap items-start gap-1.5">
              <Text className="font-body text-[13px] text-muted-foreground line-through">
                {c.from}
              </Text>
              <Text className="font-body text-[13px] text-muted-foreground">→</Text>
              <Text className="font-body text-[13px] text-foreground">{c.to}</Text>
            </View>
          </View>
        ))}
      </View>
      {n > INLINE_CHANGES ? (
        <Pressable onPress={() => setAll((v) => !v)} hitSlop={8} className="mt-2">
          <Text className="text-xs font-sans-medium text-primary-ink">
            {all ? t("planFit.less") : t("planFit.all", { n })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
