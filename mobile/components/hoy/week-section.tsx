import { useQueries } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react-native";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import {
  fetchLogsForMonth,
  fetchMonthlyPlan,
  todayISO,
  type DailyLog,
  type Profile,
} from "../../lib/daily";
import type { HouseholdState } from "../../lib/household";
import type { SharedSlots } from "../../lib/household-shared";
import { dateLocale } from "../../lib/i18n";
import {
  capitalizeFirst,
  isPinnedByViewer,
  mealsForDate,
  offListNote,
  planForDate,
  type HouseholdPinContext,
  type MealSlot,
  type MonthlyPlan,
} from "../../lib/plan-shared";
import { addDaysISO, monthsOfWeek, weekDates, weekStartOf } from "../../lib/week-nav";
import { DayDetailBody, type DayDetailHousehold } from "../day-detail-sheet";
import { DishRecipe } from "../dish-recipe";
import { WeekPager } from "../week-pager";

// Misma curva que el resto de la app (docs/design-guidelines.md §7) y que
// `week-pager.tsx`, para que el panel del día y la tira se muevan igual.
const EASING = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * La tira de la semana de Hoy y el día que se abre debajo: pasado (lo que se
 * registró) o futuro (su menú). Lleva sus propios datos: los meses que la tira
 * puede llegar a pisar.
 */
export function WeekSection({
  today: today0,
  profile,
  household,
  sharedSlots,
  mySlots,
  homePlanner,
}: {
  /** Hoy, `YYYY-MM-DD`. */
  today: string;
  profile: Profile | null | undefined;
  household: HouseholdState | null | undefined;
  sharedSlots: SharedSlots | null;
  mySlots: readonly MealSlot[];
  homePlanner: { isPlanner: boolean; sharedSlots: SharedSlots } | null;
}) {
  const { t } = useTranslation();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [visibleWeek, setVisibleWeek] = useState(() => weekStartOf(today0));
  const appStartedOn = profile?.app_started_on ?? null;

  // Meses que puede llegar a pisar la tira: la semana visible y sus dos
  // vecinas (lo que `WeekPager` puede llegar a pintar con `windowSize={3}`),
  // para que deslizar hasta el borde de un mes no se quede sin datos. Solo
  // cambia cuando cambia de semana, no en cada frame de scroll.
  const pagerMonths = useMemo(() => {
    const months = new Set([
      ...monthsOfWeek(visibleWeek),
      ...monthsOfWeek(addDaysISO(visibleWeek, -7)),
      ...monthsOfWeek(addDaysISO(visibleWeek, 7)),
    ]);
    return [...months].sort();
  }, [visibleWeek]);

  const pagerLogsQ = useQueries({
    queries: pagerMonths.map((m) => ({
      queryKey: ["logs", m],
      queryFn: () => fetchLogsForMonth(m),
    })),
  });
  const pagerPlanQ = useQueries({
    queries: pagerMonths.map((m) => ({
      queryKey: ["plan", m],
      queryFn: () => fetchMonthlyPlan(m),
    })),
  });
  const logByDate = useMemo(() => {
    const map = new Map<string, DailyLog>();
    for (const q of pagerLogsQ) for (const l of q.data ?? []) map.set(l.log_date, l);
    return map;
  }, [pagerLogsQ]);
  const planByMonth = useMemo(() => {
    const map = new Map<string, MonthlyPlan | null>();
    pagerMonths.forEach((m, i) => map.set(m, (pagerPlanQ[i]?.data?.plan as MonthlyPlan) ?? null));
    return map;
  }, [pagerMonths, pagerPlanQ]);
  const openDayPlan = openDay ? (planByMonth.get(openDay.slice(0, 7)) ?? null) : null;
  // Plegar el panel del día si deja de pertenecer a la semana visible (p. ej.
  // tras deslizar a otra semana con el día abierto). Evento y no dependencia:
  // se mira al CAMBIAR de semana, no al abrir un día (uno tocado a mitad de
  // deslizamiento se queda abierto hasta que la tira se asienta).
  const foldIfOutside = useEffectEvent((week: string) => {
    if (openDay && !weekDates(week).includes(openDay)) setOpenDay(null);
  });
  useEffect(() => {
    foldIfOutside(visibleWeek);
  }, [visibleWeek]);

  return (
    <View className="mt-6">
      <WeekPager
        today={today0}
        appStartedOn={appStartedOn}
        selected={openDay}
        onSelect={(d) => setOpenDay((prev) => (prev === d ? null : d))}
        visibleWeek={visibleWeek}
        onVisibleWeekChange={setVisibleWeek}
        logsFor={(d) => logByDate.get(d)}
      />
      <Animated.View layout={LinearTransition.duration(350).easing(EASING)}>
        {openDay ? (
          <DayPanel
            key={openDay}
            date={openDay}
            plan={openDayPlan}
            log={logByDate.get(openDay)}
            profile={profile ?? null}
            householdChildren={household?.children}
            household={
              sharedSlots
                ? {
                    sharedSlots,
                    memberCount: (household?.members ?? []).filter((m) => m.user_id).length,
                  }
                : undefined
            }
            mySlots={mySlots}
            homePlanner={homePlanner}
          />
        ) : null}
      </Animated.View>
      <Text className="font-body mt-2 px-1 text-[10.5px] text-muted-foreground">
        {openDay && openDay < todayISO() ? t("hoy.week.hintPast") : t("hoy.week.hintFuture")}
      </Text>
    </View>
  );
}

// ── Contenido del día abierto en la tira: pasado (corrección) o futuro/hoy
// (menú), con un fundido simple al cambiar de día (ticket 03 de
// hoy-semanas-editables). `key={date}` en el llamador fuerza el
// entering/exiting. `FadeIn`/`FadeOut` (solo opacidad, presets de Reanimated)
// en vez de una animación custom con `transform`: una combinada con
// `transform` colgó el hilo de UI tras varias navegaciones seguidas en el
// simulador — ver memoria `reanimated-custom-entering-hang` antes de intentar
// una de nuevo.
function DayPanel({
  date,
  plan,
  log,
  profile,
  householdChildren,
  household,
  mySlots,
  homePlanner,
}: {
  date: string;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  householdChildren?: { id: string; name: string }[];
  household?: DayDetailHousehold;
  mySlots: readonly MealSlot[];
  /** Para saber si un plato fijado lo cambió esta persona o el resto del hogar
   *  (ver `dishChangeIsMine`). */
  homePlanner: { isPlanner: boolean; sharedSlots: SharedSlots } | null;
}) {
  const { i18n } = useTranslation();
  const isPast = date < todayISO();

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
      {isPast ? (
        <View className="mt-3 rounded-3xl bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <ChevronDown size={16} color="#6dbe7b" />
            <Text className="font-body-semibold text-sm text-foreground">
              {capitalizeFirst(
                new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale(i18n.language), {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }),
              )}
            </Text>
          </View>
          <View className="mt-3">
            <DayDetailBody
              date={date}
              plan={plan}
              log={log}
              profile={profile ?? null}
              householdChildren={householdChildren}
              household={household}
            />
          </View>
        </View>
      ) : (
        <DayMenu date={date} plan={plan} selectedSlots={mySlots} homePlanner={homePlanner} />
      )}
    </Animated.View>
  );
}

// ── Menú de un día expandido ──
function DayMenu({
  date,
  plan,
  selectedSlots,
  homePlanner,
}: {
  date: string;
  plan: MonthlyPlan | null;
  selectedSlots: readonly MealSlot[];
  homePlanner: { isPlanner: boolean; sharedSlots: SharedSlots } | null;
}) {
  const { t, i18n } = useTranslation();
  const meals = mealsForDate(plan, date, selectedSlots);
  const day = planForDate(plan, date)?.day ?? null;
  const homeCtx: HouseholdPinContext | null = homePlanner
    ? { ...homePlanner, weekday: (new Date(`${date}T00:00:00`).getDay() + 6) % 7 }
    : null;
  const label = capitalizeFirst(
    new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale(i18n.language), {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );

  return (
    <View className="mt-3 rounded-3xl bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <ChevronDown size={16} color="#6dbe7b" />
        <Text className="font-body-semibold text-sm text-foreground">{label}</Text>
      </View>
      {meals.length ? (
        <View className="mt-3 gap-2">
          {meals.map((m) => (
            <Field
              key={m.slot}
              label={t(`moments.${m.moment}`, { defaultValue: m.moment })}
              value={m.idea}
              note={offListNote(m.off, t)}
              recipeMonth={date.slice(0, 7)}
              pinned={isPinnedByViewer(day, m.slot, homeCtx)}
            />
          ))}
        </View>
      ) : (
        <Text className="font-body mt-2 text-sm text-muted-foreground">{t("hoy.week.noMenu")}</Text>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  note,
  recipeMonth,
  pinned,
}: {
  label: string;
  value: string;
  note?: string | null;
  /** Si se pasa, el valor es un plato y se ofrece "Ver receta" para ese mes
   *  (salvo que `pinned` sea true). */
  recipeMonth?: string;
  /** Este plato lo eligió a mano quien mira la pantalla: no se ofrece receta. */
  pinned?: boolean;
}) {
  return (
    <View className="rounded-xl bg-secondary/60 p-3">
      <Text className="font-mono-medium text-[9.5px] uppercase tracking-widest text-muted-foreground">
        {label}
      </Text>
      <Text className="font-body mt-0.5 text-sm text-foreground">{value}</Text>
      {note ? (
        <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
          <Text className="font-body-medium text-[11px] text-foreground">{note}</Text>
        </View>
      ) : null}
      {recipeMonth && !pinned ? <DishRecipe dish={value} month={recipeMonth} /> : null}
    </View>
  );
}
