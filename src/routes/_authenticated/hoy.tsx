import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AdjustmentInfoSheet } from "@/components/adjustment-info-sheet";
import { BottomNav } from "@/components/bottom-nav";
import { ExerciseSheet } from "@/components/exercise-sheet";
import { DayBalanceSection } from "@/components/hoy/day-balance-section";
import { HoyHeader, MacroSection } from "@/components/hoy/day-summary";
import { MealStrip } from "@/components/hoy/meal-strip";
import { WeekSection } from "@/components/hoy/week-section";
import { MealSwapSheet } from "@/components/meal-swap-sheet";
import { NightlyReviewSheet } from "@/components/nightly-review-sheet";
import { SnackSheet } from "@/components/snack-sheet";
import {
  ensureTodayLog,
  fetchLogs,
  fetchMonthlyPlan,
  fetchProfile,
  impulsoFrom,
  fetchTodayLog,
  monthISO,
  todayISO,
  updateTodayLog,
  weeklyTrendFrom,
  type DailyLog,
  type MealStatus,
} from "@/lib/daily";

import { energyTargets, targetsAsMacros } from "@/lib/nutrition/energy";
import { learnedPortionSize, portionSizeHistory } from "@/lib/nutrition/portion";
import { addMacros, showsNutritionNumbers, sumDoneMacros, ZERO_MACROS } from "@/lib/macros";
import { weekdayIndex } from "@/lib/dates";
import { fetchHousehold, householdSharedSlots } from "@/lib/household";
import { dishChangeIsMine, effectiveMealSlots, mealsForDate } from "@/lib/plan-shared";
import { snackTotals } from "@/lib/snacks";
import { MOMENT_TO_MEAL_KEY } from "@/lib/today-meals";
import { useDayExtras } from "@/lib/use-day-extras";
import { useDayReconcile } from "@/lib/use-day-reconcile";
import { useGuideAutoGeneration, useGuideTargetsSync } from "@/lib/use-guide-auto-generation";
import { useMealSwap } from "@/lib/use-meal-swap";
import { useTimezoneSync } from "@/lib/use-timezone-sync";
import { applyTheme } from "@/lib/theme";
import { quoteIndexOfTheDay } from "@/lib/quotes";

export const Route = createFileRoute("/_authenticated/hoy")({
  component: Hoy,
});

function Hoy() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activityOpen, setActivityOpen] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);
  /** Hoja con TODO lo que el día ha movido en los próximos días. */
  const [balanceInfoOpen, setBalanceInfoOpen] = useState(false);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);
  // ---- Cambio de plato directo (sin pasar por el chat del coach) ----
  const [swapIndex, setSwapIndex] = useState<number | null>(null);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  // Qué comidas comparte la mesa: la regla del servidor (horarios de cada
  // persona), no `household.shared_slots` a pelo.
  const sharedSlots = householdSharedSlots(householdQ.data);

  // Sin plan del mes en curso, Hoy no lo genera por su cuenta: un mes se
  // genera UNA vez y tras la conversación con el coach (pantalla Plan,
  // `MonthIntakeChat`). Aquí solo se invita a ir a prepararlo.
  const noPlanYet = planQ.isFetched && !planQ.data;

  const today0 = todayISO();
  // Cinturón extra sobre el filtro por contenido de `mealsForDate`: si el
  // plato de hoy vino espejado de una comida compartida del hogar (que no
  // sabe de las preferencias de cada persona), esto lo descarta igual cuando
  // esta persona no planifica ese slot.
  const mySlots = effectiveMealSlots(profileQ.data ?? {});
  const todayMeals = mealsForDate(planQ.data?.plan ?? null, today0, mySlots);
  const todayWeekday = weekdayIndex(today0);
  // Base para `dishChangeIsMine`/`isPinnedByViewer` (issue: en un hogar
  // compartido, un plato fijado o cambiado por quien planifica se veía como
  // "cambiado a mano" también para el resto, y les ocultaba "Ver receta" sin
  // que ellos hubieran tocado nada).
  const homePlanner = sharedSlots
    ? { isPlanner: !!householdQ.data?.me?.is_planner, sharedSlots }
    : null;
  const homeCtxFor = (weekday: number) => (homePlanner ? { ...homePlanner, weekday } : null);
  const todayQ = useQuery({
    queryKey: ["today"],
    queryFn: () => ensureTodayLog(todayMeals.map((m) => m.moment)),
    // Solo con plan: sin él, el registro de hoy nacería con comidas vacías.
    // Hoy invita a prepararlo (ver `noPlanYet`) y se crea al volver.
    enabled: !!profileQ.data?.onboarding_completed && planQ.isFetched && !!planQ.data,
  });

  const profile = profileQ.data;
  // Ticket 01: la persona decide si ve cifras. Se calculan igual; solo cambia
  // lo que se enseña.
  const showNumbers = showsNutritionNumbers(profile);
  // Ticket 07: el objetivo del día sale del perfil, en código, y es la única
  // cifra de objetivo en pantalla (barra, texto de la guía y semáforo).
  const energy = useMemo(() => energyTargets(profile), [profile]);
  const dayTarget = energy ? targetsAsMacros(energy) : null;
  const today = todayQ.data;
  // Sin plan el registro de hoy no se crea (arriba), pero puede existir ya:
  // picoteo y deporte lo crean al guardar. Se lee sin crearlo y alimenta SOLO
  // sus tarjetas y el balance; las comidas y la guía siguen saliendo de `today`.
  const noPlanTodayQ = useQuery({
    queryKey: ["today", "no-plan"],
    queryFn: fetchTodayLog,
    enabled: !!profileQ.data?.onboarding_completed && noPlanYet,
  });
  const dayExtras = today ?? (noPlanYet ? noPlanTodayQ.data : null);

  const mealSwap = useMealSwap(
    () => todayQ.data,
    () => planQ.data?.plan ?? null,
    mySlots,
  );

  useEffect(() => {
    if (profileQ.isFetching) return;
    if (profileQ.isSuccess && (!profile || !profile.onboarding_completed)) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [profileQ.isSuccess, profileQ.isFetching, profile, navigate]);

  useEffect(() => {
    if (profile?.theme) applyTheme(profile.theme);
  }, [profile?.theme]);

  useTimezoneSync(profile);

  const save = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateTodayLog(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: () => toast.error(t("hoy.errors.saveFailed")),
  });

  const guide = today?.guide ?? null;

  const { generating, requestGuide } = useGuideAutoGeneration({
    today,
    todayMeals,
    date: today0,
  });

  // Abre el repaso nocturno solo (una vez por carga) si ya ha pasado la hora
  // configurada y hoy aún no se ha cerrado. Se asume la hora local del
  // dispositivo — la app es de uso en España, sin campo de zona horaria.
  useEffect(() => {
    if (nightlyAutoOpenedRef.current || !profile?.evening_time || !today) return;
    const [h, m] = profile.evening_time.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes >= h * 60 + m && !today.evening_done) {
      nightlyAutoOpenedRef.current = true;
      setNightlyOpen(true);
    }
  }, [profile?.evening_time, today]);

  const finishNightlyReview = () => {
    save.mutate({ evening_done: true });
    setNightlyOpen(false);
  };

  // "Hoy paso de estas": cierra en bloque, como saltadas, las comidas que se
  // quedaron sin marcar del todo (ni plan, ni distinto, ni salteo explícito)
  // para que no queden en limbo indefinidamente en el historial. Es un cierre
  // neutro, no un fallo — mismo tono que el resto del repaso nocturno.
  const skipPendingMeals = () => {
    const next = habits.map((h) => (h.status ? h : { ...h, status: "salteo" as const }));
    save.mutate({ habits: next });
  };

  const impulso = impulsoFrom(logsQ.data ?? []);
  // El tamaño que suele elegir en "comí distinto" (ticket 17).
  const learnedSize = learnedPortionSize(portionSizeHistory(logsQ.data ?? []));
  const weeklyTrend = weeklyTrendFrom(logsQ.data ?? []);
  // El registro del día, casado con las comidas que esta persona planifica de
  // verdad (y reparado en segundo plano si la fila guardada no coincide).
  const habits = useDayReconcile(today, todayMeals, !todayQ.isFetching && !planQ.isFetching);
  // La barra de macros suma solo lo ya marcado como comido ("comí esto" /
  // "comí distinto"), no el menú completo del día: así deshacer una comida
  // la mueve, en vez de quedarse fija en un total del día entero. Se muestra
  // siempre (arrancando en 0) para que se vea cómo se va llenando según se
  // marcan comidas, en vez de aparecer de golpe con la primera.
  const extras = useDayExtras(today0, habits, dayExtras);
  const { snacks, balance, balanceChanges, afterDayChange } = extras;
  const doneMacros = addMacros(
    sumDoneMacros(guide?.mealMacros, habits) ?? ZERO_MACROS,
    snackTotals(snacks),
  );
  // Los planes ya generados se hicieron antes de que existiera el objetivo
  // (ticket 07): si lo que el plan de hoy suma se queda muy por debajo, se dice
  // en vez de dejar que la barra parezca un fallo de la persona.
  // Solo en un plan anterior al ticket 23 (sin objetivo por comida ni
  // estructura): uno nuevo que se quede corto no se "preparó antes".
  const planShortOfTarget =
    !!dayTarget &&
    !!guide?.macroEstimate &&
    !planQ.data?.plan?.targetsVersion &&
    guide.macroEstimate.kcal < dayTarget.kcal * 0.85;

  useGuideTargetsSync(today, dayTarget, generating);

  const quoteIndex = quoteIndexOfTheDay();

  const setMealStatus = (index: number, status: MealStatus) => {
    const confirmed = status === "plan" || status === "distinto";
    const next = habits.map((h, i) =>
      i === index
        ? {
            ...h,
            status,
            done: confirmed,
            // Contra qué plato del plan se confirmó — ver `confirmedIdea` en
            // plan-shared.ts.
            confirmedIdea: confirmed
              ? (todayMeals.find((m) => m.moment === h.label)?.idea ?? h.confirmedIdea)
              : h.confirmedIdea,
          }
        : h,
    );
    save.mutate({ habits: next });
  };

  /**
   * "Deshacer" de una comida: quita el estado ("comí esto" / "comí otra cosa")
   * y, si el plato se había cambiado a mano, devuelve además el plato del plan
   * — con lo que "Ver receta" vuelve a aparecer sola, porque la receta se
   * oculta justamente por no ser ya el plato del plan. `revert` se encarga de
   * deshacer también lo que ese cambio hubiera movido en los días futuros.
   */
  const clearMealStatus = (index: number) => {
    const habit = habits[index];
    if (!habit) return;
    const slot = todayMeals.find((m) => m.moment === habit.label)?.slot;
    const mealKey = MOMENT_TO_MEAL_KEY[habit.label] ?? "snack";
    // En un slot compartido del hogar, un no planificador no puede escribir el
    // plato (`guardSharedSlotWrite`): ahí "Deshacer" solo limpia su registro.
    const canRestore = !!slot && dishChangeIsMine(mealKey, homeCtxFor(todayWeekday));
    const clearStatus = () => {
      const next = habits.map((h, i) =>
        i === index ? { ...h, status: undefined, done: false, confirmedIdea: undefined } : h,
      );
      save.mutate({ habits: next });
    };
    if (!canRestore) {
      clearStatus();
      return;
    }
    void mealSwap.revert(habit.label, slot).then((restored) => {
      // `null` = no había plato que restaurar: se limpia el estado a secas.
      if (!restored) clearStatus();
    });
  };

  // Datos para el swap sheet
  const swapMeal =
    swapIndex != null ? todayMeals.find((m) => m.moment === habits[swapIndex]?.label) : undefined;

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-44 pt-12 font-ui">
      <HoyHeader today={today0} impulso={impulso} />

      <MacroSection
        showNumbers={showNumbers}
        doneMacros={doneMacros}
        dayTarget={dayTarget}
        planShortOfTarget={planShortOfTarget}
        guide={guide}
        habits={habits}
        profile={profile}
        energy={energy}
        generating={generating}
        loading={todayQ.isLoading}
        requestGuide={() => void requestGuide()}
      />

      <MealStrip
        habits={habits}
        todayMeals={todayMeals}
        mealMacros={guide?.mealMacros}
        showNumbers={showNumbers}
        date={today0}
        month={month}
        plan={planQ.data?.plan ?? null}
        household={householdQ.data}
        sharedSlots={sharedSlots}
        homePlanner={homePlanner}
        noPlanYet={noPlanYet}
        loadFailed={todayQ.isError}
        onRetry={() => todayQ.refetch()}
        isAdjusting={mealSwap.isAdjusting}
        onEdit={setSwapIndex}
        onAte={(i) => setMealStatus(i, "plan")}
        onClear={clearMealStatus}
      />

      <DayBalanceSection
        showNumbers={showNumbers}
        extras={extras}
        onAddSnack={() => setSnackOpen(true)}
        onAddExercise={() => setActivityOpen(true)}
        onShowAdjustment={() => setBalanceInfoOpen(true)}
      />

      <WeekSection
        today={today0}
        profile={profile}
        household={householdQ.data}
        sharedSlots={sharedSlots}
        mySlots={mySlots}
        homePlanner={homePlanner}
      />

      <section className="mt-6 px-0.5">
        <p className="font-title text-sm leading-[1.45] tracking-[-0.01em] text-pretty text-muted-foreground">
          "{t(`quotes.${quoteIndex}.text`)}"
        </p>
        <p className="mt-1.5 font-num text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {t(`quotes.${quoteIndex}.author`)}
        </p>
      </section>

      {/* Cambio de plato directo: mini-sheet con solo texto libre. El swap
          se aplica al instante (setPlanMeal) y el ajuste del plan futuro corre
          en segundo plano (adjustMonthlyPlan) — sin navegar al chat. */}
      <MealSwapSheet
        showNumbers={showNumbers}
        defaultSize={learnedSize}
        open={swapIndex != null}
        onOpenChange={(v) => {
          if (!v) setSwapIndex(null);
        }}
        mealLabel={swapMeal?.moment ?? ""}
        plannedDish={swapMeal?.idea ?? ""}
        // Solo bloquea mientras se guarda ESTA comida (un ida y vuelta), no
        // mientras se reajusta el plan: antes el flag era de la mutación entera
        // y había que esperar a la IA para poder tocar la comida siguiente.
        disabled={mealSwap.isSaving(swapMeal?.moment ?? "")}
        onSwap={async (dish, opts) => {
          if (!swapMeal) return { ok: true };
          // La hoja espera a que el plato quede guardado: si el texto es vago,
          // se queda abierta pidiendo concretar (ticket 13).
          return mealSwap.swap(swapMeal.moment, swapMeal.slot, dish, opts);
        }}
        onSkip={() => {
          if (swapIndex != null) setMealStatus(swapIndex, "salteo");
          setSwapIndex(null);
        }}
      />

      {/* Todo lo que el día ha movido en los próximos días: antes → después. */}
      <AdjustmentInfoSheet
        open={balanceInfoOpen}
        onOpenChange={setBalanceInfoOpen}
        changes={balanceChanges}
        kcalDelta={showNumbers ? balance.net : null}
      />

      <SnackSheet
        showNumbers={showNumbers}
        open={snackOpen}
        onOpenChange={setSnackOpen}
        today={today0}
        onSaved={afterDayChange}
      />

      <ExerciseSheet
        showNumbers={showNumbers}
        weightKg={profile?.current_weight_kg ?? null}
        hasRoutine={!!energy && !energy.basis.legacyActivity && energy.basis.routineKcal > 0}
        open={activityOpen}
        onOpenChange={setActivityOpen}
        today={today0}
        onSaved={afterDayChange}
      />

      <NightlyReviewSheet
        open={nightlyOpen}
        onOpenChange={setNightlyOpen}
        habits={habits}
        impulso={impulso}
        weeklyTrend={weeklyTrend}
        tone={profile?.tone}
        onDone={finishNightlyReview}
        onSkipPending={skipPendingMeals}
      />

      <BottomNav />
    </main>
  );
}
