import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import type { MacroEstimate } from "../lib/daily";
import { intakeTone, macroTargets, type IntakeTone } from "../lib/macros";

/**
 * `excess`: pasarse se avisa con el semáforo. En la proteína y la fibra no:
 * comer más de las dos no es un exceso, así que su porcentaje no se colorea.
 */
const MACRO_BAR_ITEMS = [
  { key: "protein_g", label: "protein", color: "#6DBE7B", excess: false },
  { key: "carbs_g", label: "carbs", color: "#FF8A3D", excess: true },
  { key: "fat_g", label: "fat", color: "#F2C14E", excess: true },
  { key: "fiber_g", label: "fiber", color: "#4C9BD6", excess: false },
] as const;

/** Los mismos pares de relleno y texto que el semáforo del calendario. */
const TONE_CLASS: Record<IntakeTone, { box: string; text: string }> = {
  neutral: { box: "", text: "text-foreground" },
  success: { box: "rounded-full bg-success px-1.5", text: "text-success-foreground" },
  warning: { box: "rounded-full bg-warning px-1.5", text: "text-warning-foreground" },
  over: { box: "rounded-full bg-danger px-1.5", text: "text-danger-foreground" },
};

const percentOf = (value: number, goal: number) =>
  goal > 0 ? Math.round((value / goal) * 100) : 0;

/** El porcentaje, en su píldora de color cuando el tono lo pide. */
function Pct({ pct, tone, size }: { pct: number; tone: IntakeTone; size: number }) {
  const cls = TONE_CLASS[tone];
  return (
    <View className={cls.box}>
      <Text className={`font-mono-medium ${cls.text}`} style={{ fontSize: size }}>
        {pct}%
      </Text>
    </View>
  );
}

/**
 * `target` es el objetivo del día (el de `energyTargets`, o la suma de lo que
 * el plan proponía, `macroEstimate`). Solo cae a la referencia genérica de peso
 * mientras no hay ninguno, y entonces no se enseñan porcentajes.
 *
 * El porcentaje no se recorta a 100 (decisión del usuario, 2026-10-27): si
 * comes de más sale por encima, y la barra también lo enseña. Pasado el 100 %
 * la escala se estira hasta el porcentaje, una muesca marca el 100 % y lo que
 * sobra se pinta más claro. Las kcal van en su propia línea con el tono del
 * semáforo (`intakeTone`).
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
  /** Comidas marcadas cuya cifra aún se está calculando (D13): no suman, y se dice. */
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
    <View className="mt-5">
      {kcalGoal > 0 ? (
        <View className="mb-3 flex-row items-center justify-between gap-2">
          <Text className="font-mono-medium text-[11px] text-foreground">
            {t("macros.kcalOfTarget", { kcal: estimate.kcal, target: Math.round(kcalGoal) })}
          </Text>
          <Pct
            pct={percentOf(estimate.kcal, kcalGoal)}
            tone={intakeTone(estimate.kcal, kcalGoal, finished)}
            size={11}
          />
        </View>
      ) : null}
      <View className="flex-row gap-2.5">
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
            <View key={it.key} className="flex-1">
              <View className="h-[5px] flex-row gap-0.5 overflow-hidden rounded-full bg-secondary">
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${(Math.min(pct, 100) / scale) * 100}%`,
                    flexShrink: 1,
                    backgroundColor: it.color,
                  }}
                />
                {over ? (
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${((pct - 100) / scale) * 100}%`,
                      flexShrink: 1,
                      backgroundColor: it.color,
                      opacity: 0.45,
                    }}
                  />
                ) : null}
              </View>
              <Text className="font-mono-medium mt-1.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                {t(`macros.${it.label}`)}
              </Text>
              <View className="mt-0.5 flex-row flex-wrap items-center">
                {/* Con píldora sobra el "·": ya separa, y así cabe en la columna. */}
                <Text className="font-mono-medium text-[11px] text-foreground">
                  {value} g{target ? (tone === "neutral" ? " · " : " ") : ""}
                </Text>
                {target ? <Pct pct={pct} tone={tone} size={11} /> : null}
              </View>
            </View>
          );
        })}
      </View>
      <Text className="font-body mt-2.5 text-[10.5px] text-muted-foreground">
        {lead}
        {pending > 0 ? t("macros.pending", { count: pending }) : ""}
        {t("macros.disclaimer")}
      </Text>
    </View>
  );
}
