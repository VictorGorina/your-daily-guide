import { useTranslation } from "react-i18next";

import type { MacroEstimate } from "@/lib/guide.functions";
import { intakeTone, macroTargets, type IntakeTone } from "@/lib/macros";

/**
 * `excess`: pasarse se avisa con el semáforo. En la proteína y la fibra no:
 * comer más de las dos no es un exceso, así que su porcentaje no se colorea.
 */
const MACRO_BAR_ITEMS = [
  { key: "protein_g", label: "protein", color: "var(--color-chart-1)", excess: false },
  { key: "carbs_g", label: "carbs", color: "var(--color-chart-2)", excess: true },
  { key: "fat_g", label: "fat", color: "var(--color-chart-3)", excess: true },
  { key: "fiber_g", label: "fiber", color: "var(--color-chart-4)", excess: false },
] as const;

/** Los mismos pares de relleno y texto que el semáforo del calendario. */
const TONE_CLASS: Record<IntakeTone, string> = {
  neutral: "",
  success: "rounded-full bg-success px-1.5 text-success-foreground",
  warning: "rounded-full bg-warning px-1.5 text-warning-foreground",
  over: "rounded-full bg-danger px-1.5 text-danger-foreground",
};

const percentOf = (value: number, goal: number) =>
  goal > 0 ? Math.round((value / goal) * 100) : 0;

/**
 * `target` es el objetivo del día (el de `energyTargets`, o la suma de lo que
 * el plan proponía, `macroEstimate`). Solo cae a la referencia genérica de peso
 * (`macroTargets`) mientras no hay ninguno, y entonces no se enseñan
 * porcentajes: no se mide contra algo que no es el objetivo de la persona.
 *
 * El porcentaje NO se recorta a 100 (decisión del usuario, 2026-10-27): si
 * comes de más sale por encima, y la barra también lo enseña. Pasado el 100 %
 * la escala se estira hasta el porcentaje, una muesca marca el 100 % y lo que
 * sobra se pinta más claro. Las kcal van en su propia línea, "~1.950 de 2.200
 * kcal · 89%", con el tono del semáforo (`intakeTone`).
 *
 * Compartido por la pestaña Hoy y el detalle de un día pasado en Plan
 * (`finished`: frases en pasado y semáforo entero).
 */
export function MacroBars({
  estimate,
  target,
  weightKg,
  finished = false,
  pending = 0,
}: {
  estimate: MacroEstimate;
  target: MacroEstimate | null;
  weightKg: number | null;
  /** Día cerrado (detalle de un día pasado), no el de hoy en curso. */
  finished?: boolean;
  /**
   * Comidas marcadas cuya cifra aún se está calculando (D13): no suman, y se
   * dice, para que el total no se lea como completo.
   */
  pending?: number;
}) {
  const { t } = useTranslation();
  const fallbackTargets = macroTargets(weightKg);
  const kcalGoal = target?.kcal ?? 0;
  const lead =
    kcalGoal > 0
      ? t(finished ? "macros.leadThatDay" : "macros.leadToday")
      : t(finished ? "dayDetail.eatenThatDay" : "macros.eatenToday", { kcal: estimate.kcal });
  return (
    <section className="animate-rise mt-[22px]">
      {kcalGoal > 0 ? (
        <p className="mb-3 flex items-baseline justify-between gap-2 font-num text-[11px] font-medium leading-none tabular-nums text-foreground">
          <span>
            {t("macros.kcalOfTarget", { kcal: estimate.kcal, target: Math.round(kcalGoal) })}
          </span>
          <span className={TONE_CLASS[intakeTone(estimate.kcal, kcalGoal, finished)]}>
            {percentOf(estimate.kcal, kcalGoal)}%
          </span>
        </p>
      ) : null}
      <div className="grid grid-cols-4 gap-2.5">
        {MACRO_BAR_ITEMS.map((it) => {
          const value = estimate[it.key];
          const goal = target?.[it.key] || fallbackTargets[it.key];
          const pct = percentOf(value, goal);
          // Pasado el 100 % la escala llega hasta el porcentaje: la parte de
          // hasta el objetivo y, tras la muesca, lo que sobra.
          const over = !!target && pct > 100;
          const scale = over ? pct : 100;
          const tone = target && it.excess ? intakeTone(value, goal, false) : "neutral";
          return (
            <div key={it.key} className="min-w-0">
              <div className="flex h-[5px] gap-0.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-out"
                  style={{
                    width: `${(Math.min(pct, 100) / scale) * 100}%`,
                    backgroundColor: it.color,
                  }}
                />
                {over ? (
                  <div
                    className="h-full rounded-full opacity-45"
                    style={{ width: `${((pct - 100) / scale) * 100}%`, backgroundColor: it.color }}
                  />
                ) : null}
              </div>
              <p className="mt-[7px] truncate font-num text-[9.5px] font-medium uppercase leading-none tracking-[0.06em] text-muted-foreground">
                {t(`macros.${it.label}`)}
              </p>
              {/* Con píldora sobra el "·": ya separa, y así cabe en la columna. */}
              <p className="mt-[3px] font-num text-[11px] font-medium leading-none tabular-nums text-foreground">
                {value} g
                {target ? (
                  <>
                    {tone === "neutral" ? " · " : " "}
                    <span className={TONE_CLASS[tone]}>{pct}%</span>
                  </>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        {lead}
        {pending > 0 ? t("macros.pending", { count: pending }) : ""}
        {t("macros.disclaimer")}
      </p>
    </section>
  );
}
