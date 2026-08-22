import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Check, CheckCircle2, ChevronDown, MessageCircle, RefreshCw, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { GuidedLogSheet } from "../../components/guided-log-sheet";
import { NightlyReviewSheet } from "../../components/nightly-review-sheet";
import { WeekStrip } from "../../components/week-strip";
import { classifyDish, FOOD_CATEGORIES } from "../../lib/food-categories";
import { apiPost } from "../../lib/api";
import {
  ensureTodayLog,
  fetchLogs,
  fetchMonthlyPlan,
  fetchProfile,
  impulsoFrom,
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
import {
  mealsForDate,
  offListNote,
  type MonthlyPlan,
  type ShoppingList,
} from "../../lib/plan-shared";
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

// Fecha formateada en español
function formatDate(): string {
  return new Date()
    .toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(",", "");
}

// Mezcla un color accent con el fondo a un porcentaje
function tintBg(accent: string, pct: number): string {
  // Aproximación: convertir hex a rgba con opacidad
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${pct / 100})`;
}

export default function Hoy() {
  const router = useRouter();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);
  const autoPlanTriedRef = useRef(false);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  // Si al entrar no hay plan del mes en curso, se genera solo: la persona no
  // tiene que ir a la pestaña Plan a pulsar el botón. `ensureTodayLog` espera
  // a que esto termine (ver `enabled` de `todayQ` más abajo) para no crear el
  // registro de hoy con comidas vacías mientras se genera.
  const noPlanYet = planQ.isFetched && !planQ.data;
  const autoPlan = useMutation({
    mutationFn: () =>
      apiPost<{ plan: MonthlyPlan; shopping: ShoppingList }>("plan/generate", { month }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) => {
      Alert.alert(
        e instanceof Error
          ? e.message
          : "No hemos podido crear tu plan del mes. Puedes crearlo desde la pestaña Plan.",
      );
    },
  });
  useEffect(() => {
    if (!profileQ.data?.onboarding_completed || !noPlanYet || autoPlanTriedRef.current) return;
    autoPlanTriedRef.current = true;
    autoPlan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQ.data?.onboarding_completed, noPlanYet]);

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
    // Si no hay plan todavía, espera además a que termine (con éxito o no) la
    // generación automática de arriba, para no crear el registro de hoy con
    // comidas vacías mientras el plan se está preparando.
    enabled:
      !!profileQ.data?.onboarding_completed &&
      planQ.isFetched &&
      (!!planQ.data || autoPlan.isError),
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
  const weeklyTrend = weeklyTrendFrom(logsQ.data ?? []);
  const habits = today?.habits ?? [];
  const doneCount = habits.filter((h) => h.done).length;
  const quote = quoteOfTheDay();

  const setMealStatus = (index: number, status: MealStatus) => {
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    save.mutate({ habits: next });
  };

  const handleMealStatus = (index: number, status: MealStatus) => {
    setMealStatus(index, status);
    if (status === "distinto") setGuidedIndex(index);
  };

  const guidedMeal = guidedIndex != null ? habits[guidedIndex] : undefined;

  const pending = habits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.status == null)
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));
  const nextIndex = pending.length ? pending[0]!.i : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-4">
        {/* ── Header: fecha + "Hoy" + impulso ── */}
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="font-mono-medium text-[11px] uppercase tracking-widest text-muted-foreground">
              {formatDate()}
            </Text>
            <Text
              className="font-heading text-foreground"
              style={{ fontSize: 40, lineHeight: 42, letterSpacing: -1.2 }}
            >
              Hoy
            </Text>
          </View>
          <View className="items-end gap-1">
            <View className="flex-row items-baseline gap-0.5">
              <Text
                className="font-heading text-foreground"
                style={{ fontSize: 26, lineHeight: 28 }}
              >
                {impulso}
              </Text>
              <Text className="font-mono-medium text-[11px] text-muted-foreground">%</Text>
            </View>
            <Text className="font-mono-medium text-[9.5px] uppercase tracking-widest text-muted-foreground">
              impulso
            </Text>
          </View>
        </View>

        {/* ── Barras de macros ── */}
        {guide?.macros ? <MacroBars macros={guide.macros} /> : null}

        {/* ── Comidas de hoy ── */}
        <View className="mt-6">
          <View className="mb-3.5 flex-row items-baseline justify-between">
            <Text
              className="font-heading text-foreground"
              style={{ fontSize: 21, lineHeight: 22, letterSpacing: -0.4 }}
            >
              Comidas de hoy
            </Text>
            <Text className="font-mono-medium text-[11px] text-muted-foreground">
              {doneCount} de {habits.length}
            </Text>
          </View>

          {!habits.length ? (
            <View className="rounded-[20px] bg-surface p-4">
              <Text className="font-body text-sm text-muted-foreground">
                {autoPlan.isPending
                  ? "Preparando tu menú del mes..."
                  : "Preparando las comidas de hoy..."}
              </Text>
            </View>
          ) : (
            <View className="gap-2.5">
              {habits.map((h, i) => {
                const isNext = i === nextIndex;
                const isDone = h.status === "plan" || h.status === "distinto";
                const isSkip = h.status === "salteo";
                const isPending = h.status == null;
                const planned = todayMeals.find((m) => m.moment === h.label);
                const dish = planned?.idea || h.label;
                const cat = classifyDish(dish);
                const catInfo = FOOD_CATEGORIES[cat];
                const accent = catInfo.accent;

                return (
                  <View
                    key={h.label}
                    className="flex-row items-center rounded-[20px] px-3.5 py-3"
                    style={{
                      backgroundColor: isSkip ? "#f0ede7" : tintBg(accent, isNext ? 22 : 13),
                      opacity: isSkip ? 0.55 : 1,
                      columnGap: 12,
                    }}
                  >
                    {/* Icono de categoría */}
                    <View
                      className="h-10 w-10 items-center justify-center rounded-full"
                      style={{ backgroundColor: tintBg(accent, 20) }}
                    >
                      <Text style={{ fontSize: 20 }}>{catInfo.icon}</Text>
                    </View>

                    {/* Info */}
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-baseline gap-1.5">
                        <Text className="font-body-semibold text-[11.5px] text-foreground">
                          {h.label}
                        </Text>
                        {planned ? (
                          <Text className="font-mono text-[10.5px] text-muted-foreground">
                            {MOMENT_RANK[h.label] === 0
                              ? "8:30"
                              : MOMENT_RANK[h.label] === 1
                                ? "14:00"
                                : MOMENT_RANK[h.label] === 3
                                  ? "20:30"
                                  : "17:00"}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        className="font-heading-medium mt-1 text-foreground"
                        style={{
                          fontSize: 16.5,
                          lineHeight: 20,
                          letterSpacing: -0.3,
                          color: isSkip ? "#83796c" : "#3e3d39",
                        }}
                        numberOfLines={2}
                      >
                        {dish}
                      </Text>
                      <Text className="font-mono-medium mt-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                        {catInfo.label}
                      </Text>
                    </View>

                    {/* Acciones */}
                    <View className="flex-row items-center gap-1.5">
                      {isPending ? (
                        <>
                          <Pressable
                            onPress={() => handleMealStatus(i, "distinto")}
                            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-80"
                          >
                            <RefreshCw size={14} color="#83796c" />
                          </Pressable>
                          <Pressable
                            onPress={() => setMealStatus(i, "salteo")}
                            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-80"
                          >
                            <X size={14} color="#83796c" strokeWidth={2.2} />
                          </Pressable>
                          <Pressable
                            onPress={() => setMealStatus(i, "plan")}
                            className="h-[34px] w-[34px] items-center justify-center rounded-full active:opacity-80"
                            style={{ backgroundColor: accent }}
                          >
                            <Check size={17} color="#fbfaf7" strokeWidth={2.6} />
                          </Pressable>
                        </>
                      ) : isDone ? (
                        <Pressable
                          onPress={() => setMealStatus(i, undefined as unknown as MealStatus)}
                          className="h-[34px] w-[34px] items-center justify-center rounded-full"
                          style={{ backgroundColor: accent }}
                        >
                          <Check size={17} color="#fbfaf7" strokeWidth={2.6} />
                        </Pressable>
                      ) : isSkip ? (
                        <Pressable
                          onPress={() => setMealStatus(i, undefined as unknown as MealStatus)}
                          className="h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary"
                        >
                          <X size={15} color="#83796c" strokeWidth={2.2} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Guía del coach ── */}
        <View className="mt-4">
          <Pressable
            onPress={() => setGuideOpen((o) => !o)}
            className="flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3.5 active:bg-accent"
          >
            <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
              <View
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: "#ff8a3d" }}
              />
              <Text
                className="min-w-0 flex-1 font-body-medium text-xs text-muted-foreground"
                numberOfLines={1}
              >
                Guía del coach{guide?.calories ? ` · ${guide.calories}` : ""}
              </Text>
            </View>
            <Text className="ml-2 shrink-0 font-mono-medium text-[11px] text-muted-foreground">
              {guideOpen ? "ocultar" : "ver"}
            </Text>
          </Pressable>
          {guideOpen ? (
            <View className="mt-2 rounded-3xl border border-border bg-surface p-5">
              {generating || (!guide && todayQ.isLoading) ? (
                <Text className="font-body text-sm text-muted-foreground">
                  Preparando tu guía del día...
                </Text>
              ) : guide ? (
                <View className="gap-3">
                  <Text className="font-body text-sm leading-relaxed text-foreground">
                    {guide.intro}
                  </Text>
                  <View className="gap-2">
                    <Field label="Energía" value={guide.calories} />
                    <Field label="Macros" value={guide.macros} />
                  </View>
                  {guide.meals?.length ? (
                    <View className="gap-2 pt-1">
                      <Text className="font-mono-medium text-[9.5px] uppercase tracking-widest text-muted-foreground">
                        Platos sugeridos
                      </Text>
                      {guide.meals.map((m) => (
                        <View
                          key={m.moment}
                          className="flex-row gap-3 rounded-xl border border-border bg-surface p-3"
                        >
                          <Text className="font-body-semibold text-xs text-primary">
                            {m.moment}
                          </Text>
                          <Text className="font-body flex-1 text-sm text-foreground">{m.idea}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {guide.tips?.length ? (
                    <View className="gap-1.5 pt-1">
                      <Text className="font-mono-medium text-[9.5px] uppercase tracking-widest text-muted-foreground">
                        Consejos de nutrición
                      </Text>
                      {guide.tips.map((t) => (
                        <View key={t} className="flex-row gap-2">
                          <View className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                          <Text className="font-body flex-1 text-sm text-foreground">{t}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <Pressable onPress={requestGuide}>
                  <Text className="font-body-medium text-sm text-primary">Generar guía</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        {/* ── Tira de la semana ── */}
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
          <Text className="font-body mt-2 px-1 text-[10.5px] text-muted-foreground">
            Toca un día para ver su menú.
          </Text>
        </View>

        {/* ── Cita ── */}
        <View className="mt-6 px-0.5">
          <Text
            className="font-heading text-muted-foreground"
            style={{ fontSize: 14, lineHeight: 20, letterSpacing: -0.1 }}
          >
            "{quote.text}"
          </Text>
          <Text className="font-mono-medium mt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/60">
            {quote.author}
          </Text>
        </View>
      </ScrollView>

      {/* ── FAB de chat: pegado justo encima de la barra de pestañas ── */}
      <Pressable
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

      <GuidedLogSheet
        mode="meal"
        open={guidedIndex != null}
        onOpenChange={(v) => {
          if (!v) setGuidedIndex(null);
        }}
        contextNote={guidedMeal ? `Qué has comido en vez de: ${guidedMeal.label}` : undefined}
        onSkip={() => {
          if (guidedIndex != null) {
            setMealStatus(guidedIndex, "salteo");
            setGuidedIndex(null);
          }
        }}
        onSend={(text) => {
          setPendingChatMessage(text);
          setGuidedIndex(null);
          router.navigate("/chat");
        }}
      />

      <GuidedLogSheet
        mode="activity"
        open={activityOpen}
        onOpenChange={setActivityOpen}
        onSend={(text) => {
          setPendingChatMessage(text);
          setActivityOpen(false);
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

// ── Barra de macros orientativa ──
function MacroBars({ macros }: { macros: string }) {
  // Parsear string tipo "Proteínas: 72g · Carbohidratos: 160g · Grasas: 48g · Fibra: 22g"
  const parsed = parseMacros(macros);
  if (!parsed.length) return null;

  return (
    <View className="mt-5 flex-row gap-2.5">
      {parsed.map((m) => (
        <View key={m.key} className="flex-1">
          <View className="h-[5px] overflow-hidden rounded-full bg-secondary">
            <View
              className="h-full rounded-full"
              style={{ width: `${m.pct}%`, backgroundColor: m.color }}
            />
          </View>
          <Text className="font-mono-medium mt-1.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">
            {m.key}
          </Text>
          <Text className="font-mono-medium mt-0.5 text-[11px] text-foreground">{m.val}</Text>
        </View>
      ))}
    </View>
  );
}

const MACRO_COLORS: Record<string, string> = {
  prot: "#6DBE7B",
  carb: "#FF8A3D",
  gras: "#F2C14E",
  fibra: "#6DBE7B",
};

// Targets orientativos para porcentaje visual
const MACRO_TARGETS: Record<string, number> = {
  prot: 120,
  carb: 200,
  gras: 70,
  fibra: 30,
};

function parseMacros(raw: string): { key: string; val: string; pct: number; color: string }[] {
  const result: { key: string; val: string; pct: number; color: string }[] = [];
  // Match patterns like "Proteínas: 72g" or "72 g proteínas"
  const patterns: [RegExp, string][] = [
    [/prote[ií]n\w*[:\s]+(\d+)\s*g/i, "prot"],
    [/carbo\w*[:\s]+(\d+)\s*g/i, "carb"],
    [/gras\w*[:\s]+(\d+)\s*g/i, "gras"],
    [/fibra[:\s]+(\d+)\s*g/i, "fibra"],
  ];
  for (const [re, key] of patterns) {
    const m = raw.match(re);
    if (m) {
      const val = `${m[1]} g`;
      const num = parseInt(m[1]!, 10);
      const target = MACRO_TARGETS[key] ?? 100;
      const pct = Math.min(100, Math.round((num / target) * 100));
      result.push({ key, val, pct, color: MACRO_COLORS[key] ?? "#83796c" });
    }
  }
  return result;
}

// ── Menú de un día expandido ──
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
        <Text className="font-body-semibold text-sm capitalize text-foreground">{label}</Text>
      </View>
      {meals.length ? (
        <View className="mt-3 gap-2">
          {meals.map((m) => (
            <Field key={m.slot} label={m.moment} value={m.idea} note={offListNote(m.off)} />
          ))}
        </View>
      ) : (
        <Text className="font-body mt-2 text-sm text-muted-foreground">
          Aún no hay menú para este día. Crea tu plan del mes en la pestaña Plan.
        </Text>
      )}
    </View>
  );
}

function Field({ label, value, note }: { label: string; value: string; note?: string | null }) {
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
    </View>
  );
}

function ChatBubbleIcon() {
  return <MessageCircle size={22} color="#fbfaf7" />;
}
