import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import { todayISO, type DailyLog } from "../../lib/daily";
import type { SharedSlots } from "../../lib/household-shared";
import { dateLocale } from "../../lib/i18n";
import { daySignalKeyOf, daySignalOf } from "../../lib/macros";
import {
  capitalizeFirst,
  childMealsForDate,
  isBeforeAppStart,
  isPinnedByViewer,
  mealsForDate,
  offListNote,
  planForDate,
  type HouseholdPinContext,
  type MealSlot,
  type MonthlyPlan,
  type PlanMonthStatus,
} from "../../lib/plan-shared";
import { DishRecipe } from "../dish-recipe";
import { Dialog } from "../ui/dialog";

const SIGNAL_BG: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  over: "bg-danger",
  muted: "bg-muted",
};

// Calendario del mes con detalle de día en modal, equivalente RN del
// PlanMonthCalendar de la web. Los días pasados llevan el semáforo de
// cumplimiento y abren el detalle reducido del día (`onOpenDay`).
export function PlanMonthCalendar({
  plan,
  month,
  logs,
  monthStatus,
  appStartedOn,
  householdChildren,
  selectedMealSlots,
  onOpenDay,
  homePlanner,
}: {
  plan: MonthlyPlan | null;
  month: string;
  logs: DailyLog[];
  monthStatus: PlanMonthStatus;
  appStartedOn: string | null;
  /** Niños de la casa, para el plato aparte cuando el compartido no vale (issue 07). */
  householdChildren?: { id: string; name: string }[];
  /** Comidas que esta persona planifica; cinturón extra sobre el filtro por
   *  contenido de `mealsForDate` (ver hoy.tsx para el porqué). */
  selectedMealSlots: readonly MealSlot[];
  onOpenDay: (date: string) => void;
  /** Para saber si un plato fijado lo cambió esta persona o el resto del hogar
   *  (ver `dishChangeIsMine`). */
  homePlanner: { isPlanner: boolean; sharedSlots: SharedSlots } | null;
}) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const [year, m] = month.split("-").map(Number);
  const monthIdx = (m ?? 1) - 1;
  const y = year ?? new Date().getFullYear();
  const daysInMonth = new Date(y, monthIdx + 1, 0).getDate();
  const firstOffset = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
  const isoDay = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const fromDay = plan?.coverage?.fromDay ?? 1;
  const logByDate = new Map(logs.map((l) => [l.log_date, l]));

  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDay(i + 1)),
  ];

  const detail = selected ? planForDate(plan, selected) : null;
  const meals = selected ? mealsForDate(plan, selected, selectedMealSlots) : [];
  const homeCtx: HouseholdPinContext | null =
    selected && homePlanner
      ? { ...homePlanner, weekday: (new Date(`${selected}T00:00:00`).getDay() + 6) % 7 }
      : null;
  // Platos aparte de los niños ese día (issue 07), por slot.
  const kidMealsBySlot = new Map<string, { name: string; dish: string; off: string[] }[]>();
  if (selected) {
    for (const c of householdChildren ?? []) {
      for (const k of childMealsForDate(plan, selected, c.id)) {
        const list = kidMealsBySlot.get(k.slot) ?? [];
        list.push({ name: c.name, dish: k.dish, off: k.off });
        kidMealsBySlot.set(k.slot, list);
      }
    }
  }

  return (
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">{t("planCalendar.title")}</Text>
      <Text className="mt-1 text-xs text-muted-foreground">
        {monthStatus === "past" ? t("planCalendar.hintPast") : t("planCalendar.hintCurrent")}
      </Text>

      <View className="mt-4 flex-row flex-wrap">
        {Array.from({ length: 7 }, (_, i) => (
          <View key={i} className="items-center py-1" style={{ width: `${100 / 7}%` }}>
            <Text className="text-[11px] font-sans-medium text-muted-foreground">
              {t(`weekdaysInitial.${i}`)}
            </Text>
          </View>
        ))}
        {cells.map((date, i) => {
          if (!date)
            return <View key={`empty-${i}`} className="p-0.5" style={{ width: `${100 / 7}%` }} />;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          const isToday = date === today;
          const isPast = date < today;
          const log = logByDate.get(date);
          const inertBefore =
            isBeforeAppStart(date, appStartedOn) || Number(date.slice(8, 10)) < fromDay;

          if (inertBefore && !log) {
            return (
              <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
                <View className="aspect-square items-center justify-center rounded-xl bg-muted/50">
                  <Text className="text-sm text-muted-foreground/40">
                    {Number(date.slice(8, 10))}
                  </Text>
                </View>
              </View>
            );
          }

          if (isPast) {
            // El color dice cómo quedó el día frente a su objetivo (lo que el
            // plan proponía), no cuántas comidas se marcaron — ver `daySignal`
            // en lib/macros.ts.
            const signal = daySignalOf(log);
            const bg = SIGNAL_BG[signal] ?? "bg-secondary/70";
            // El color en palabras, para VoiceOver (A11Y-06).
            const signalKey = daySignalKeyOf(log);
            const signalLabel = signalKey ? t(`daySignal.${signalKey}`) : null;
            return (
              <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
                <Pressable
                  onPress={() => onOpenDay(date)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    signalLabel
                      ? t("planCalendar.openDayWithSignal", {
                          day: Number(date.slice(8, 10)),
                          signal: signalLabel,
                        })
                      : t("planCalendar.openDay", { day: Number(date.slice(8, 10)) })
                  }
                  className={`aspect-square items-center justify-center rounded-xl active:opacity-80 ${bg}`}
                >
                  <Text className="text-sm text-foreground">{Number(date.slice(8, 10))}</Text>
                </Pressable>
              </View>
            );
          }

          return (
            <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelected(date)}
                className={`aspect-square items-center justify-center rounded-xl active:opacity-80 ${
                  isWeekend ? "bg-accent/60" : "bg-secondary"
                } ${isToday ? "border-2 border-primary" : ""}`}
                style={isToday ? { borderWidth: 2 } : undefined}
              >
                <Text className="text-sm text-foreground">{Number(date.slice(8, 10))}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {t("planCalendar.legend")}
      </Text>

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={
          selected
            ? capitalizeFirst(
                new Date(`${selected}T00:00:00`).toLocaleDateString(dateLocale(i18n.language), {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }),
              )
            : ""
        }
      >
        {detail ? (
          <View className="gap-3">
            <Text className="text-xs text-muted-foreground">
              {detail.week.label} · {detail.week.focus}
            </Text>
            <View className="gap-2">
              {meals.map((meal) => {
                const note = offListNote(meal.off, t);
                return (
                  <View key={meal.slot} className="rounded-xl bg-secondary p-3">
                    <Text className="text-xs font-sans-semibold text-primary-ink">
                      {t(`moments.${meal.moment}`, { defaultValue: meal.moment })}
                    </Text>
                    <Text className="mt-1 text-sm text-foreground">{meal.idea}</Text>
                    {note ? (
                      <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
                        <Text className="text-[11px] font-sans-medium text-foreground">{note}</Text>
                      </View>
                    ) : null}
                    {(kidMealsBySlot.get(meal.slot) ?? []).map((k) => (
                      <View key={`${k.name}-${k.dish}`} className="mt-1.5">
                        <Text className="text-[11px] leading-relaxed text-muted-foreground">
                          {t("planCalendar.forChild", { name: k.name })}{" "}
                          <Text className="text-foreground">{k.dish}</Text>
                          {offListNote(k.off, t) ? ` · ${offListNote(k.off, t)}` : ""}
                        </Text>
                        <DishRecipe dish={k.dish} month={month} />
                      </View>
                    ))}
                    {/* Sin receta si el plato se eligió a mano: ya se sabe qué
                        se va a comer, así que enseñarla solo gastaría una
                        llamada a la IA sin aportar nada. En un hogar compartido
                        esto solo cuenta para quien de verdad lo cambió
                        (`isPinnedByViewer`), no para el resto. */}
                    {!isPinnedByViewer(detail.day, meal.slot, homeCtx) ? (
                      <DishRecipe dish={meal.idea} month={month} />
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">{t("planCalendar.noMenu")}</Text>
        )}
      </Dialog>
    </View>
  );
}
