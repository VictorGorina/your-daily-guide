import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Check, CheckCircle2, ChevronDown, Flame, Sparkle, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { GuidedLogSheet } from "../../components/guided-log-sheet";
import { MonthCalendar } from "../../components/month-calendar";
import { NightlyReviewSheet } from "../../components/nightly-review-sheet";
import { WeekStrip } from "../../components/week-strip";
import { apiPost } from "../../lib/api";
import {
  ensureTodayLog,
  fetchLogs,
  fetchMonthlyPlan,
  fetchProfile,
  impulsoFrom,
  MEAL_STATUS_LABEL,
  monthISO,
  todayISO,
  updateTodayLog,
  weeklyTrendFrom,
  type DailyGuide,
  type DailyLog,
  type MealStatus,
} from "../../lib/daily";
import { fetchHousehold } from "../../lib/household";
import { sharedDays, type MealKey } from "../../lib/household-shared";
import { setPendingChatMessage } from "../../lib/pending-chat-message";
import { mealsForDate, offListNote, type MonthlyPlan } from "../../lib/plan-shared";
import { quoteOfTheDay } from "../../lib/quotes";

// Orden cronológico aproximado de cada momento, para saber cuál toca ahora.
const MOMENT_RANK: Record<string, number> = {
  Desayuno: 0,
  Comida: 1,
  Merienda: 2,
  Snack: 2,
  Cena: 3,
};
const rankOf = (label: string) => MOMENT_RANK[label] ?? 1.5;

// Solo desayuno/comida/cena pueden ser comidas compartidas del hogar (el snack no).
const MOMENT_TO_MEAL_KEY: Record<string, MealKey | undefined> = {
  Desayuno: "desayuno",
  Comida: "comida",
  Cena: "cena",
};

export default function Hoy() {
  const router = useRouter();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [expandedMeal, setExpandedMeal] = useState<number | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  const today0 = todayISO();
  const todayMeals = mealsForDate((planQ.data?.plan as MonthlyPlan | null) ?? null, today0);
  const todayWeekday = (new Date(`${today0}T00:00:00`).getDay() + 6) % 7;
  const sharedWith = (label: string) => {
    const mealKey = MOMENT_TO_MEAL_KEY[label];
    const mine = householdQ.data?.me?.shared_meals;
    if (!mealKey || !mine) return null;
    const other = (householdQ.data?.members ?? []).find(
      (m) =>
        m.user_id !== householdQ.data?.me?.user_id &&
        sharedDays(mine, m.shared_meals, mealKey).includes(todayWeekday),
    );
    return other?.display_name ?? (other ? "el resto del hogar" : null);
  };

  const todayQ = useQuery({
    queryKey: ["today"],
    queryFn: () => ensureTodayLog(todayMeals.map((m) => m.moment)),
    // Espera a que el plan mensual haya terminado de cargar (con o sin datos)
    // para crear el registro de hoy con las comidas reales del día.
    enabled: !!profileQ.data?.onboarding_completed && planQ.isFetched,
  });

  const profile = profileQ.data;
  const today = todayQ.data;

  useEffect(() => {
    if (profileQ.isFetching) return;
    if (profileQ.isSuccess && (!profile || !profile.onboarding_completed)) {
      router.replace("/onboarding");
    }
  }, [profileQ.isSuccess, profileQ.isFetching, profile, router]);

  const save = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateTodayLog(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: () => Alert.alert("No hemos podido guardar el cambio"),
  });

  const guide = today?.guide ?? null;

  const requestGuide = async () => {
    setGenerating(true);
    try {
      const g = await apiPost<DailyGuide>("guide");
      await updateTodayLog({ guide: g });
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      Alert.alert("El coach no ha podido responder ahora mismo");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (
      today &&
      !generating &&
      (!today.guide || !today.guide.meals?.length || !today.guide.tips?.length)
    )
      void requestGuide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today?.id]);

  // Abre el repaso nocturno solo (una vez por carga) si ya ha pasado la hora
  // configurada y hoy aún no se ha cerrado.
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
  // quedaron sin marcar del todo, para que no queden en limbo en el historial.
  const skipPendingMeals = () => {
    const next = habits.map((h) => (h.status ? h : { ...h, status: "salteo" as const }));
    save.mutate({ habits: next });
  };

  const impulso = impulsoFrom(logsQ.data ?? []);
  const weeklyTrend = weeklyTrendFrom(logsQ.data ?? []);
  const habits = today?.habits ?? [];
  const doneCount = habits.filter((h) => h.done).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const quote = quoteOfTheDay();

  const setMealStatus = (index: number, status: MealStatus) => {
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    save.mutate({ habits: next });
  };

  const handleMealStatus = (index: number, status: MealStatus) => {
    setMealStatus(index, status);
    // "Comí distinto" queda registrado al instante, pero ofrecemos detallar qué
    // ha cambiado para que el coach ajuste solo los días futuros del plan.
    if (status === "distinto") setGuidedIndex(index);
  };

  const guidedMeal = guidedIndex != null ? habits[guidedIndex] : undefined;

  // La "siguiente comida" es la primera, en orden cronológico, que aún no tiene
  // un estado explícito. Se filtra por `status`, no por `done`: "me lo salté"
  // deja done:false a propósito pero sí queda resuelto.
  const pending = habits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.status == null)
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));
  const nextIndex = pending.length ? pending[0]!.i : null;
  const nextMeal = nextIndex != null ? habits[nextIndex] : null;
  const nextPlanned = nextMeal ? todayMeals.find((m) => m.moment === nextMeal.label) : undefined;
  const expandedPlanned =
    expandedMeal != null
      ? todayMeals.find((m) => m.moment === habits[expandedMeal]?.label)
      : undefined;
  const nextIdea = nextPlanned?.idea;
  const allDone = habits.length > 0 && nextIndex == null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-6">
        <View className="flex-row items-center gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-sans-semibold text-muted-foreground">{greeting},</Text>
            <Text className="text-4xl font-display leading-tight text-foreground" numberOfLines={1}>
              {profile?.display_name || "Vamos allá"}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5">
            <Flame size={14} color="#f3f1ed" />
            <Text className="text-xs font-sans-bold text-background">{impulso}%</Text>
          </View>
        </View>

        <Text className="mt-2 text-sm italic leading-snug text-muted-foreground">
          “{quote.text}” — {quote.author}
        </Text>

        {/* Comidas de hoy */}
        <View className="mt-6">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-2xl font-display text-foreground">Comidas de hoy</Text>
            {habits.length ? (
              <View className="rounded-full bg-secondary px-2.5 py-1">
                <Text className="text-xs font-sans-bold text-secondary-foreground">
                  {doneCount}/{habits.length}
                </Text>
              </View>
            ) : null}
          </View>

          {!habits.length ? (
            <View className="rounded-3xl border border-border bg-surface p-5">
              <Text className="text-sm text-muted-foreground">Preparando las comidas de hoy...</Text>
            </View>
          ) : allDone ? (
            <View className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-5">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-success-soft">
                <CheckCircle2 size={20} color="#4cae64" />
              </View>
              <View className="flex-1">
                <Text className="text-lg font-sans-semibold leading-tight text-foreground">
                  Todo registrado hoy
                </Text>
                <Text className="text-sm text-muted-foreground">
                  Has anotado las {habits.length} comidas del día.
                </Text>
              </View>
            </View>
          ) : nextMeal ? (
            <View className="rounded-3xl bg-primary p-5">
              <Text className="text-[11px] font-sans-semibold uppercase tracking-wide text-primary-foreground/70">
                Siguiente · {nextMeal.label}
              </Text>
              <Text className="mt-1 text-xl font-sans-semibold leading-snug text-primary-foreground">
                {nextIdea || "Aún no hay menú para esta comida"}
              </Text>
              {offListNote(nextPlanned?.off) ? (
                <Text className="mt-1.5 text-xs text-primary-foreground/80">
                  {offListNote(nextPlanned?.off)}
                </Text>
              ) : null}
              {sharedWith(nextMeal.label) ? (
                <Text className="mt-1.5 text-xs text-primary-foreground/80">
                  Base común con {sharedWith(nextMeal.label)}. ¿Ración distinta? dilo en "comiste otra
                  cosa".
                </Text>
              ) : null}
              <Pressable
                onPress={() => setMealStatus(nextIndex!, "plan")}
                className="mt-4 w-full items-center rounded-full bg-primary-foreground py-3 active:opacity-90"
              >
                <Text className="text-sm font-sans-semibold text-primary">Comí esto</Text>
              </Pressable>
              <View className="mt-2.5 flex-row items-center justify-center gap-5">
                <Pressable onPress={() => handleMealStatus(nextIndex!, "distinto")}>
                  <Text className="text-xs font-sans-medium text-primary-foreground/80">
                    ¿comiste otra cosa?
                  </Text>
                </Pressable>
                <Pressable onPress={() => setMealStatus(nextIndex!, "salteo")}>
                  <Text className="text-xs font-sans-medium text-primary-foreground/80">me lo salté</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {habits.length ? (
            <View className="mt-3 flex-row gap-2">
              {habits.map((h, i) => {
                const isNext = i === nextIndex;
                const isDone = h.done;
                const isSkipped = h.status === "salteo";
                const container = isNext
                  ? "border-primary bg-primary-soft"
                  : isDone
                    ? "border-success bg-success-soft"
                    : isSkipped
                      ? "border-border bg-secondary"
                      : "border-border bg-surface";
                return (
                  <Pressable
                    key={h.label}
                    onPress={() => setExpandedMeal((prev) => (prev === i ? null : i))}
                    className={`flex-1 items-center rounded-2xl border px-2 py-2.5 active:opacity-80 ${container} ${
                      expandedMeal === i ? "border-primary" : ""
                    }`}
                  >
                    <Text
                      className="text-[11px] font-sans-semibold text-foreground"
                      numberOfLines={1}
                    >
                      {h.label}
                    </Text>
                    <View className="mt-0.5 flex-row items-center gap-1">
                      {isDone ? (
                        <Check size={12} color="#4cae64" />
                      ) : isSkipped ? (
                        <X size={12} color="#83796c" />
                      ) : null}
                      <Text className="text-[10px] font-sans-medium text-muted-foreground">
                        {isNext ? "ahora" : isDone ? "hecho" : isSkipped ? "saltado" : "pendiente"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {expandedMeal != null ? (
            <View className="mt-2 rounded-3xl border border-border bg-surface p-4">
              <Text className="text-sm font-sans-semibold text-foreground">
                {habits[expandedMeal]!.label}
              </Text>
              {expandedPlanned?.idea ? (
                <Text className="mt-0.5 text-xs text-muted-foreground">{expandedPlanned.idea}</Text>
              ) : null}
              {offListNote(expandedPlanned?.off) ? (
                <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
                  <Text className="text-[11px] font-sans-medium text-foreground">
                    {offListNote(expandedPlanned?.off)}
                  </Text>
                </View>
              ) : null}
              {sharedWith(habits[expandedMeal]!.label) ? (
                <Text className="mt-1.5 text-xs text-primary">
                  Base común con {sharedWith(habits[expandedMeal]!.label)} · marca "Comí distinto" si
                  tu ración se sale de eso
                </Text>
              ) : null}
              <View className="mt-3 flex-row flex-wrap gap-2">
                {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => {
                  const active = habits[expandedMeal]!.status === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => {
                        handleMealStatus(expandedMeal, s);
                        setExpandedMeal(null);
                      }}
                      className={`rounded-full border px-3 py-1.5 active:opacity-80 ${
                        active ? "border-foreground bg-foreground" : "border-input"
                      }`}
                    >
                      <Text
                        className={`text-xs font-sans-semibold ${
                          active ? "text-background" : "text-muted-foreground"
                        }`}
                      >
                        {MEAL_STATUS_LABEL[s]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>

        {/* Guía del coach */}
        <View className="mt-4">
          <Pressable
            onPress={() => setGuideOpen((o) => !o)}
            className="flex-row items-center justify-between rounded-2xl border border-dashed border-border px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <Sparkle size={14} color="#6dbe7b" />
              <Text className="text-xs font-sans-medium text-muted-foreground">
                Guía del coach{guide?.calories ? ` · ${guide.calories}` : ""}
              </Text>
            </View>
            <View style={{ transform: [{ rotate: guideOpen ? "180deg" : "0deg" }] }}>
              <ChevronDown size={16} color="#83796c" />
            </View>
          </Pressable>
          {guideOpen ? (
            <View className="mt-2 rounded-3xl border border-border bg-surface p-5">
              {generating || (!guide && todayQ.isLoading) ? (
                <Text className="text-sm text-muted-foreground">Preparando tu guía del día...</Text>
              ) : guide ? (
                <View className="gap-3">
                  <Text className="text-sm leading-relaxed text-foreground">{guide.intro}</Text>
                  <View className="gap-2">
                    <Field label="Energía" value={guide.calories} />
                    <Field label="Macros" value={guide.macros} />
                  </View>
                  {guide.meals?.length ? (
                    <View className="gap-2 pt-1">
                      <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
                        Platos sugeridos
                      </Text>
                      {guide.meals.map((m) => (
                        <View
                          key={m.moment}
                          className="flex-row gap-3 rounded-xl border border-border bg-surface p-3"
                        >
                          <Text className="text-xs font-sans-semibold text-primary">{m.moment}</Text>
                          <Text className="flex-1 text-sm text-foreground">{m.idea}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {guide.tips?.length ? (
                    <View className="gap-1.5 pt-1">
                      <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
                        Consejos de nutrición
                      </Text>
                      {guide.tips.map((t) => (
                        <View key={t} className="flex-row gap-2">
                          <View className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                          <Text className="flex-1 text-sm text-foreground">{t}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <Pressable onPress={requestGuide}>
                  <Text className="text-sm font-sans-medium text-primary">Generar guía</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        {/* Tira de la semana */}
        <View className="mt-6">
          <WeekStrip
            done={doneCount}
            total={habits.length}
            selected={openDay}
            onSelect={(d) => setOpenDay((prev) => (prev === d ? null : d))}
            logs={logsQ.data ?? []}
            todayHabits={
              habits.length ? habits.map((h) => h.label) : todayMeals.map((m) => m.moment)
            }
          />
          {openDay ? (
            <DayMenu date={openDay} plan={(planQ.data?.plan as MonthlyPlan | null) ?? null} />
          ) : null}
          <Text className="mt-2 px-1 text-[11px] text-muted-foreground">
            Toca un día para ver su menú.
          </Text>
        </View>

        {/* Calendario del mes */}
        <View className="mt-4">
          <Pressable
            onPress={() => setCalendarOpen((o) => !o)}
            className="flex-row items-center justify-between rounded-2xl border border-dashed border-border px-4 py-3"
          >
            <Text className="text-xs font-sans-medium text-muted-foreground">Ver calendario del mes</Text>
            <View style={{ transform: [{ rotate: calendarOpen ? "180deg" : "0deg" }] }}>
              <ChevronDown size={16} color="#83796c" />
            </View>
          </Pressable>
          {calendarOpen ? (
            <MonthCalendar
              logs={logsQ.data ?? []}
              plan={(planQ.data?.plan as MonthlyPlan | null) ?? null}
              planHabits={
                habits.length ? habits.map((h) => h.label) : todayMeals.map((m) => m.moment)
              }
            />
          ) : null}
        </View>
      </ScrollView>

      <GuidedLogSheet
        initialMode="exceso"
        open={guidedIndex != null}
        onOpenChange={(v) => {
          if (!v) setGuidedIndex(null);
        }}
        contextNote={guidedMeal ? `Qué has comido en vez de: ${guidedMeal.label}` : undefined}
        onSend={(text) => {
          setPendingChatMessage(text);
          setGuidedIndex(null);
          router.navigate("/chat");
        }}
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

function DayMenu({ date, plan }: { date: string; plan: MonthlyPlan | null }) {
  const meals = mealsForDate(plan, date).filter((m) => m.idea);
  const label = new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <View className="mt-3 rounded-3xl border border-border bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <ChevronDown size={16} color="#6dbe7b" />
        <Text className="text-sm font-sans-semibold capitalize text-foreground">{label}</Text>
      </View>
      {meals.length ? (
        <View className="mt-3 gap-2">
          {meals.map((m) => (
            <Field key={m.slot} label={m.moment} value={m.idea} note={offListNote(m.off)} />
          ))}
        </View>
      ) : (
        <Text className="mt-2 text-sm text-muted-foreground">
          Aún no hay menú para este día. Crea tu plan del mes en la pestaña Plan.
        </Text>
      )}
    </View>
  );
}

function Field({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <View className="rounded-xl bg-secondary/60 p-3">
      <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Text>
      <Text className="mt-0.5 text-sm text-foreground">{value}</Text>
      {note ? (
        <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
          <Text className="text-[11px] font-sans-medium text-foreground">{note}</Text>
        </View>
      ) : null}
    </View>
  );
}
