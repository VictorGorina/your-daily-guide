import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { dateLocale } from "../lib/i18n";
import type { MealChange } from "../lib/plan-shared";
import { Sheet } from "./ui/sheet";

const weekdayShort = (date: string, locale: string) => {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * Todo lo que el día ha movido en los próximos días. Se abre desde "Balance de
 * hoy" (`day-balance-card.tsx`), que ya enseña los dos primeros platos en
 * línea: esto es el resto.
 *
 * Antes había tres instancias de esta hoja —una por el cambio de plato, otra
 * por el picoteo y otra por el deporte—, cada una afirmando que el reajuste era
 * suyo. Como el desvío que lo provoca es el del día entero, las tres enseñaban
 * lo mismo con tres atribuciones distintas (`balance-del-dia`). Por eso ya no
 * recibe ni `dish` ni `verb`: el sujeto es el día. Copia nativa de
 * `src/components/adjustment-info-sheet.tsx`.
 */
export function AdjustmentInfoSheet({
  open,
  onOpenChange,
  changes,
  kcalDelta,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: MealChange[];
  /** Desvío del día frente a lo que preveía el plan. */
  kcalDelta?: number | null;
}) {
  const { t, i18n } = useTranslation();
  const rounded =
    typeof kcalDelta === "number" && kcalDelta !== 0
      ? `${kcalDelta > 0 ? "+" : "−"}${Math.abs(kcalDelta)} kcal`
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("adjustment.title")}>
      <View className="gap-3 px-4 pb-8">
        <Text className="text-sm text-muted-foreground">
          {rounded ? (
            <Text>
              {t("adjustment.todayBefore")}{" "}
              <Text className="font-medium text-foreground">{rounded}</Text>{" "}
              {t("adjustment.todayAfter")}
            </Text>
          ) : (
            <Text>{t("adjustment.plain")}</Text>
          )}
          {changes.length ? t("adjustment.withChanges") : t("adjustment.noChanges")}
        </Text>

        {changes.length === 0 ? (
          // Sin cifra no se puede afirmar que el plan siga equilibrado: solo
          // sabemos que el coach no ha movido nada. Con cifra, se dice.
          <Text className="text-sm text-muted-foreground">
            {rounded
              ? t(
                  (kcalDelta ?? 0) > 0
                    ? "adjustment.noneMovedExcess"
                    : "adjustment.noneMovedDifference",
                )
              : t("adjustment.noneMoved")}
          </Text>
        ) : (
          changes.map((c) => (
            <View key={`${c.date}-${c.slot}`} className="rounded-2xl bg-secondary/60 px-3.5 py-3">
              <Text className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                {weekdayShort(c.date, dateLocale(i18n.language))} ·{" "}
                {t(`moments.${c.slotLabel}`, { defaultValue: c.slotLabel })}
              </Text>
              <View className="mt-1.5 flex-row flex-wrap items-start gap-2">
                <Text className="text-sm text-muted-foreground line-through">{c.before}</Text>
                <Text className="text-sm text-muted-foreground">→</Text>
                <Text className="text-sm font-medium text-foreground">{c.after}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </Sheet>
  );
}
