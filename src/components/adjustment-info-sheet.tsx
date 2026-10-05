import { useTranslation } from "react-i18next";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { dateLocale } from "@/lib/i18n";
import type { MealChange } from "@/lib/plan-shared";

const weekdayShort = (date: string, locale: string) => {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * Bottom sheet con TODO lo que el día ha movido en los próximos días. Se abre
 * desde "Balance de hoy" (`day-balance-card.tsx`), que ya enseña los dos
 * primeros platos en línea: esto es el resto.
 *
 * Antes había tres instancias de esta hoja —una por el cambio de plato, otra
 * por el picoteo y otra por el deporte—, cada una afirmando que el reajuste era
 * suyo. Como el desvío que lo provoca es el del día entero, las tres enseñaban
 * lo mismo con tres atribuciones distintas (feature `balance-del-dia`). Por eso
 * ya no recibe ni `dish` ni `verb`: el sujeto es el día.
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
  const signed =
    typeof kcalDelta === "number" && kcalDelta !== 0
      ? `${kcalDelta > 0 ? "+" : "−"}${Math.abs(kcalDelta)} kcal`
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            {t("adjustment.title")}
          </SheetTitle>
          <SheetDescription>
            {signed ? (
              <>
                {t("adjustment.todayBefore")}{" "}
                <span className="font-medium text-foreground">{signed}</span>{" "}
                {t("adjustment.todayAfter")}
              </>
            ) : (
              t("adjustment.plain")
            )}
            {changes.length ? t("adjustment.withChanges") : t("adjustment.noChanges")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-8">
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {signed
                ? t(
                    (kcalDelta ?? 0) > 0
                      ? "adjustment.noneMovedExcess"
                      : "adjustment.noneMovedDifference",
                  )
                : t("adjustment.noneMoved")}
            </p>
          ) : (
            changes.map((c) => (
              <div key={`${c.date}-${c.slot}`} className="rounded-xl bg-secondary/60 px-3.5 py-3">
                <span className="font-num text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  {weekdayShort(c.date, dateLocale(i18n.language))} ·{" "}
                  {t(`moments.${c.slotLabel}`, { defaultValue: c.slotLabel })}
                </span>
                <div className="mt-1.5 flex items-start gap-2 text-sm leading-snug">
                  <span className="text-muted-foreground line-through">{c.before}</span>
                  <span className="shrink-0 text-muted-foreground">→</span>
                  <span className="font-medium text-foreground">{c.after}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
