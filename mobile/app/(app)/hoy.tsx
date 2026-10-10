import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdjustmentInfoSheet } from "../../components/adjustment-info-sheet";
import { BottomNav } from "../../components/bottom-nav";
import { ExerciseSheet } from "../../components/exercise-sheet";
import { DayBalanceSection } from "../../components/hoy/day-balance-section";
import { HoyHeader, MacroSection } from "../../components/hoy/day-summary";
import { MealStrip } from "../../components/hoy/meal-strip";
import { WeekSection } from "../../components/hoy/week-section";
import { MealSwapSheet } from "../../components/meal-swap-sheet";
import { NightlyReviewSheet } from "../../components/nightly-review-sheet";
import { SnackSheet } from "../../components/snack-sheet";
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
} from "../../lib/daily";
import { addMacros, showsNutritionNumbers, sumDoneMacros, ZERO_MACROS } from "../../lib/macros";
import { energyTargets, targetsAsMacros } from "../../lib/energy";
import { learnedPortionSize, portionSizeHistory } from "../../lib/portion";
import { fetchHousehold, householdSharedSlots } from "../../lib/household";
import {
  dishChangeIsMine,
  effectiveMealSlots,
  mealsForDate,
  type MonthlyPlan,
} from "../../lib/plan-shared";
import { quoteIndexOfTheDay } from "../../lib/quotes";
import { snackTotals } from "../../lib/snacks";
import { MOMENT_TO_MEAL_KEY } from "../../lib/today-meals";
import { useDayExtras } from "../../lib/use-day-extras";
import { useDayReconcile } from "../../lib/use-day-reconcile";
import { useGuideAutoGeneration, useGuideTargetsSync } from "../../lib/use-guide-auto-generation";
import { useMealSwap } from "../../lib/use-meal-swap";
import { useTimezoneSync } from "../../lib/use-timezone-sync";

export default function Hoy() {
  const router = useRouter();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  /** Hoja con TODO lo que el día ha movido en los próximos días. */
  const [balanceInfoOpen, setBalanceInfoOpen] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);

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
  const plan = (planQ.data?.plan as MonthlyPlan | null) ?? null;
  // Cinturón extra sobre el filtro por contenido de `mealsForDate`: si el
  // plato de hoy vino espejado de una comida compartida del hogar (que no
  // sabe de las preferencias de cada persona), esto lo descarta igual cuando
  // esta persona no planifica ese slot.
  const mySlots = effectiveMealSlots(profileQ.data ?? {});
  const todayMeals = mealsForDate(plan, today0, mySlots);
  const todayWeekday = (new Date(`${today0}T00:00:00`).getDay() + 6) % 7;
  // Base para `dishChangeIsMine`: en un hogar compartido, un plato que cambia
  // quien planifica no es un cambio "a mano" para el resto, así que no debe
  // quitarles la receta.
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

  useEffect(() => {
    if (profileQ.isFetching) return;
    if (profileQ.isSuccess && (!profile || !profile.onboarding_completed)) {
      router.replace("/onboarding");
    }
  }, [profileQ.isSuccess, profileQ.isFetching, profile, router]);

  useTimezoneSync(profile);

  const save = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateTodayLog(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: () => Alert.alert(t("hoy.errors.saveFailed")),
  });

  const guide = today?.guide ?? null;

  const { generating, requestGuide } = useGuideAutoGeneration({
    today,
    todayMeals,
    date: today0,
  });

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
  // (ticket 07): si el plan de hoy suma muy por debajo, se dice.
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
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    save.mutate({ habits: next });
  };

  const mealSwap = useMealSwap(
    () => todayQ.data,
    () => planQ.data?.plan ?? null,
    mySlots,
  );

  /**
   * "Deshacer" de una comida: quita el estado ("comí esto" / "comí otra cosa")
   * y, si el plato se había cambiado a mano, devuelve además el plato del plan
   * — con lo que "Ver receta" vuelve a aparecer sola, porque la receta se
   * oculta justamente por no ser ya el plato del plan. `revert` deshace también
   * lo que ese cambio hubiera movido en los días futuros.
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
      if (!restored) clearStatus();
    });
  };

  // Datos para el sheet de cambio.
  const swapMeal =
    swapIndex != null ? todayMeals.find((m) => m.moment === habits[swapIndex]?.label) : undefined;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-52 pt-4"
        directionalLockEnabled
      >
        <HoyHeader impulso={impulso} />

        {/* ── Barras de macros y guía del coach ── */}
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

        {/* ── Comidas de hoy ── */}
        <MealStrip
          habits={habits}
          todayMeals={todayMeals}
          mealMacros={guide?.mealMacros}
          showNumbers={showNumbers}
          date={today0}
          month={month}
          plan={plan}
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

        {/* ── Picoteo, deporte y balance del día ── */}
        <DayBalanceSection
          showNumbers={showNumbers}
          extras={extras}
          onAddSnack={() => setSnackOpen(true)}
          onAddExercise={() => setActivityOpen(true)}
          onShowAdjustment={() => setBalanceInfoOpen(true)}
        />

        {/* ── Tira de la semana ── */}
        <WeekSection
          today={today0}
          profile={profile}
          household={householdQ.data}
          sharedSlots={sharedSlots}
          mySlots={mySlots}
          homePlanner={homePlanner}
        />

        {/* ── Cita ── */}
        <View className="mt-6 px-0.5">
          <Text
            className="font-heading text-muted-foreground"
            style={{ fontSize: 14, lineHeight: 20, letterSpacing: -0.1 }}
          >
            "{t(`quotes.${quoteIndex}.text`)}"
          </Text>
          <Text className="font-mono-medium mt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/60">
            {t(`quotes.${quoteIndex}.author`)}
          </Text>
        </View>
      </ScrollView>

      {/* ── FAB de chat: pegado justo encima de la barra de pestañas ── */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("chat.fab.open")}
        onPress={() => router.navigate("/chat")}
        className="absolute bottom-32 right-5 h-14 w-14 items-center justify-center rounded-full active:opacity-90"
        style={{
          backgroundColor: "#ff8a3d",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 18,
          elevation: 8,
        }}
      >
        <ChatBubbleIcon />
      </Pressable>

      {/* Cambio de plato directo, igual que en la web: el plato cambia al
          instante (plan/meal, sin IA) y el reajuste de los días futuros va en un
          lote en segundo plano. Antes esto mandaba al chat del coach. */}
      <MealSwapSheet
        showNumbers={showNumbers}
        defaultSize={learnedSize}
        open={swapIndex != null}
        onOpenChange={(v) => {
          if (!v) setSwapIndex(null);
        }}
        mealLabel={swapMeal?.moment ?? ""}
        plannedDish={swapMeal?.idea ?? ""}
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
    </SafeAreaView>
  );
}

function ChatBubbleIcon() {
  return <MessageCircle size={22} color="#3e3d39" />;
}
