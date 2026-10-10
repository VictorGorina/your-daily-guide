import { useTranslation } from "react-i18next";

import { MacroBars } from "@/components/macro-bars";
import type { DailyGuide, DailyLog, Profile } from "@/lib/daily";
import { dateLocale } from "@/lib/i18n";
import { donePendingMeals, type addMacros } from "@/lib/macros";
import { caloriesText, type EnergyTargets } from "@/lib/nutrition/energy";

type Macros = ReturnType<typeof addMacros>;

/** Cabecera de Hoy: fecha, título e impulso. */
export function HoyHeader({ today, impulso }: { today: string; impulso: number }) {
  const { t, i18n } = useTranslation();
  const dateLabel = new Date(`${today}T00:00:00`)
    .toLocaleDateString(dateLocale(i18n.language), {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(",", "");
  return (
    <header className="animate-rise flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-num text-[11px] font-medium uppercase leading-none tracking-[0.09em] text-muted-foreground">
          {dateLabel}
        </p>
        <h1 className="mt-1.5 font-title text-[40px] font-semibold leading-[0.98] tracking-[-0.03em] text-foreground">
          {t("hoy.title")}
        </h1>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1" title={t("hoy.momentumHint")}>
        <div className="flex items-baseline gap-[3px]">
          <span className="font-title text-[26px] font-semibold leading-none tabular-nums text-foreground">
            {impulso}
          </span>
          <span className="font-num text-[11px] font-medium leading-none text-muted-foreground">
            %
          </span>
        </div>
        <span className="font-num text-[9.5px] font-medium uppercase leading-none tracking-[0.1em] text-muted-foreground">
          {t("hoy.momentum")}
        </span>
      </div>
    </header>
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
  doneMacros: Macros;
  dayTarget: Macros | null;
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
      {showNumbers ? (
        <MacroBars
          estimate={doneMacros}
          target={dayTarget ?? guide?.macroEstimate ?? null}
          weightKg={profile?.current_weight_kg ?? null}
          pending={donePendingMeals(guide?.mealMacros, habits).length}
        />
      ) : null}
      {showNumbers && planShortOfTarget ? (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          {t("hoy.planShort")}
        </p>
      ) : null}

      {/* Guía del coach: solo el rango de calorías del día, en una fila, sin
          tarjeta expandible (intro, macros en texto, platos sugeridos,
          consejos) — se quería menos información. Igual que en la app móvil,
          y va justo aquí, antes de las comidas. */}
      <section className="animate-rise mt-6">
        <div className="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
          <span className="block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {generating || (!guide && loading)
              ? t("hoy.guide.preparing")
              : guide
                ? t("hoy.guide.withCalories", {
                    calories: caloriesText(energy, showNumbers, t, dateLocale(i18n.language)),
                  })
                : t("hoy.guide.label")}
          </span>
          {!guide && !generating && !loading ? (
            <button
              type="button"
              onClick={() => requestGuide()}
              className="shrink-0 text-xs font-medium text-primary-ink"
            >
              {t("hoy.guide.generate")}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
