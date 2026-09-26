import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Activity,
  Briefcase,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  Cookie,
  Home,
  Info,
  MessageCircle,
  PencilLine,
  Undo2,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdjustmentInfoSheet } from "../../components/adjustment-info-sheet";
import { BottomNav } from "../../components/bottom-nav";
import { ChildMealGapBanner } from "../../components/child-meal-gap-banner";
import { DayDetailBody, type DayDetailHousehold } from "../../components/day-detail-sheet";
import { DishRecipe } from "../../components/dish-recipe";
import { DayBalanceCard } from "../../components/day-balance-card";
import { ExerciseCard } from "../../components/exercise-card";
import { ExerciseSheet } from "../../components/exercise-sheet";
import { DishCategoryIcon } from "../../components/food-category-bg";
import { MacroBars } from "../../components/macro-bars";
import { MealSwapSheet } from "../../components/meal-swap-sheet";
import { NightlyReviewSheet } from "../../components/nightly-review-sheet";
import { SnackCard } from "../../components/snack-card";
import { SnackSheet } from "../../components/snack-sheet";
import { WeekPager } from "../../components/week-pager";
import { classifyDish, FOOD_CATEGORIES } from "../../lib/food-categories";
import { apiPost } from "../../lib/api";
import {
  ensureTodayLog,
  fetchLogs,
  fetchLogsForMonth,
  fetchMonthlyPlan,
  fetchProfile,
  impulsoFrom,
  fetchTodayLog,
  monthISO,
  patchTodayHabits,
  saveProfile,
  todayISO,
  updateTodayLog,
  weeklyTrendFrom,
  type DailyGuide,
  type DailyLog,
  type MealStatus,
  type Profile,
} from "../../lib/daily";
import {
  addMacros,
  donePendingMeals,
  guideMeals,
  guideReuse,
  mealsToRecalculate,
  mergeGuide,
  showsNutritionNumbers,
  sumDoneMacros,
  ZERO_MACROS,
} from "../../lib/macros";
import { caloriesText, energyTargets, targetsAsMacros } from "../../lib/energy";
import { learnedPortionSize, portionSizeHistory } from "../../lib/portion";
import { fetchHousehold } from "../../lib/household";
import {
  EMPTY_SCHEDULE,
  isSharedSlot,
  personColor,
  whoIsHome,
  type MealKey,
  type SharedSlots,
} from "../../lib/household-shared";
import {
  capitalizeFirst,
  childMealsForDate,
  childPureeGaps,
  dishChangeIsMine,
  effectiveMealSlots,
  isPinnedByViewer,
  mealsForDate,
  offListNote,
  planForDate,
  reconcileHabits,
  sameHabits,
  suggestedDish,
  type HouseholdPinContext,
  type MealSlot,
  type MonthlyPlan,
} from "../../lib/plan-shared";
import { quoteOfTheDay } from "../../lib/quotes";
import { cleanDayAdjustment, dayBalance } from "../../lib/day-balance";
import { scheduleDaySettle, useDaySettle } from "../../lib/day-settle";
import { cleanDayExercise, onlyRoutineExercise } from "../../lib/exercise";
import { cleanDaySnacks, snackTotals } from "../../lib/snacks";
import { useMealSwap } from "../../lib/use-meal-swap";
import { addDaysISO, monthsOfWeek, weekDates, weekStartOf } from "../../lib/week-nav";
import { resolveDeviceTimeZone } from "../../lib/zoned-date";

// Misma curva que el resto de la app (docs/design-guidelines.md §7) y que
// `week-pager.tsx`, para que el panel del día y la tira se muevan igual.
const EASING = Easing.bezier(0.22, 1, 0.36, 1);

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

// La guía del día se pide sola al abrir Hoy si falta o está incompleta. Dos
// salvaguardas para que ese reintento automático no se convierta en spam:
//   1. Si falla, no se avisa (`silent`): el aviso solo sale al pulsar "Generar"
//      a mano. Antes cada fallo encolaba un `Alert`, y como iOS los muestra de
//      uno en uno, un montaje repetido de Hoy (Fast Refresh, volver a la
//      pestaña, el backend caído un rato) dejaba una cola de avisos idénticos
//      imposible de cerrar.
//   2. No se relanza sola más de una vez por minuto entre montajes (variable a
//      nivel de módulo, no por montaje), para no martillear la IA.
const AUTO_GUIDE_MIN_INTERVAL_MS = 60_000;
const AUTO_GUIDE_BACKOFF_MS = 600_000;
let lastAutoGuideAttempt = 0;
let lastAutoGuideFailed = false;
/** Por qué se pidió la guía la última vez (ver `guideNeed`). */
let lastAutoGuideKey = "";
// Platos que quedaron "calculando" (ticket 13 de `precision-nutricional`, D13):
// se reintentan al abrir Hoy, al volver a la app y cada 2 minutos mientras está
// abierta, como mucho 5 veces seguidas; después, en el siguiente arranque (el
// contador vive en el módulo). Cada intento solo descompone lo que falta
// (`macrosOnly` + `reuse`). Mismo criterio que la web.
const CALC_RETRY_MS = 120_000;
const CALC_MAX_ATTEMPTS = 5;
let calcAttempts = 0;
let lastCalcAttempt = 0;

export default function Hoy() {
  const router = useRouter();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  /** Hoja con TODO lo que el día ha movido en los próximos días. */
  const [balanceInfoOpen, setBalanceInfoOpen] = useState(false);
  const [removingExercise, setRemovingExercise] = useState<string | null>(null);
  const [snackOpen, setSnackOpen] = useState(false);
  const [removingSnack, setRemovingSnack] = useState<string | null>(null);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  // Sin plan del mes en curso, Hoy no lo genera por su cuenta: un mes se
  // genera UNA vez y tras la conversación con el coach (pantalla Plan,
  // `MonthIntakeChat`). Aquí solo se invita a ir a prepararlo.
  const noPlanYet = planQ.isFetched && !planQ.data;

  const today0 = todayISO();
  const [visibleWeek, setVisibleWeek] = useState(() => weekStartOf(today0));
  const appStartedOn = profileQ.data?.app_started_on ?? null;

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
  // tras deslizar a otra semana con el día abierto).
  useEffect(() => {
    if (openDay && !weekDates(visibleWeek).includes(openDay)) setOpenDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWeek]);

  // Cinturón extra sobre el filtro por contenido de `mealsForDate`: si el
  // plato de hoy vino espejado de una comida compartida del hogar (que no
  // sabe de las preferencias de cada persona), esto lo descarta igual cuando
  // esta persona no planifica ese slot.
  const mySlots = effectiveMealSlots(profileQ.data ?? {});
  const todayMeals = mealsForDate(
    (planQ.data?.plan as MonthlyPlan | null) ?? null,
    today0,
    mySlots,
  );
  const todayWeekday = (new Date(`${today0}T00:00:00`).getDay() + 6) % 7;
  // Base para `dishChangeIsMine`: en un hogar compartido, un plato que cambia
  // quien planifica no es un cambio "a mano" para el resto, así que no debe
  // quitarles la receta.
  const homePlanner = householdQ.data?.household
    ? {
        isPlanner: !!householdQ.data.me?.is_planner,
        sharedSlots: householdQ.data.household.shared_slots,
      }
    : null;
  const homeCtxFor = (weekday: number) => (homePlanner ? { ...homePlanner, weekday } : null);
  /** Who is eating at home for this meal today? Returns null if no household or not a main meal. */
  const mealCompanions = (label: string) => {
    const mealKey = MOMENT_TO_MEAL_KEY[label];
    if (!mealKey) return null;
    const hMembers = householdQ.data?.members ?? [];
    const hChildren = householdQ.data?.children ?? [];
    if (!hMembers.length) return null;
    const hasSchedules = hMembers.some((m) => m.home_schedule != null);
    if (hasSchedules) {
      // Quien no ha configurado su horario hereda los días compartidos del
      // hogar, no "nunca en casa" — así un horario a medias no borra la mesa.
      const baseline = householdQ.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
      const { people } = whoIsHome(
        hMembers.map((m) => ({
          id: m.id,
          displayName: m.display_name,
          portion: m.portion,
          isPlanner: m.is_planner,
          homeSchedule: m.home_schedule ?? baseline,
        })),
        hChildren.map((c) => ({
          id: c.id,
          name: c.name,
          portion: c.portion,
          homeSchedule: c.home_schedule ?? baseline,
          stage: c.feeding_stage,
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

  // Peques de triturados a los que les falta su puré HOY en el plan — pasa
  // cuando se dan de alta o cambian de etapa después de generar el plan del
  // mes. Dispara el aviso "Actualizar" (`ChildMealGapBanner`).
  const householdBaseline = householdQ.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
  const pendingKidMeals = (householdQ.data?.children ?? []).filter(
    (c) =>
      c.feeding_stage === "triturados" &&
      childPureeGaps(
        (planQ.data?.plan as MonthlyPlan | null) ?? null,
        { id: c.id, stage: c.feeding_stage, homeSchedule: c.home_schedule ?? householdBaseline },
        today0,
      ).some((g) => g.date === today0),
  );

  const fillKidsMut = useMutation({
    mutationFn: () =>
      apiPost<{ plan: MonthlyPlan; filled: number; children: string[] }>("plan/child-meal-fill", {
        today: today0,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      Alert.alert(
        res.filled ? `Menú de ${res.children.join(", ")} actualizado` : "Ya estaba al día",
      );
    },
    onError: (e) =>
      Alert.alert(
        e instanceof Error ? e.message : "No hemos podido actualizar el menú de los peques",
      ),
  });

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

  const requestGuide = async ({
    silent = false,
    macrosOnly = false,
  }: { silent?: boolean; macrosOnly?: boolean } = {}) => {
    setGenerating(true);
    try {
      const { dishMacros: _none, ...g } = await apiPost<DailyGuide & { dishMacros?: unknown }>(
        "guide",
        {
          // Con lo que se comió de verdad en cada "comí distinto" (ticket 17).
          meals: guideMeals(
            todayMeals.map((m) => ({ moment: m.moment, idea: m.idea })),
            today?.habits,
          ),
          // Lo que ya tiene cifra no se vuelve a descomponer.
          reuse: guideReuse(today?.guide?.mealMacros, today?.habits),
          macrosOnly,
          today: today0,
        },
      );
      // Solo cifras: el texto de la guía se queda como estaba.
      const fresh: DailyGuide =
        macrosOnly && today?.guide
          ? { ...today.guide, macroEstimate: g.macroEstimate, mealMacros: g.mealMacros }
          : g;
      // Si la generación vuelve con el texto de respaldo y sin cifras, se
      // conservan las que ya tuviera el día: regenerar nunca debe dejar la
      // barra de macros peor de como estaba (ver `mergeGuide`).
      await updateTodayLog({ guide: mergeGuide(today?.guide, fresh) });
      lastAutoGuideFailed = false;
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      if (silent) {
        lastAutoGuideFailed = true;
      } else {
        lastAutoGuideFailed = false;
        Alert.alert("El coach no ha podido responder ahora mismo");
      }
    } finally {
      setGenerating(false);
    }
  };

  // Por qué habría que (re)generar la guía, como una cadena estable. El efecto
  // depende del MOTIVO y no del id del registro: `today.id` no cambia en todo
  // el día y esta pantalla no se desmonta nunca (queda bajo el Stack de
  // expo-router), así que un cambio de plato no volvía a disparar nada y la
  // barra de macros se quedaba igual hasta pulsar "Generar" a mano.
  const guideNeed = (() => {
    if (!today) return "";
    const g = today.guide;
    if (!g || !g.meals?.length || !g.tips?.length) return "sin-guia";
    const dishes = todayMeals.filter((m) => m.idea);
    if (!dishes.length) return "";
    // Guía guardada de antes de que existiera la barra de macros (o el lookup
    // no salió): sin esto se queda sin barras para siempre.
    if (g.macroEstimate == null || !g.mealMacros?.length) return "sin-macros";
    // El hogar puede espejar por detrás un cambio del planificador sobre una
    // comida compartida: el plato de hoy cambia sin pasar por `use-meal-swap`.
    const stale = dishes.filter((m) => {
      const cached = g.mealMacros?.find((mm) => mm.moment === m.moment);
      return !!cached?.idea && cached.idea !== m.idea;
    });
    if (stale.length) return `platos:${stale.map((m) => `${m.moment}=${m.idea}`).join("|")}`;
    // Platos que siguen "calculando" (D13): se reintentan, con su propia pauta.
    const pending = mealsToRecalculate(g.mealMacros).filter((mm) =>
      dishes.some((m) => m.moment === mm.moment && m.idea === mm.idea),
    );
    return pending.length ? `por-calcular:${pending.map((m) => m.moment).join("|")}` : "";
  })();

  // Reloj del reintento de "calculando": cada 2 minutos mientras quede algo, y
  // al volver a la app. Solo cambia un contador; decide el efecto de abajo.
  const recalculating = guideNeed.startsWith("por-calcular");
  const [calcTick, setCalcTick] = useState(0);
  const calcForceRef = useRef(true); // al abrir Hoy se intenta ya
  useEffect(() => {
    if (!recalculating) {
      calcAttempts = 0;
      return;
    }
    const id = setInterval(() => setCalcTick((t) => t + 1), CALC_RETRY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      calcForceRef.current = true;
      setCalcTick((t) => t + 1);
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [recalculating]);

  useEffect(() => {
    if (!guideNeed || generating) return;
    if (guideNeed.startsWith("por-calcular")) {
      if (calcAttempts >= CALC_MAX_ATTEMPTS) return;
      const due = Date.now() - lastCalcAttempt >= CALC_RETRY_MS;
      if (!due && !calcForceRef.current) return;
      calcForceRef.current = false;
      calcAttempts += 1;
      lastCalcAttempt = Date.now();
      void requestGuide({ silent: true, macrosOnly: true });
      return;
    }
    const cooldown = lastAutoGuideFailed ? AUTO_GUIDE_BACKOFF_MS : AUTO_GUIDE_MIN_INTERVAL_MS;
    // El tope de un intento por minuto es para no repetir EL MISMO intento (el
    // bucle de alertas de 2026-09-01). Un motivo nuevo — cambió un plato de
    // hoy — no tiene por qué esperar al minuto del intento anterior.
    if (guideNeed === lastAutoGuideKey && Date.now() - lastAutoGuideAttempt < cooldown) return;
    lastAutoGuideKey = guideNeed;
    lastAutoGuideAttempt = Date.now();
    void requestGuide({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideNeed, generating, calcTick]);

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
  // El registro del día se casa con las comidas que esta persona planifica de
  // verdad: `daily_logs.habits` se escribe UNA vez, al crear el día, y lo crea
  // quien lo toque primero (abrir el chat antes que Hoy lo dejaba vacío), así
  // que sin esto una comida descartada en el onboarding seguía saliendo aquí.
  // Mismo criterio que la web (src/routes/_authenticated/hoy.tsx).
  const reconciled = reconcileHabits(today?.habits, todayMeals);
  const habits = reconciled.habits;
  // Las comidas TAL Y COMO están guardadas, que es contra lo que se reconcilió.
  // React Query reusa el objeto si la fila vuelve igual, así que su identidad
  // sirve de disparador: cambia solo cuando el registro cambia de verdad.
  const storedHabits = today?.habits;
  // El plan y el registro del día se invalidan juntos tras un cambio de plato,
  // pero no vuelven a la vez.
  const settled = !todayQ.isFetching && !planQ.isFetching;
  useEffect(() => {
    if (!today || !reconciled.changed || !settled) return;
    // `habits` es una única columna JSON y este camino manda la lista entera
    // derivada de la caché, así que se escribe solo si la fila sigue siendo la
    // que se reconcilió: si entre medias la ha tocado otro camino
    // (`patchTodayHabits` de un cambio de plato, el lote del picoteo, la web),
    // se abandona en vez de pisarlo. Lo reconciliado se pinta igual, y el
    // siguiente render lo reintenta ya con datos frescos. Mismo criterio que la
    // web (src/routes/_authenticated/hoy.tsx).
    void patchTodayHabits((stored) => (sameHabits(stored, storedHabits) ? reconciled.habits : null))
      .then((next) => {
        if (!next) return;
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
      })
      // Sin aviso: es una reparación de fondo, no una acción de la persona.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today?.id, storedHabits, reconciled.changed, settled]);
  const doneCount = habits.filter((h) => h.done).length;
  // La barra de macros suma solo lo ya marcado como comido ("comí esto" /
  // "comí distinto"), no el menú completo del día: así deshacer una comida
  // la mueve, en vez de quedarse fija en un total del día entero. Se muestra
  // siempre (arrancando en 0) para que se vea cómo se va llenando según se
  // marcan comidas, en vez de aparecer de golpe con la primera.
  // El picoteo del día (`daily_logs.snacks`) también suma: es comida de verdad,
  // aunque no cuente como comida del plan.
  const snacks = cleanDaySnacks(today?.snacks);
  const doneMacros = addMacros(
    sumDoneMacros(guide?.mealMacros, habits) ?? ZERO_MACROS,
    snackTotals(snacks),
  );
  // El deporte del día (`daily_logs.exercise`) no suma a las macros: es un
  // gasto, no algo que se coma.
  const exercise = cleanDayExercise(today?.exercise);

  // Los planes ya generados se hicieron antes de que existiera el objetivo
  // (ticket 07): si el plan de hoy suma muy por debajo, se dice.
  // Solo en un plan anterior al ticket 23 (sin objetivo por comida ni
  // estructura): uno nuevo que se quede corto no se "preparó antes".
  const planShortOfTarget =
    !!dayTarget &&
    !!guide?.macroEstimate &&
    !planQ.data?.plan?.targetsVersion &&
    guide.macroEstimate.kcal < dayTarget.kcal * 0.85;

  // La copia del objetivo en la guía de hoy se mantiene al día: es la que usa
  // el semáforo de este día cuando ya sea pasado. Se relee la fila antes de
  // escribir para no pisar una regeneración recién guardada. Igual que la web.
  useEffect(() => {
    if (!today?.guide || !dayTarget || generating) return;
    if (today.guide.targets?.kcal === dayTarget.kcal) return;
    void fetchTodayLog()
      .then((fresh) => {
        if (!fresh?.guide || fresh.guide.targets?.kcal === dayTarget.kcal) return;
        return updateTodayLog({ guide: { ...fresh.guide, targets: dayTarget } }).then(() =>
          qc.invalidateQueries({ queryKey: ["today"] }),
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today?.id, today?.guide?.targets?.kcal, dayTarget?.kcal, generating]);
  const quote = quoteOfTheDay();

  // Picoteo, deporte y cambios de plato comparten UN solo asentamiento por
  // ráfaga (`day-settle.ts`): el desvío que decide si se recolocan los próximos
  // días es el del día entero, no el de cada origen por su cuenta. Ver
  // `day-balance.ts`.
  const daySettle = useDaySettle(today0, () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["plan"] });
  });
  const afterDayChange = () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    scheduleDaySettle(today0);
  };

  const afterExerciseChange = afterDayChange;
  const removeExercise = async (id: string) => {
    setRemovingExercise(id);
    try {
      await apiPost("exercise/remove", { today: today0, id });
      afterExerciseChange();
    } catch (e) {
      Alert.alert(e instanceof Error ? e.message : "No hemos podido quitar el deporte");
    } finally {
      setRemovingExercise(null);
    }
  };

  const afterSnackChange = afterDayChange;
  const removeSnack = async (id: string) => {
    setRemovingSnack(id);
    try {
      await apiPost("snacks/remove", { today: today0, id });
      afterSnackChange();
    } catch (e) {
      Alert.alert(e instanceof Error ? e.message : "No hemos podido quitar el picoteo");
    } finally {
      setRemovingSnack(null);
    }
  };

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

  // El desvío del día, sumando los tres orígenes, y lo que ya ha movido. Es lo
  // que pinta `DayBalanceCard` — el desglose sale de datos que ya estaban, no
  // de estado nuevo (ver `day-balance.ts`).
  const balance = dayBalance(habits, snacks, exercise);
  const adjustmentRecord = cleanDayAdjustment(today?.adjustment);
  const balanceChanges = adjustmentRecord?.adjustment?.changes ?? [];

  const pending = habits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.status == null)
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));
  const nextIndex = pending.length ? pending[0]!.i : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-52 pt-4"
        directionalLockEnabled
      >
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
        {showNumbers ? (
          <MacroBars
            estimate={doneMacros}
            target={dayTarget ?? guide?.macroEstimate ?? null}
            weightKg={profile?.current_weight_kg ?? null}
            pending={donePendingMeals(guide?.mealMacros, habits).length}
          />
        ) : null}
        {showNumbers && planShortOfTarget ? (
          <Text className="font-body mt-1.5 text-[10.5px] text-muted-foreground">
            Tu plan de este mes se hizo antes de calcular tu objetivo y sus platos suman menos de lo
            que necesitas: el mes que viene cuadrará.
          </Text>
        ) : null}

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
                ? `Guía del coach · ${caloriesText(energy, showNumbers)}`
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

          <ChildMealGapBanner
            names={pendingKidMeals.map((c) => c.name)}
            pending={fillKidsMut.isPending}
            onUpdate={() => fillKidsMut.mutate()}
          />

          {!habits.length ? (
            noPlanYet ? (
              // Un mes se genera una vez, tras la conversación con el coach en
              // Plan: aquí no se genera nada, solo se lleva allí.
              <Pressable
                onPress={() => router.navigate("/plan")}
                className="flex-row items-center gap-3 rounded-[20px] bg-surface p-4 active:opacity-80"
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                  <CalendarRange size={20} color="#ff8a3d" />
                </View>
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">
                    Prepara tu plan del mes
                  </Text>
                  <Text className="font-body text-xs text-muted-foreground">
                    Cinco preguntas sobre tu mes y te preparo las comidas y la compra.
                  </Text>
                </View>
                <ChevronRight size={16} color="#83796c" />
              </Pressable>
            ) : (
              <View className="rounded-[20px] bg-surface p-4">
                {todayQ.isError ? (
                  <Pressable onPress={() => todayQ.refetch()}>
                    <Text className="font-body-medium text-sm text-primary">
                      No hemos podido preparar las comidas de hoy. Reintentar
                    </Text>
                  </Pressable>
                ) : (
                  <Text className="font-body text-sm text-muted-foreground">
                    Preparando las comidas de hoy...
                  </Text>
                )}
              </View>
            )
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
                // El plato de este momento se ha cambiado hoy: el real en
                // naranja y debajo, tachada, la sugerencia ORIGINAL del plan
                // — congelada, así que sigue igual tras veinte cambios (ver
                // `plannedIdea` en lib/plan-shared.ts).
                const wasIdea = suggestedDish(h, dish);
                // Sin receta si el plato ya se cambió a mano: ya se sabe qué se
                // va a comer, así que enseñarla solo gastaría una llamada a la
                // IA sin aportar nada. Solo cuenta para quien de verdad lo
                // cambió (`dishChangeIsMine`), no para el resto del hogar.
                const mealKeyForPin = MOMENT_TO_MEAL_KEY[h.label] ?? "snack";
                const hideRecipe =
                  !!wasIdea && dishChangeIsMine(mealKeyForPin, homeCtxFor(todayWeekday));
                const note = offListNote(planned?.off);
                const shared = sharedWith(h.label);
                // D13: un plato sin cifra se dice, no se rellena con un promedio.
                const mealNumbers = guide?.mealMacros?.find(
                  (m) => m.moment === h.label && m.idea === dish,
                );
                // Sin cifras a la vista, "Calculando…" no dice nada; el aviso de
                // texto vago sí (le pide concretar).
                const calculating =
                  !!planned?.idea &&
                  mealNumbers?.status === "calculando" &&
                  (showNumbers || !!mealNumbers.vague);

                return (
                  <View
                    key={h.label}
                    className="rounded-[20px] px-3.5 py-3"
                    style={{
                      backgroundColor: isSkip
                        ? "#f0ede7"
                        : isDone
                          ? "#e1f2e4"
                          : tintBg(accent, isNext ? 22 : 13),
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
                        {calculating ? (
                          <View className="mt-1 flex-row items-center gap-1">
                            {mealNumbers?.vague ? null : (
                              <ActivityIndicator size="small" color="#83796c" />
                            )}
                            <Text className="font-body text-[11px] text-muted-foreground">
                              {mealNumbers?.vague
                                ? "Concreta qué comiste para poder calcularlo"
                                : "Calculando…"}
                            </Text>
                          </View>
                        ) : null}
                        <Text className="font-mono-medium mt-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                          {catInfo.label}
                        </Text>
                      </View>

                      {/* Acciones */}
                      <View className="flex-row items-center gap-1.5">
                        {/* Spinner mientras esta comida espera al lote del
                            día. Es por comida, no global: cambiar una no
                            bloquea las demás. El RESULTADO del ajuste ya no se
                            enseña aquí — lo movido lo decide el día entero, así
                            que atribuirlo a una comida era mentira: el servidor
                            escribía la misma lista en todas las del lote. Vive
                            en `DayBalanceCard`. */}
                        {mealSwap.isAdjusting(h.label) ? (
                          <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-primary/10">
                            <ActivityIndicator size="small" color="#ff8a3d" />
                          </View>
                        ) : null}
                        {isPending ? (
                          <>
                            <Pressable
                              onPress={() => setSwapIndex(i)}
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
                            onPress={() => clearMealStatus(i)}
                            className="h-[34px] w-[34px] items-center justify-center rounded-full bg-success"
                          >
                            <Undo2 size={15} color="#fbfaf7" strokeWidth={2.4} />
                          </Pressable>
                        ) : isSkip ? (
                          <Pressable
                            onPress={() => clearMealStatus(i)}
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
                      <View key={`${k.name}-${k.dish}`} className="mt-2">
                        <Text className="font-body text-[11px] leading-relaxed text-muted-foreground">
                          Para {k.name}: <Text className="text-foreground">{k.dish}</Text>
                          {offListNote(k.off) ? ` · ${offListNote(k.off)}` : ""}
                        </Text>
                        <DishRecipe dish={k.dish} month={month} />
                      </View>
                    ))}
                    {planned?.idea && !hideRecipe ? <DishRecipe dish={dish} month={month} /> : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Picoteo de hoy: lo apuntado y qué ha pasado con el plan ── */}
        <SnackCard
          showNumbers={showNumbers}
          snacks={snacks}
          removingId={removingSnack}
          onRemove={(id) => void removeSnack(id)}
        />

        {/* ── Deporte de hoy: mismo formato que el picoteo ── */}
        <ExerciseCard
          showNumbers={showNumbers}
          exercise={exercise}
          removingId={removingExercise}
          onRemove={(id) => void removeExercise(id)}
        />

        {/* ── Añadir picoteo: justo encima de "Registrar deporte" ── */}
        <Pressable
          onPress={() => setSnackOpen(true)}
          className="mt-6 flex-row items-center justify-center gap-2 rounded-full bg-surface py-3.5 active:opacity-80"
        >
          <Cookie size={16} color="#3e3d39" />
          <Text className="font-body-semibold text-sm text-foreground">Añadir picoteo</Text>
        </Pressable>

        {/* ── Registrar deporte: pegado encima de la tira de la semana ── */}
        <Pressable
          onPress={() => setActivityOpen(true)}
          className="mt-2.5 flex-row items-center justify-center gap-2 rounded-full bg-surface py-3.5 active:opacity-80"
        >
          <Activity size={16} color="#3e3d39" />
          <Text className="font-body-semibold text-sm text-foreground">Registrar deporte</Text>
        </Pressable>

        {/* ── Balance del día: la suma de los tres orígenes y lo que ha movido
             en los próximos días. Va DEBAJO de los dos botones que la
             alimentan, así que se lee como el resumen de todo lo de arriba. ── */}
        <DayBalanceCard
          showNumbers={showNumbers}
          onlyRoutineExercise={onlyRoutineExercise(exercise)}
          balance={balance}
          record={adjustmentRecord}
          settling={daySettle.pending || daySettle.running}
          failed={daySettle.failed}
          onShowAdjustment={() => setBalanceInfoOpen(true)}
        />

        {/* ── Tira de la semana ── */}
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
                mySlots={mySlots}
                homePlanner={homePlanner}
              />
            ) : null}
          </Animated.View>
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
        onSaved={afterSnackChange}
      />

      <ExerciseSheet
        showNumbers={showNumbers}
        weightKg={profile?.current_weight_kg ?? null}
        hasRoutine={!!energy && !energy.basis.legacyActivity && energy.basis.routineKcal > 0}
        open={activityOpen}
        onOpenChange={setActivityOpen}
        today={today0}
        onSaved={afterExerciseChange}
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
  const isPast = date < todayISO();

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
      {isPast ? (
        <View className="mt-3 rounded-3xl bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <ChevronDown size={16} color="#6dbe7b" />
            <Text className="font-body-semibold text-sm text-foreground">
              {capitalizeFirst(
                new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
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
  const meals = mealsForDate(plan, date, selectedSlots);
  const day = planForDate(plan, date)?.day ?? null;
  const homeCtx: HouseholdPinContext | null = homePlanner
    ? { ...homePlanner, weekday: (new Date(`${date}T00:00:00`).getDay() + 6) % 7 }
    : null;
  const label = capitalizeFirst(
    new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
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
              label={m.moment}
              value={m.idea}
              note={offListNote(m.off)}
              recipeMonth={date.slice(0, 7)}
              pinned={isPinnedByViewer(day, m.slot, homeCtx)}
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

function ChatBubbleIcon() {
  return <MessageCircle size={22} color="#fbfaf7" />;
}
