import { useQueries } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DayDetailBody, type DayDetailHousehold } from "@/components/day-detail-sheet";
import { DishRecipe } from "@/components/dish-recipe";
import { DishCategoryIcon, foodBgStyle, FoodCategoryBadge } from "@/components/food-category-bg";
import { WeekPager } from "@/components/week-pager";
import {
  fetchLogsForMonth,
  fetchMonthlyPlan,
  todayISO,
  type DailyLog,
  type Profile,
} from "@/lib/daily";
import { weekdayIndex } from "@/lib/dates";
import type { HouseholdState } from "@/lib/household";
import type { SharedSlots } from "@/lib/household-shared";
import { dateLocale } from "@/lib/i18n";
import {
  capitalizeFirst,
  isPinnedByViewer,
  mealsForDate,
  offListNote,
  planForDate,
  type HouseholdPinContext,
  type MealSlot,
  type MonthlyPlan,
} from "@/lib/plan-shared";
import { useLatest } from "@/lib/use-latest";
import { monthsOfWeek, weekDates, weekStartOf } from "@/lib/week-nav";

// Misma curva que el resto de la app (docs/design-guidelines.md §7) y que
// `week-pager.tsx`, para que el panel del día y la tira se muevan igual.
const EASE = [0.22, 1, 0.36, 1] as const;

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
  // Dirección (izquierda/derecha) del último cambio de día abierto en la
  // tira, para que el panel entre desde el lado del día tocado (ver
  // `DayPanel` más abajo). Se fija al tocar un día nuevo; da igual mientras
  // `openDay` sea null.
  const [dayDir, setDayDir] = useState(1);
  const appStartedOn = profile?.app_started_on ?? null;

  // Meses que puede llegar a pisar la tira: la semana visible y sus dos
  // vecinas (lo que `WeekPager` puede llegar a pintar con su ventana de ±2),
  // para que deslizar hasta el borde de un mes no se quede sin datos. Solo
  // cambia cuando cambia de semana, no en cada frame de scroll.
  const pagerMonths = useMemo(() => {
    const months = new Set([
      ...monthsOfWeek(visibleWeek),
      ...monthsOfWeek(weekDates(visibleWeek)[0]),
      ...monthsOfWeek(weekDates(visibleWeek)[6]),
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

  const onSelectDay = (d: string) => {
    if (openDay === d) {
      setOpenDay(null);
      return;
    }
    if (openDay) setDayDir(d > openDay ? 1 : -1);
    setOpenDay(d);
  };
  // Plegar el panel del día si deja de pertenecer a la semana visible (p. ej.
  // tras deslizar a otra semana con el día abierto). El día abierto se lee por
  // ref: se mira al CAMBIAR de semana, no al abrir un día (uno tocado a mitad
  // de deslizamiento se queda abierto hasta que la tira se asienta).
  const latestOpenDay = useLatest(openDay);
  useEffect(() => {
    const open = latestOpenDay.current;
    if (open && !weekDates(visibleWeek).includes(open)) setOpenDay(null);
  }, [visibleWeek, latestOpenDay]);

  return (
    <section className="animate-rise mt-6">
      <WeekPager
        today={today0}
        appStartedOn={appStartedOn}
        selected={openDay}
        onSelect={onSelectDay}
        visibleWeek={visibleWeek}
        onVisibleWeekChange={setVisibleWeek}
        logsFor={(d) => logByDate.get(d)}
      />
      <motion.div layout transition={{ duration: 0.35, ease: EASE }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {openDay ? (
            <DayPanel
              key={openDay}
              date={openDay}
              direction={dayDir}
              plan={planByMonth.get(openDay.slice(0, 7)) ?? null}
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
        </AnimatePresence>
      </motion.div>
      <p className="mt-2.5 px-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
        {openDay && openDay < todayISO() ? t("hoy.week.hintPast") : t("hoy.week.hintFuture")}
      </p>
    </section>
  );
}

// ── Contenido del día abierto en la tira: pasado (corrección) o futuro/hoy
// (menú), con un deslizamiento simple al cambiar de día (ticket 04 de
// hoy-semanas-editables). `key={date}` en el llamador fuerza el
// entrar/salir de `AnimatePresence`; `direction` decide desde qué lado entra
// (mismo criterio que la etiqueta de `WeekPager`: día posterior entra desde
// la derecha, anterior desde la izquierda).
function DayPanel({
  date,
  direction,
  plan,
  log,
  profile,
  householdChildren,
  household,
  mySlots,
  homePlanner,
}: {
  date: string;
  direction: number;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  householdChildren?: { id: string; name: string }[];
  household?: DayDetailHousehold;
  mySlots: readonly MealSlot[];
  /** Para saber si un plato compartido fijado lo cambió esta persona o el
   *  resto del hogar (ver `dishChangeIsMine`). */
  homePlanner: { isPlanner: boolean; sharedSlots: SharedSlots } | null;
}) {
  const { i18n } = useTranslation();
  const isPast = date < todayISO();

  return (
    <motion.div
      initial={{ opacity: 0, x: direction * 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -direction * 12 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {isPast ? (
        <div className="mt-3 rounded-2xl bg-surface p-4">
          <p className="mb-3 text-xs font-semibold text-foreground">
            {capitalizeFirst(
              new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale(i18n.language), {
                weekday: "long",
                day: "numeric",
                month: "long",
              }),
            )}
          </p>
          <DayDetailBody
            date={date}
            plan={plan}
            log={log}
            profile={profile}
            householdChildren={householdChildren}
            household={household}
          />
        </div>
      ) : (
        <DayMenu date={date} plan={plan} selectedSlots={mySlots} homePlanner={homePlanner} />
      )}
    </motion.div>
  );
}

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
  // Mismas comidas que ve el día en su tarjeta (con los platos cambiados a mano
  // para ese día), no la lista entera de desayunos de la semana.
  const meals = mealsForDate(plan, date, selectedSlots);
  // Día crudo del plan, para saber qué slots están fijados a mano (`pinned`) y
  // no ofrecerles receta: ya se sabe qué se va a comer, así que enseñarla solo
  // gastaría una llamada a la IA sin aportar nada — salvo que el cambio lo
  // haya hecho otra persona del hogar (`isPinnedByViewer`).
  const day = planForDate(plan, date)?.day ?? null;
  const weekday = weekdayIndex(date);
  const homeCtx: HouseholdPinContext | null = homePlanner ? { ...homePlanner, weekday } : null;
  const label = capitalizeFirst(
    new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale(i18n.language), {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );

  return (
    <div className="surface-card animate-sheet-up mt-3 p-4">
      <div className="flex items-center gap-2">
        <ChevronDown className="h-4 w-4 text-primary-ink" />
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      {meals.length ? (
        <div className="mt-3 space-y-2">
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
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t("hoy.week.noMenu")}</p>
      )}
    </div>
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
  /** Este plato se eligió a mano (`setPlanMeal`): no se ofrece receta. */
  pinned?: boolean;
}) {
  const bgStyle = recipeMonth ? foodBgStyle(value) : {};
  return (
    <div className="rounded-xl bg-secondary/60 p-3" style={bgStyle}>
      <div className="flex items-start gap-2.5">
        {recipeMonth ? <DishCategoryIcon dish={value} size={16} className="mt-0.5" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-num text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </span>
            {recipeMonth ? <FoodCategoryBadge dish={value} /> : null}
          </div>
          <p className="mt-0.5 text-sm text-foreground">{value}</p>
          {note ? (
            <span className="mt-1.5 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
              {note}
            </span>
          ) : null}
          {recipeMonth && !pinned ? <DishRecipe dish={value} month={recipeMonth} /> : null}
        </div>
      </div>
    </div>
  );
}
