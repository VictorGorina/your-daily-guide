import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Activity,
  Briefcase,
  Check,
  ChevronDown,
  Home,
  MessageCircle,
  PencilLine,
  X,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { DayDetailBody } from "../../components/day-detail-sheet";
import { DishRecipe } from "../../components/dish-recipe";
import { DishCategoryIcon } from "../../components/food-category-bg";
import { GuidedLogSheet } from "../../components/guided-log-sheet";
import { MacroBars } from "../../components/macro-bars";
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
  saveProfile,
  todayISO,
  updateTodayLog,
  weeklyTrendFrom,
  type DailyGuide,
  type DailyLog,
  type MealStatus,
} from "../../lib/daily";
import { sumDoneMacros, ZERO_MACROS } from "../../lib/macros";
import { fetchHousehold } from "../../lib/household";
import { isSharedSlot, personColor, whoIsHome, type MealKey } from "../../lib/household-shared";
import { setPendingChatMessage } from "../../lib/pending-chat-message";
import {
  childMealsForDate,
  mealsForDate,
  offListNote,
  type MonthlyPlan,
  type ShoppingList,
} from "../../lib/plan-shared";
import { quoteOfTheDay } from "../../lib/quotes";
import { resolveDeviceTimeZone } from "../../lib/zoned-date";

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

// Ventana mínima entre intentos automáticos de generar el plan del mes,
// persistida en AsyncStorage (a diferencia de `autoPlanTriedRef`, que solo
// protege dentro de un mismo montaje) para que sobreviva a que la persona
// cierre y reabra la app. Sin esto, matar y reabrir la app varias veces por
// impaciencia mientras la IA todavía está generando el plan anterior podría
// lanzar una llamada a IA nueva en cada apertura. Es una heurística, no una
// garantía: la generación real puede tardar más o menos que esta ventana.
// Misma lógica que la web (src/routes/_authenticated/hoy.tsx), con la clave
// homónima; allí es localStorage síncrono y aquí AsyncStorage asíncrono.
const AUTO_PLAN_MIN_INTERVAL_MS = 60_000;
const autoPlanAttemptKey = (month: string) => `ydg:autoPlanAttempt:${month}`;

// La guía del día se pide sola al abrir Hoy si falta o está incompleta. Dos
// salvaguardas para que ese reintento automático no se convierta en spam:
//   1. Si falla, no se avisa (`silent`): el aviso solo sale al pulsar "Generar"
//      a mano. Antes cada fallo encolaba un `Alert`, y como iOS los muestra de
//      uno en uno, un montaje repetido de Hoy (Fast Refresh, volver a la
//      pestaña, el backend caído un rato) dejaba una cola de avisos idénticos
//      imposible de cerrar.
//   2. No se relanza sola más de una vez por minuto entre montajes (variable a
//      nivel de módulo, no por montaje), para no martillear la IA. Mismo
//      criterio que `AUTO_PLAN_MIN_INTERVAL_MS`.
const AUTO_GUIDE_MIN_INTERVAL_MS = 60_000;
let lastAutoGuideAttempt = 0;

/** ms desde el último intento (de cualquier apertura de la app), o null si no hay uno registrado. */
async function msSinceLastAutoPlanAttempt(month: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(autoPlanAttemptKey(month));
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? Date.now() - at : null;
  } catch {
    return null;
  }
}

async function markAutoPlanAttempt(month: string) {
  try {
    await AsyncStorage.setItem(autoPlanAttemptKey(month), String(Date.now()));
  } catch {
    // Almacenamiento bloqueado: sin memoria entre relanzamientos, pero no
    // bloquea la generación de este montaje.
  }
}

export default function Hoy() {
  const router = useRouter();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);
  const autoPlanTriedRef = useRef(false);
  const [autoPlanThrottled, setAutoPlanThrottled] = useState(false);

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
      apiPost<{ plan: MonthlyPlan; shopping: ShoppingList }>("plan/generate", {
        month,
        today: todayISO(),
      }),
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
    // Si ya hay una marca reciente (de otra apertura de la app), se espera el
    // resto de la ventana en vez de lanzar otra generación en paralelo. Solo se
    // marca en el primer intento para que relanzamientos de en medio no alarguen
    // la espera indefinidamente.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const elapsed = await msSinceLastAutoPlanAttempt(month);
      if (cancelled) return;
      if (elapsed == null) void markAutoPlanAttempt(month);
      const wait = elapsed == null ? 0 : Math.max(0, AUTO_PLAN_MIN_INTERVAL_MS - elapsed);
      if (wait > 0) setAutoPlanThrottled(true);
      timer = setTimeout(() => {
        setAutoPlanThrottled(false);
        autoPlan.mutate();
      }, wait);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQ.data?.onboarding_completed, noPlanYet]);

  const today0 = todayISO();
  const todayMeals = mealsForDate((planQ.data?.plan as MonthlyPlan | null) ?? null, today0);
  const todayWeekday = (new Date(`${today0}T00:00:00`).getDay() + 6) % 7;
  /** Who is eating at home for this meal today? Returns null if no household or not a main meal. */
  const mealCompanions = (label: string) => {
    const mealKey = MOMENT_TO_MEAL_KEY[label];
    if (!mealKey) return null;
    const hMembers = householdQ.data?.members ?? [];
    const hChildren = householdQ.data?.children ?? [];
    if (!hMembers.length) return null;
    const hasSchedules = hMembers.some((m) => m.home_schedule != null);
    if (hasSchedules) {
      const { people } = whoIsHome(
        hMembers.map((m) => ({
          id: m.id,
          displayName: m.display_name,
          portion: m.portion,
          isPlanner: m.is_planner,
          homeSchedule: m.home_schedule,
        })),
        hChildren.map((c) => ({
          id: c.id,
          name: c.name,
          portion: c.portion,
          homeSchedule: c.home_schedule,
        })),
        mealKey,
        todayWeekday,
      );
      const myMemberId = householdQ.data?.me?.id;
      const meHome = people.some((p) => p.id === myMemberId);
      const others = people.filter((p) => p.id !== myMemberId);
      return { meHome, others };
    }
    // Legacy: use shared_slots
    const slots = householdQ.data?.household?.shared_slots;
    if (!slots || !isSharedSlot(slots, mealKey, todayWeekday)) {
      return { meHome: true, others: [] as { id: string; displayName: string; portion: number }[] };
    }
    const others = hMembers
      .filter((m) => m.user_id !== householdQ.data?.me?.user_id)
      .map((m) => ({ id: m.id, displayName: m.display_name, portion: m.portion }));
    return { meHome: true, others };
  };
  /** Backward-compat wrapper for callers that just need a name string or null. */
  const sharedWith = (label: string) => {
    const comp = mealCompanions(label);
    if (!comp || !comp.others.length) return null;
    return comp.others.length === 1 ? comp.others[0].displayName : "el resto del hogar";
  };
  // Platos aparte de los niños de la casa para ese momento de hoy (issue 07).
  const childMealsFor = (label: string) => {
    const mealKey = MOMENT_TO_MEAL_KEY[label];
    const kids = householdQ.data?.children ?? [];
    if (!mealKey || !kids.length) return [];
    return kids.flatMap((c) =>
      childMealsForDate((planQ.data?.plan as MonthlyPlan | null) ?? null, today0, c.id)
        .filter((k) => k.slot === mealKey)
        .map((k) => ({ name: c.name, dish: k.dish, off: k.off })),
    );
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

  // Mantiene `profiles.timezone` al día (viajes, o perfiles anteriores a la
  // feature) para que el push del servidor use la hora local. Solo escribe si
  // cambia.
  useEffect(() => {
    if (!profile?.onboarding_completed) return;
    const deviceTz = resolveDeviceTimeZone();
    if (deviceTz && profile.timezone !== deviceTz) {
      // Best-effort: si falla (migración aún sin aplicar) se reintenta luego.
      saveProfile({ timezone: deviceTz }).catch(() => {});
    }
  }, [profile?.onboarding_completed, profile?.timezone]);

  const save = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateTodayLog(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: () => Alert.alert("No hemos podido guardar el cambio"),
  });

  const guide = today?.guide ?? null;

  const requestGuide = async ({ silent = false }: { silent?: boolean } = {}) => {
    setGenerating(true);
    try {
      const g = await apiPost<DailyGuide>("guide", {
        meals: todayMeals.filter((m) => m.idea).map((m) => ({ moment: m.moment, idea: m.idea })),
      });
      await updateTodayLog({ guide: g });
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      // El reintento automático (`silent`) falla sin ruido: hay un botón
      // "Generar" a la vista para reintentar a mano, y así un fallo no encola
      // un `Alert` por cada montaje de Hoy.
      if (!silent) Alert.alert("El coach no ha podido responder ahora mismo");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!today || generating) return;
    const g = today.guide;
    // Si ya hay platos reales de hoy pero la guía guardada es de antes de que
    // existiera la barra de macros (o el modelo no la rellenó, o es de antes
    // de que la barra sumara por plato), regenera para rellenar `mealMacros`
    // — si no, se queda sin barras para siempre: esta guía ya tiene
    // `meals`/`tips`, así que la condición de abajo no la pillaría.
    const missingMacros =
      !!g && todayMeals.some((m) => m.idea) && (g.macroEstimate == null || !g.mealMacros?.length);
    if (!g || !g.meals?.length || !g.tips?.length || missingMacros) {
      if (Date.now() - lastAutoGuideAttempt < AUTO_GUIDE_MIN_INTERVAL_MS) return;
      lastAutoGuideAttempt = Date.now();
      void requestGuide({ silent: true });
    }
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
  // La barra de macros suma solo lo ya marcado como comido ("comí esto" /
  // "comí distinto"), no el menú completo del día: así deshacer una comida
  // la mueve, en vez de quedarse fija en un total del día entero. Se muestra
  // siempre (arrancando en 0) para que se vea cómo se va llenando según se
  // marcan comidas, en vez de aparecer de golpe con la primera.
  const doneMacros = sumDoneMacros(guide?.mealMacros, habits) ?? ZERO_MACROS;
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
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-52 pt-4">
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
        <MacroBars
          estimate={doneMacros}
          target={guide?.macroEstimate ?? null}
          weightKg={profile?.current_weight_kg ?? null}
        />

        {/* ── Guía del coach: solo el rango de calorías del día, sin el resto
            (intro, macros en texto, platos sugeridos, consejos) — se quería
            menos información, no una tarjeta expandible. ── */}
        <View className="mt-6 flex-row items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
          <View
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: "#ff8a3d" }}
          />
          <Text className="min-w-0 flex-1 font-body-medium text-xs text-muted-foreground">
            {generating || (!guide && todayQ.isLoading)
              ? "Preparando tu guía del día..."
              : guide
                ? `Guía del coach · ${guide.calories}`
                : "Guía del coach"}
          </Text>
          {!guide && !generating && !todayQ.isLoading ? (
            <Pressable onPress={() => requestGuide()}>
              <Text className="font-body-medium text-xs text-primary">Generar</Text>
            </Pressable>
          ) : null}
        </View>

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
              {autoPlan.isError || todayQ.isError ? (
                // Mismo patrón que "Guía del coach": si la generación falla (o el
                // registro de hoy no carga), se ofrece reintentar en vez de dejar
                // el texto de "preparando" colgado para siempre.
                <Pressable
                  onPress={() => (autoPlan.isError ? autoPlan.mutate() : todayQ.refetch())}
                >
                  <Text className="font-body-medium text-sm text-primary">
                    {autoPlan.isError
                      ? "No hemos podido preparar tu menú del mes. Reintentar"
                      : "No hemos podido preparar las comidas de hoy. Reintentar"}
                  </Text>
                </Pressable>
              ) : (
                <Text className="font-body text-sm text-muted-foreground">
                  {autoPlanThrottled
                    ? "Ya se está preparando tu menú del mes..."
                    : autoPlan.isPending
                      ? "Preparando tu menú del mes..."
                      : "Preparando las comidas de hoy..."}
                </Text>
              )}
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
                // El coach cambió el plato de este momento hoy (chat o "comí
                // otra cosa"): plato real en naranja, con el que había antes
                // tachado debajo — ver `wasIdea` en lib/daily.ts.
                const wasIdea = h.wasIdea && h.wasIdea !== dish ? h.wasIdea : null;
                const note = offListNote(planned?.off);
                const shared = sharedWith(h.label);

                return (
                  <View
                    key={h.label}
                    className="rounded-[20px] px-3.5 py-3"
                    style={{
                      backgroundColor: isSkip ? "#f0ede7" : tintBg(accent, isNext ? 22 : 13),
                      opacity: isSkip ? 0.55 : 1,
                    }}
                  >
                    <View className="flex-row items-center" style={{ columnGap: 12 }}>
                      {/* Icono de categoría de comida (familia Lucide, igual que
                          la subpestaña Ingredientes). Sin plato aún o categoría
                          "otro" → círculo solo con el tinte. */}
                      <View
                        className="h-10 w-10 items-center justify-center overflow-hidden rounded-full"
                        style={{ backgroundColor: tintBg(accent, 20) }}
                      >
                        {planned?.idea ? <DishCategoryIcon dish={dish} size={18} /> : null}
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
                            color: isSkip ? "#83796c" : wasIdea ? "#ff8a3d" : "#3e3d39",
                          }}
                          numberOfLines={2}
                        >
                          {dish}
                        </Text>
                        {wasIdea ? (
                          <Text
                            className="mt-0.5 font-body text-[11.5px] text-muted-foreground"
                            style={{ textDecorationLine: "line-through" }}
                            numberOfLines={2}
                          >
                            {wasIdea}
                          </Text>
                        ) : null}
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
                              <PencilLine size={14} color="#83796c" />
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

                    {/* Aviso de fuera de compra, base compartida y receta van
                        siempre a la vista, no tras un toque oculto — igual que en
                        la web. La receta es un disclosure con su propio
                        abrir/cerrar y carga perezosa (DishRecipe). */}
                    {note ? (
                      <View className="mt-3 self-start rounded-full bg-warning/20 px-2 py-0.5">
                        <Text className="font-body-medium text-[11px] text-foreground">{note}</Text>
                      </View>
                    ) : null}
                    {(() => {
                      const comp = mealCompanions(h.label);
                      if (!comp) return null;
                      const hasOthers = comp.others.length > 0;
                      return (
                        <View className="mt-2 flex-row items-center gap-2">
                          {comp.meHome ? (
                            <Home size={14} color="#83796c" />
                          ) : (
                            <Briefcase size={14} color="#83796c" />
                          )}
                          {hasOthers ? (
                            <>
                              <View className="flex-row" style={{ marginLeft: -2 }}>
                                {comp.others.slice(0, 4).map((p) => {
                                  const colors = personColor(p.id);
                                  return (
                                    <View
                                      key={p.id}
                                      className="h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-background"
                                      style={{
                                        backgroundColor: colors.soft,
                                        marginLeft: -3,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          fontSize: 9,
                                          fontWeight: "700",
                                          color: colors.ink,
                                        }}
                                      >
                                        {p.displayName.charAt(0)}
                                      </Text>
                                    </View>
                                  );
                                })}
                              </View>
                              <Text className="font-body text-[11px] text-muted-foreground">
                                Base común · "Comí otra cosa" si tu ración cambia
                              </Text>
                            </>
                          ) : comp.meHome ? (
                            <Text className="font-body text-[11px] text-muted-foreground">
                              Comes en casa
                            </Text>
                          ) : (
                            <Text className="font-body text-[11px] text-muted-foreground">
                              Fuera de casa
                            </Text>
                          )}
                        </View>
                      );
                    })()}
                    {childMealsFor(h.label).map((k) => (
                      <Text
                        key={`${k.name}-${k.dish}`}
                        className="font-body mt-2 text-[11px] leading-relaxed text-muted-foreground"
                      >
                        Para {k.name}: <Text className="text-foreground">{k.dish}</Text>
                        {offListNote(k.off) ? ` · ${offListNote(k.off)}` : ""}
                      </Text>
                    ))}
                    {planned?.idea ? <DishRecipe dish={dish} month={month} /> : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Registrar deporte: pegado encima de la tira de la semana ── */}
        <Pressable
          onPress={() => setActivityOpen(true)}
          className="mt-6 flex-row items-center justify-center gap-2 rounded-full bg-surface py-3.5 active:opacity-80"
        >
          <Activity size={16} color="#3e3d39" />
          <Text className="font-body-semibold text-sm text-foreground">Registrar deporte</Text>
        </Pressable>

        {/* ── Tira de la semana ── */}
        <View className="mt-6">
          <WeekStrip
            selected={openDay}
            onSelect={(d) => setOpenDay((prev) => (prev === d ? null : d))}
            logs={logsQ.data ?? []}
            todayHabits={
              habits.length ? habits.map((h) => h.label) : todayMeals.map((m) => m.moment)
            }
          />
          {openDay && openDay < todayISO() ? (
            <View className="mt-3 rounded-3xl bg-surface p-4">
              <View className="flex-row items-center gap-2">
                <ChevronDown size={16} color="#6dbe7b" />
                <Text className="font-body-semibold text-sm capitalize text-foreground">
                  {new Date(`${openDay}T00:00:00`).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </Text>
              </View>
              <View className="mt-3">
                <DayDetailBody
                  date={openDay}
                  plan={(planQ.data?.plan as MonthlyPlan | null) ?? null}
                  log={logsQ.data?.find((l) => l.log_date === openDay)}
                  profile={profileQ.data ?? null}
                  householdChildren={householdQ.data?.children}
                  household={
                    householdQ.data?.household?.shared_slots
                      ? {
                          sharedSlots: householdQ.data.household.shared_slots,
                          memberCount: (householdQ.data.members ?? []).filter((m) => m.user_id)
                            .length,
                        }
                      : undefined
                  }
                />
              </View>
            </View>
          ) : openDay ? (
            <DayMenu date={openDay} plan={(planQ.data?.plan as MonthlyPlan | null) ?? null} />
          ) : null}
          <Text className="font-body mt-2 px-1 text-[10.5px] text-muted-foreground">
            {openDay && openDay < todayISO()
              ? "Toca una comida para corregir lo que comiste."
              : "Toca un día para ver su menú."}
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
        mealLabel={guidedMeal?.label}
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

// ── Menú de un día expandido ──
function DayMenu({ date, plan }: { date: string; plan: MonthlyPlan | null }) {
  const meals = mealsForDate(plan, date).filter((m) => m.idea);
  const label = new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <View className="mt-3 rounded-3xl bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <ChevronDown size={16} color="#6dbe7b" />
        <Text className="font-body-semibold text-sm capitalize text-foreground">{label}</Text>
      </View>
      {meals.length ? (
        <View className="mt-3 gap-2">
          {meals.map((m) => (
            <Field
              key={m.slot}
              label={m.moment}
              value={m.idea}
              note={offListNote(m.off)}
              recipeMonth={date.slice(0, 7)}
            />
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

function Field({
  label,
  value,
  note,
  recipeMonth,
}: {
  label: string;
  value: string;
  note?: string | null;
  /** Si se pasa, el valor es un plato y se ofrece "Ver receta" para ese mes. */
  recipeMonth?: string;
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
      {recipeMonth ? <DishRecipe dish={value} month={recipeMonth} /> : null}
    </View>
  );
}

function ChatBubbleIcon() {
  return <MessageCircle size={22} color="#fbfaf7" />;
}
