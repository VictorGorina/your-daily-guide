import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Briefcase,
  Check,
  ChevronDown,
  Cookie,
  Home,
  Info,
  Loader2,
  PencilLine,
  Undo2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { AdjustmentInfoSheet } from "@/components/adjustment-info-sheet";
import { BottomNav } from "@/components/bottom-nav";
import { ChildMealGapBanner } from "@/components/child-meal-gap-banner";
import { DayDetailBody, type DayDetailHousehold } from "@/components/day-detail-sheet";
import { DishRecipe } from "@/components/dish-recipe";
import { ExerciseCard } from "@/components/exercise-card";
import { ExerciseSheet } from "@/components/exercise-sheet";
import { DishCategoryIcon, foodBgStyle, FoodCategoryBadge } from "@/components/food-category-bg";
import { MacroBars } from "@/components/macro-bars";
import { MealSwapSheet } from "@/components/meal-swap-sheet";
import { NightlyReviewSheet } from "@/components/nightly-review-sheet";
import { SnackCard } from "@/components/snack-card";
import { SnackSheet } from "@/components/snack-sheet";
import { WeekPager } from "@/components/week-pager";
import { classifyDish, FOOD_CATEGORIES } from "@/lib/food-categories";
import {
  ensureTodayLog,
  fetchLogs,
  fetchLogsForMonth,
  fetchMonthlyPlan,
  fetchProfile,
  impulsoFrom,
  monthISO,
  patchTodayHabits,
  saveProfile,
  todayISO,
  updateTodayLog,
  weeklyTrendFrom,
  type DailyLog,
  type MealStatus,
  type Profile,
} from "@/lib/daily";

import { generateDailyGuide } from "@/lib/guide.functions";
import { addMacros, mergeGuide, sumDoneMacros, ZERO_MACROS } from "@/lib/macros";
import { fetchHousehold } from "@/lib/household";
import {
  EMPTY_SCHEDULE,
  isSharedSlot,
  personColor,
  whoIsHome,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";
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
  type MealChange,
  type MealSlot,
  type MonthlyPlan,
} from "@/lib/plan-shared";
import { fillChildMeals, generateMonthlyPlan } from "@/lib/plan.functions";
import { scheduleExerciseSettle, useExerciseSettle } from "@/lib/exercise-settle";
import { cleanDayExercise } from "@/lib/exercise";
import { removeExercise as removeExerciseFn } from "@/lib/exercise.functions";
import { scheduleSnackSettle, useSnackSettle } from "@/lib/snack-settle";
import { cleanDaySnacks, snackTotals } from "@/lib/snacks";
import { removeSnack as removeSnackFn } from "@/lib/snacks.functions";
import { useMealSwap } from "@/lib/use-meal-swap";
import { applyTheme } from "@/lib/theme";
import { quoteOfTheDay } from "@/lib/quotes";
import { monthsOfWeek, weekDates, weekStartOf } from "@/lib/week-nav";
import { resolveDeviceTimeZone } from "@/lib/zoned-date";

// Misma curva que el resto de la app (docs/design-guidelines.md §7) y que
// `week-pager.tsx`, para que el panel del día y la tira se muevan igual.
const EASE = [0.22, 1, 0.36, 1] as const;

export const Route = createFileRoute("/_authenticated/hoy")({
  component: Hoy,
});

// Orden cronológico aproximado de cada momento, para saber cuál toca ahora.
// Las comidas que no aparecen (nombres personalizados desde el chat) caen
// en un rango intermedio en vez de romper el orden.
const MOMENT_RANK: Record<string, number> = {
  Desayuno: 0,
  Comida: 1,
  Merienda: 2,
  Snack: 2,
  Cena: 3,
};
const rankOf = (label: string) => MOMENT_RANK[label] ?? 1.5;

// Hora orientativa de cada momento del día. La app no guarda horas por comida
// (el perfil solo tiene `meal_schedule` en texto libre), así que la tira usa
// estas de referencia; un momento con nombre propio simplemente no muestra
// hora. Coherentes con MOMENT_RANK para que la tira se lea de arriba abajo.
const MOMENT_TIME: Record<string, string> = {
  Desayuno: "8:30",
  Almuerzo: "11:00",
  Comida: "14:00",
  Merienda: "17:30",
  Snack: "17:30",
  Cena: "20:30",
};

// Solo desayuno/comida/cena pueden ser comidas compartidas del hogar (el snack no).
const MOMENT_TO_MEAL_KEY: Record<string, MealKey | undefined> = {
  Desayuno: "desayuno",
  Comida: "comida",
  Cena: "cena",
};

/** Tinte del acento de la categoría sobre la superficie del tema activo. */
const tint = (accent: string, pct: number) =>
  `color-mix(in oklab, ${accent} ${pct}%, var(--color-surface))`;

/**
 * Color legible encima de un acento de categoría. Los acentos claros (lácteos,
 * cereales, aves) dejarían invisible un check blanco, así que se decide por
 * luminancia. Son hex fijos, independientes del tema, por eso el par de
 * contraste también lo es.
 */
function onAccent(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return lum > 0.45 ? "#3e3d39" : "#fbfaf7";
}

// Ventana mínima entre intentos automáticos de generar el plan del mes,
// persistida en localStorage (a diferencia de `autoPlanTriedRef`, que solo
// protege dentro de un mismo montaje) para que sobreviva a que la persona
// cierre y reabra la app. Sin esto, cerrar y reabrir varias veces por
// impaciencia mientras la IA todavía está generando el plan anterior podría
// lanzar una llamada a IA nueva en cada apertura. Es una heurística, no una
// garantía: la generación real puede tardar más o menos que esta ventana.
const AUTO_PLAN_MIN_INTERVAL_MS = 60_000;
const autoPlanAttemptKey = (month: string) => `ydg:autoPlanAttempt:${month}`;

/** ms desde el último intento (de cualquier apertura de la app), o null si no hay uno registrado. */
function msSinceLastAutoPlanAttempt(month: string): number | null {
  try {
    const raw = localStorage.getItem(autoPlanAttemptKey(month));
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? Date.now() - at : null;
  } catch {
    return null;
  }
}

function markAutoPlanAttempt(month: string) {
  try {
    localStorage.setItem(autoPlanAttemptKey(month), String(Date.now()));
  } catch {
    // Modo privado u otro bloqueo de storage: sin memoria entre relanzamientos,
    // pero no bloquea la generación de este montaje.
  }
}

// La guía del día se pide sola al abrir Hoy si falta o está incompleta. Dos
// salvaguardas para que ese reintento automático no se convierta en spam:
//   1. Si falla, no se avisa (`silent`): el toast de error solo sale al pulsar
//      "Generar" a mano. Si no, cada fallo mientras Hoy se re-monta (el backend
//      caído un rato, volver a la pantalla) deja un toast tras otro.
//   2. No se relanza sola más de una vez por minuto entre montajes (variable a
//      nivel de módulo, no por montaje), para no martillear la IA. Mismo
//      criterio que `AUTO_PLAN_MIN_INTERVAL_MS`.
const AUTO_GUIDE_MIN_INTERVAL_MS = 60_000;
const AUTO_GUIDE_BACKOFF_MS = 600_000;
let lastAutoGuideAttempt = 0;
let lastAutoGuideFailed = false;
/** Por qué se pidió la guía la última vez (ver `guideNeed`). */
let lastAutoGuideKey = "";

function Hoy() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const makePlan = useServerFn(generateMonthlyPlan);
  const fillKids = useServerFn(fillChildMeals);
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [exerciseInfoOpen, setExerciseInfoOpen] = useState(false);
  const [removingExercise, setRemovingExercise] = useState<string | null>(null);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackInfoOpen, setSnackInfoOpen] = useState(false);
  const [removingSnack, setRemovingSnack] = useState<string | null>(null);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);
  const autoPlanTriedRef = useRef(false);
  const [autoPlanThrottled, setAutoPlanThrottled] = useState(false);
  // ---- Cambio de plato directo (sin pasar por el chat del coach) ----
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [infoIndex, setInfoIndex] = useState<number | null>(null);

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
    mutationFn: () => makePlan({ data: { month, today: todayISO() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) => {
      toast.error(
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
    const elapsed = msSinceLastAutoPlanAttempt(month);
    if (elapsed == null) markAutoPlanAttempt(month);
    const wait = elapsed == null ? 0 : Math.max(0, AUTO_PLAN_MIN_INTERVAL_MS - elapsed);
    if (wait > 0) setAutoPlanThrottled(true);
    const timer = setTimeout(() => {
      setAutoPlanThrottled(false);
      autoPlan.mutate();
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQ.data?.onboarding_completed, noPlanYet]);

  const today0 = todayISO();
  const [visibleWeek, setVisibleWeek] = useState(() => weekStartOf(today0));
  // Dirección (izquierda/derecha) del último cambio de día abierto en la
  // tira, para que el panel entre desde el lado del día tocado (ver
  // `DayPanel` más abajo). Se fija al tocar un día nuevo; da igual mientras
  // `openDay` sea null.
  const [dayDir, setDayDir] = useState(1);
  const appStartedOn = profileQ.data?.app_started_on ?? null;

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
  const todayMeals = mealsForDate(planQ.data?.plan ?? null, today0, mySlots);
  const todayWeekday = (new Date(`${today0}T00:00:00`).getDay() + 6) % 7;
  // Base para `dishChangeIsMine`/`isPinnedByViewer` (issue: en un hogar
  // compartido, un plato fijado o cambiado por quien planifica se veía como
  // "cambiado a mano" también para el resto, y les ocultaba "Ver receta" sin
  // que ellos hubieran tocado nada).
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
      return { meHome: true, others: [] };
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
  // Platos aparte de los niños de la casa para ese momento de hoy (issue 07):
  // el plato compartido no les sirve ese día y el plan lleva el suyo.
  const childMealsFor = (label: string) => {
    const mealKey = MOMENT_TO_MEAL_KEY[label];
    const kids = householdQ.data?.children ?? [];
    if (!mealKey || !kids.length) return [];
    return kids.flatMap((c) =>
      childMealsForDate(planQ.data?.plan ?? null, today0, c.id)
        .filter((k) => k.slot === mealKey)
        .map((k) => ({ name: c.name, dish: k.dish, off: k.off })),
    );
  };

  // Peques de triturados a los que les falta su puré HOY en el plan — pasa
  // cuando se dan de alta o cambian de etapa después de generar el plan del
  // mes, porque solo la IA de `generateMonthlyPlan` rellena `days[].kids`.
  // Dispara el aviso de "Actualizar" (`ChildMealGapBanner`).
  const householdBaseline = householdQ.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
  const pendingKidMeals = (householdQ.data?.children ?? []).filter(
    (c) =>
      c.feeding_stage === "triturados" &&
      childPureeGaps(
        planQ.data?.plan ?? null,
        { id: c.id, stage: c.feeding_stage, homeSchedule: c.home_schedule ?? householdBaseline },
        today0,
      ).some((g) => g.date === today0),
  );

  const fillKidsMut = useMutation({
    mutationFn: () => fillKids({ data: { today: today0 } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      toast.success(
        res.filled ? `Menú de ${res.children.join(", ")} actualizado` : "Ya estaba al día",
      );
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : "No hemos podido actualizar el menú de los peques",
      ),
  });

  const todayQ = useQuery({
    queryKey: ["today"],
    queryFn: () => ensureTodayLog(todayMeals.map((m) => m.moment)),
    // Espera a que el plan mensual haya terminado de cargar. Si no hay plan
    // todavía, espera además a que termine (con éxito o no) la generación
    // automática de arriba, para no crear el registro de hoy con comidas
    // vacías mientras el plan se está preparando.
    enabled:
      !!profileQ.data?.onboarding_completed &&
      planQ.isFetched &&
      (!!planQ.data || autoPlan.isError),
  });

  const profile = profileQ.data;
  const today = todayQ.data;

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

  // Si la persona ha viajado (o el perfil trae la zona por defecto de antes de
  // esta feature), se actualiza `profiles.timezone` en silencio para que el
  // push del servidor siga usando su hora local. Barato: solo escribe si cambia.
  useEffect(() => {
    if (!profile?.onboarding_completed) return;
    const deviceTz = resolveDeviceTimeZone();
    if (deviceTz && profile.timezone !== deviceTz) {
      // Best-effort: si la escritura falla (p. ej. la migración todavía no está
      // aplicada) no pasa nada, se reintenta en la siguiente carga de Hoy.
      saveProfile({ timezone: deviceTz }).catch(() => {});
    }
  }, [profile?.onboarding_completed, profile?.timezone]);

  const save = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateTodayLog(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: () => toast.error("No hemos podido guardar el cambio"),
  });

  const guide = today?.guide ?? null;

  const requestGuide = async ({ silent = false }: { silent?: boolean } = {}) => {
    setGenerating(true);
    try {
      const g = await makeGuide({
        data: {
          meals: todayMeals.filter((m) => m.idea).map((m) => ({ moment: m.moment, idea: m.idea })),
        },
      });
      // Si la generación vuelve con el texto de respaldo y sin cifras, se
      // conservan las que ya tuviera el día: regenerar nunca debe dejar la
      // barra de macros peor de como estaba (ver `mergeGuide`).
      await updateTodayLog({ guide: mergeGuide(today?.guide, g) });
      lastAutoGuideFailed = false;
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      if (silent) {
        lastAutoGuideFailed = true;
      } else {
        lastAutoGuideFailed = false;
        toast.error("El coach no ha podido responder ahora mismo");
      }
    } finally {
      setGenerating(false);
    }
  };

  // Por qué habría que (re)generar la guía, como una cadena estable. Se calcula
  // fuera del efecto a propósito: el efecto depende del MOTIVO y no del id del
  // registro, porque `today.id` no cambia en todo el día y en la app móvil la
  // pantalla de Hoy no se desmonta nunca (queda bajo el Stack de expo-router),
  // así que un cambio de plato no volvía a disparar nada y la barra de macros
  // se quedaba como estaba hasta pulsar "Generar" a mano.
  const guideNeed = (() => {
    if (!today) return "";
    const g = today.guide;
    if (!g || !g.meals?.length || !g.tips?.length) return "sin-guia";
    const dishes = todayMeals.filter((m) => m.idea);
    if (!dishes.length) return "";
    // Guía guardada de antes de que existiera la barra de macros (o el lookup
    // no salió): sin esto se queda sin barras para siempre, porque ya tiene
    // `meals`/`tips` y la condición de arriba no la pilla.
    if (g.macroEstimate == null || !g.mealMacros?.length) return "sin-macros";
    // El hogar puede espejar por detrás un cambio del planificador sobre una
    // comida compartida (ver `composeDayForUser`): el plato de hoy cambia sin
    // pasar por `use-meal-swap`, que es quien normalmente regenera la guía tras
    // un cambio. Si el plato de un momento ya no es el que tiene guardado
    // `mealMacros`, esa cifra ya no describe lo que hay en pantalla. Solo se
    // compara cuando la guía SÍ trajo `idea` (las guías anteriores a ese campo
    // no fuerzan una regeneración masiva).
    const stale = dishes.filter((m) => {
      const cached = g.mealMacros?.find((mm) => mm.moment === m.moment);
      return !!cached?.idea && cached.idea !== m.idea;
    });
    return stale.length ? `platos:${stale.map((m) => `${m.moment}=${m.idea}`).join("|")}` : "";
  })();

  useEffect(() => {
    if (!guideNeed || generating) return;
    const cooldown = lastAutoGuideFailed ? AUTO_GUIDE_BACKOFF_MS : AUTO_GUIDE_MIN_INTERVAL_MS;
    // El tope de un intento por minuto es para no repetir EL MISMO intento (ver
    // la memoria del bucle de reintentos de 2026-09-01). Un motivo nuevo —
    // cambió un plato de hoy — no tiene por qué esperar al minuto del intento
    // anterior, que era de otra cosa.
    if (guideNeed === lastAutoGuideKey && Date.now() - lastAutoGuideAttempt < cooldown) return;
    lastAutoGuideKey = guideNeed;
    lastAutoGuideAttempt = Date.now();
    void requestGuide({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideNeed, generating]);

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
  const weeklyTrend = weeklyTrendFrom(logsQ.data ?? []);
  // El registro del día se casa con las comidas que esta persona planifica de
  // verdad: `daily_logs.habits` se escribe UNA vez, al crear el día, y lo crea
  // quien lo toque primero (abrir el chat antes que Hoy lo dejaba vacío), así
  // que sin esto una comida descartada en el onboarding seguía saliendo aquí.
  // Se pinta siempre lo reconciliado, aunque el guardado de abajo falle.
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
    // Solo se guarda si de verdad cambia algo (si no, se escribiría en bucle),
    // y solo el día de hoy: un día pasado es un hecho, no una preferencia.
    if (!today || !reconciled.changed) return;
    // Y solo con las dos consultas asentadas: la reconciliación compara
    // `confirmedIdea` contra el plato que el plan tiene AHORA, así que con una
    // a medio refrescar daría por caducada una confirmación que sí vale (y la
    // borraría, que es justo lo que se está arreglando aquí).
    if (!settled) return;
    // `habits` es una única columna JSON y este camino manda la lista entera
    // derivada de la caché, así que se escribe solo si la fila sigue siendo la
    // que se reconcilió: si entre medias la ha tocado otro camino
    // (`patchTodayHabits` de un cambio de plato, el lote del picoteo, la app
    // móvil), se abandona en vez de pisarlo. Lo reconciliado se pinta igual, y
    // el siguiente render lo reintenta ya con datos frescos.
    void patchTodayHabits((stored) => (sameHabits(stored, storedHabits) ? reconciled.habits : null))
      .then((next) => {
        if (!next) return;
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
      })
      // Sin aviso: es una reparación de fondo, no una acción de la persona, y
      // lo reconciliado ya se está pintando aunque el guardado falle.
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

  // El reajuste de días futuros por el deporte va en un lote aparte (10 s de
  // calma), igual que el picoteo pero reponiendo energía en vez de quitarla.
  const removeExerciseCall = useServerFn(removeExerciseFn);
  const exerciseSettle = useExerciseSettle(today0, () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["plan"] });
  });
  const afterExerciseChange = () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    scheduleExerciseSettle(today0);
  };
  const removeExercise = async (id: string) => {
    setRemovingExercise(id);
    try {
      await removeExerciseCall({ data: { today: today0, id } });
      afterExerciseChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No hemos podido quitar el deporte");
    } finally {
      setRemovingExercise(null);
    }
  };

  // El reajuste de días futuros por el picoteo va en un lote aparte (10 s de
  // calma); al terminar puede haber cambiado el plan y el registro del día.
  const removeSnackCall = useServerFn(removeSnackFn);
  const snackSettle = useSnackSettle(today0, () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["plan"] });
  });
  const afterSnackChange = () => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    scheduleSnackSettle(today0);
  };
  const removeSnack = async (id: string) => {
    setRemovingSnack(id);
    try {
      await removeSnackCall({ data: { today: today0, id } });
      afterSnackChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No hemos podido quitar el picoteo");
    } finally {
      setRemovingSnack(null);
    }
  };

  const quote = quoteOfTheDay();
  const dateLabel = new Date(`${today0}T00:00:00`)
    .toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
    .replace(",", "");

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

  // Datos para el swap sheet y el info sheet
  const swapMeal =
    swapIndex != null ? todayMeals.find((m) => m.moment === habits[swapIndex]?.label) : undefined;
  const infoHabit = infoIndex != null ? habits[infoIndex] : undefined;
  const infoChanges: MealChange[] = infoHabit?.adjustmentChanges ?? [];

  // La "siguiente comida" es la primera, en orden cronológico, que aún no
  // tiene un estado explícito. Importante: se filtra por `status`, no por
  // `done` — "me lo salté" deja done:false a propósito (no cuenta como
  // hecho), pero sí queda resuelto, así que no debe seguir apareciendo como
  // "siguiente" ni bloquear para siempre el estado de "día completo" (ver
  // área 6 del roadmap UX, "casos límite").
  const pending = habits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.status == null)
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));
  const nextIndex = pending.length ? pending[0].i : null;

  // El día se lee como una tira de arriba abajo, así que las comidas van en
  // orden cronológico aunque el plan las guarde en otro orden.
  const dayStrip = habits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-44 pt-12 font-ui">
      <header className="animate-rise flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-num text-[11px] font-medium uppercase leading-none tracking-[0.09em] text-muted-foreground">
            {dateLabel}
          </p>
          <h1 className="mt-1.5 font-title text-[40px] font-semibold leading-[0.98] tracking-[-0.03em] text-foreground">
            Hoy
          </h1>
        </div>
        <div
          className="flex shrink-0 flex-col items-end gap-1"
          title="Impulso: sube con los días buenos, baja con los flojos, nunca vuelve a cero"
        >
          <div className="flex items-baseline gap-[3px]">
            <span className="font-title text-[26px] font-semibold leading-none tabular-nums text-foreground">
              {impulso}
            </span>
            <span className="font-num text-[11px] font-medium leading-none text-muted-foreground">
              %
            </span>
          </div>
          <span className="font-num text-[9.5px] font-medium uppercase leading-none tracking-[0.1em] text-muted-foreground">
            impulso
          </span>
        </div>
      </header>

      <MacroBars
        estimate={doneMacros}
        target={guide?.macroEstimate ?? null}
        weightKg={profile?.current_weight_kg ?? null}
      />

      {/* Guía del coach: solo el rango de calorías del día, en una fila, sin
          tarjeta expandible (intro, macros en texto, platos sugeridos,
          consejos) — se quería menos información. Igual que en la app móvil,
          y va justo aquí, antes de las comidas. */}
      <section className="animate-rise mt-6">
        <div className="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
          <span className="block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            {generating || (!guide && todayQ.isLoading)
              ? "Preparando tu guía del día..."
              : guide
                ? `Guía del coach · ${guide.calories}`
                : "Guía del coach"}
          </span>
          {!guide && !generating && !todayQ.isLoading ? (
            <button
              type="button"
              onClick={() => requestGuide()}
              className="shrink-0 text-xs font-medium text-primary"
            >
              Generar
            </button>
          ) : null}
        </div>
      </section>

      <section className="animate-rise mt-6">
        <div className="flex items-baseline justify-between gap-2.5">
          <h2 className="font-title text-[21px] font-semibold leading-none tracking-[-0.02em]">
            Comidas de hoy
          </h2>
          {habits.length ? (
            <span className="font-num text-[11px] font-medium tabular-nums text-muted-foreground">
              {doneCount} de {habits.length}
            </span>
          ) : null}
        </div>

        <ChildMealGapBanner
          names={pendingKidMeals.map((c) => c.name)}
          pending={fillKidsMut.isPending}
          onUpdate={() => fillKidsMut.mutate()}
        />

        {!habits.length ? (
          autoPlan.isError || todayQ.isError ? (
            // Mismo patrón que el fallback de "Guía del coach": si la generación
            // falla (o el registro de hoy no carga), se ofrece un reintento en vez
            // de dejar el texto de "preparando" colgado para siempre.
            <button
              type="button"
              onClick={() => (autoPlan.isError ? autoPlan.mutate() : todayQ.refetch())}
              className="mt-3.5 text-sm font-medium text-primary"
            >
              {autoPlan.isError
                ? "No hemos podido preparar tu menú del mes. Reintentar"
                : "No hemos podido preparar las comidas de hoy. Reintentar"}
            </button>
          ) : (
            <p className="mt-3.5 animate-pulse text-sm text-muted-foreground">
              {autoPlanThrottled
                ? "Ya se está preparando tu menú del mes..."
                : autoPlan.isPending
                  ? "Preparando tu menú del mes..."
                  : "Preparando las comidas de hoy..."}
            </p>
          )
        ) : (
          <div className="mt-3.5 flex flex-col gap-2.5">
            {dayStrip.map(({ h, i }) => {
              const planned = todayMeals.find((m) => m.moment === h.label);
              const idea = planned?.idea ?? "";
              const cat = FOOD_CATEGORIES[classifyDish(idea)];
              const isNext = i === nextIndex;
              const isSkip = h.status === "salteo";
              const note = offListNote(planned?.off);
              const shared = sharedWith(h.label);
              const kidMeals = childMealsFor(h.label);
              // El plato de este momento se ha cambiado hoy (desde el chat o
              // desde "comí otra cosa"): se muestra el real en naranja y debajo,
              // tachada, la sugerencia ORIGINAL del plan — congelada, así que
              // sigue siendo la misma tras veinte cambios (ver `plannedIdea` en
              // plan-shared.ts). Si se vuelve al plato sugerido, deja de contar
              // como editado.
              const wasIdea = suggestedDish(h, idea);
              // La receta solo se oculta si el cambio lo hizo la propia
              // persona: en un slot compartido, `wasIdea` también se dispara
              // cuando quien planifica cambia la comida de la casa después de
              // que esta persona ya vio el día — y no ha tocado nada ella.
              const mealKey = MOMENT_TO_MEAL_KEY[h.label] ?? "snack";
              const hideRecipe = !!wasIdea && dishChangeIsMine(mealKey, homeCtxFor(todayWeekday));

              return (
                <div
                  key={h.label}
                  className="rounded-[20px] px-3.5 py-3.5 transition-[background-color,opacity] duration-300"
                  style={{
                    backgroundColor: isSkip
                      ? "var(--color-muted)"
                      : h.done
                        ? "var(--color-success-soft)"
                        : tint(cat.accent, isNext ? 22 : 13),
                    opacity: isSkip ? 0.55 : 1,
                  }}
                >
                  <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3">
                    <span
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                      style={{ backgroundColor: tint(cat.accent, 20) }}
                    >
                      {idea ? <DishCategoryIcon dish={idea} size={18} /> : null}
                    </span>

                    <div className="min-w-0">
                      <span className="flex items-baseline gap-[7px]">
                        <span className="text-[11.5px] font-semibold tracking-[0.01em]">
                          {h.label}
                        </span>
                        {MOMENT_TIME[h.label] ? (
                          <span className="font-num text-[10.5px] text-muted-foreground">
                            {MOMENT_TIME[h.label]}
                          </span>
                        ) : null}
                      </span>
                      {/* El plato es el protagonista de la fila; cuando todavía
                          no hay menú, el hueco se rellena en pequeño y apagado
                          para no gritar lo que falta. */}
                      <span
                        className={`mt-1.5 block font-title tracking-[-0.02em] text-pretty ${
                          idea
                            ? `text-[16.5px] font-medium leading-tight ${
                                isSkip
                                  ? "text-muted-foreground line-through"
                                  : wasIdea
                                    ? "text-primary"
                                    : "text-foreground"
                              }`
                            : "text-[13px] leading-snug text-muted-foreground"
                        }`}
                      >
                        {idea || "Sin menú todavía"}
                      </span>
                      {wasIdea ? (
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground line-through">
                          {wasIdea}
                        </span>
                      ) : null}
                      {classifyDish(idea) !== "otro" ? (
                        <span className="mt-1.5 block font-num text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                          {cat.label}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Badge "i" / spinner de ajuste: el spinner sale mientras
                          esta comida espera al lote (los cambios seguidos se
                          agrupan en un solo reajuste), y el badge cuando ya hay
                          resultado. Es por comida, no global: cambiar una no
                          bloquea las demás. */}
                      {mealSwap.isAdjusting(h.label) ? (
                        <span
                          className="grid h-[26px] w-[26px] place-items-center rounded-full bg-primary/10"
                          title="Ajustando el plan…"
                        >
                          <Loader2 className="h-[14px] w-[14px] animate-spin text-primary" />
                        </span>
                      ) : h.adjustmentChanges ? (
                        <button
                          type="button"
                          title="Ver ajuste del plan"
                          aria-label={`${h.label}: ver ajuste del plan`}
                          onClick={() => setInfoIndex(i)}
                          className="grid h-[26px] w-[26px] place-items-center rounded-full bg-primary/10 text-primary transition-transform active:scale-95"
                        >
                          <Info className="h-[14px] w-[14px]" />
                        </button>
                      ) : null}

                      {h.status == null ? (
                        <>
                          <button
                            type="button"
                            title="Comí otra cosa"
                            aria-label={`${h.label}: comí otra cosa`}
                            onClick={() => setSwapIndex(i)}
                            className="grid h-[30px] w-[30px] place-items-center rounded-full bg-surface text-muted-foreground transition-transform active:scale-95"
                          >
                            <PencilLine className="h-[15px] w-[15px]" />
                          </button>
                          <button
                            type="button"
                            title="Comí esto"
                            aria-label={`${h.label}: comí esto`}
                            onClick={() => setMealStatus(i, "plan")}
                            className="grid h-[34px] w-[34px] place-items-center rounded-full transition-transform active:scale-95"
                            style={{
                              backgroundColor: cat.accent,
                              color: onAccent(cat.accent),
                            }}
                          >
                            <Check className="h-[17px] w-[17px]" strokeWidth={2.6} />
                          </button>
                        </>
                      ) : h.done ? (
                        <button
                          type="button"
                          title="Deshacer"
                          aria-label={`${h.label}: deshacer`}
                          onClick={() => clearMealStatus(i)}
                          className="animate-pop grid h-[34px] w-[34px] place-items-center rounded-full bg-success text-success-foreground transition-transform active:scale-95"
                        >
                          <Undo2 className="h-[15px] w-[15px]" strokeWidth={2.4} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Deshacer"
                          aria-label={`${h.label}: deshacer`}
                          onClick={() => clearMealStatus(i)}
                          className="grid h-[34px] w-[34px] place-items-center rounded-full bg-secondary text-muted-foreground transition-transform active:scale-95"
                        >
                          <X className="h-[15px] w-[15px]" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Aviso, base compartida y receta van siempre a la vista, no
                      tras un toque oculto sin pista — como en la app móvil. La
                      receta es un disclosure con su propio abrir/cerrar y carga
                      perezosa (DishRecipe). */}
                  {note ? (
                    <span className="mt-3 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {note}
                    </span>
                  ) : null}
                  {(() => {
                    const comp = mealCompanions(h.label);
                    if (!comp) return null;
                    const hasOthers = comp.others.length > 0;
                    return (
                      <div className="mt-2 flex items-center gap-2">
                        {comp.meHome ? (
                          <Home className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {hasOthers ? (
                          <>
                            <span className="flex -space-x-1.5">
                              {comp.others.slice(0, 4).map((p) => {
                                const colors = personColor(p.id);
                                return (
                                  <span
                                    key={p.id}
                                    title={p.displayName}
                                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-background text-[9px] font-bold"
                                    style={{
                                      background: colors.soft,
                                      color: colors.ink,
                                    }}
                                  >
                                    {p.displayName.charAt(0)}
                                  </span>
                                );
                              })}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              Base común · "Comí otra cosa" si tu ración cambia
                            </span>
                          </>
                        ) : comp.meHome ? (
                          <span className="text-[11px] text-muted-foreground">Comes solo hoy</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Fuera de casa</span>
                        )}
                      </div>
                    );
                  })()}
                  {kidMeals.map((k) => (
                    <div key={`${k.name}-${k.dish}`} className="mt-2">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Para {k.name}: <span className="text-foreground">{k.dish}</span>
                        {offListNote(k.off) ? ` · ${offListNote(k.off)}` : ""}
                      </p>
                      <DishRecipe dish={k.dish} month={month} />
                    </div>
                  ))}
                  {/* Sin receta si el plato ya se cambió a mano: ya se sabe qué
                      se va a comer, así que enseñarla solo gastaría una
                      llamada a la IA sin aportar nada. En un hogar compartido
                      esto solo se aplica a quien de verdad lo cambió
                      (`hideRecipe`), no al resto de miembros. */}
                  {idea && !hideRecipe ? <DishRecipe dish={idea} month={month} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Picoteo de hoy: lo apuntado y qué ha pasado con el plan. */}
      <SnackCard
        snacks={snacks}
        settling={snackSettle.pending || snackSettle.running}
        failed={snackSettle.failed}
        removingId={removingSnack}
        onRemove={(id) => void removeSnack(id)}
        onShowAdjustment={() => setSnackInfoOpen(true)}
      />

      {/* Deporte de hoy: mismo formato que el picoteo, lo apuntado y qué ha
          pasado con el plan. */}
      <ExerciseCard
        exercise={exercise}
        settling={exerciseSettle.pending || exerciseSettle.running}
        failed={exerciseSettle.failed}
        removingId={removingExercise}
        onRemove={(id) => void removeExercise(id)}
        onShowAdjustment={() => setExerciseInfoOpen(true)}
      />

      {/* Añadir picoteo: justo encima de "Registrar deporte", como en móvil. */}
      <button
        type="button"
        onClick={() => setSnackOpen(true)}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-3.5 text-sm font-semibold text-foreground transition-transform active:scale-[0.99]"
      >
        <Cookie className="h-4 w-4" aria-hidden />
        Añadir picoteo
      </button>

      {/* Registrar deporte: mismo formato que "Añadir picoteo", pegado encima
          de la tira de la semana, como en la app móvil. */}
      <button
        type="button"
        onClick={() => setActivityOpen(true)}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-3.5 text-sm font-semibold text-foreground transition-transform active:scale-[0.99]"
      >
        <Activity className="h-4 w-4" aria-hidden />
        Registrar deporte
      </button>

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
          </AnimatePresence>
        </motion.div>
        <p className="mt-2.5 px-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
          {openDay && openDay < todayISO()
            ? "Toca una comida para corregir lo que comiste."
            : "Toca un día para ver su menú."}
        </p>
      </section>

      <section className="mt-6 px-0.5">
        <p className="font-title text-sm leading-[1.45] tracking-[-0.01em] text-pretty text-muted-foreground">
          "{quote.text}"
        </p>
        <p className="mt-1.5 font-num text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {quote.author}
        </p>
      </section>

      {/* Cambio de plato directo: mini-sheet con solo texto libre. El swap
          se aplica al instante (setPlanMeal) y el ajuste del plan futuro corre
          en segundo plano (adjustMonthlyPlan) — sin navegar al chat. */}
      <MealSwapSheet
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
        onSwap={(dish) => {
          if (!swapMeal) return;
          void mealSwap.swap(swapMeal.moment, swapMeal.slot, dish);
          setSwapIndex(null);
        }}
        onSkip={() => {
          if (swapIndex != null) setMealStatus(swapIndex, "salteo");
          setSwapIndex(null);
        }}
      />

      {/* Info del ajuste del plan tras un swap: lista antes → después. */}
      <AdjustmentInfoSheet
        open={infoIndex != null}
        onOpenChange={(v) => {
          if (!v) setInfoIndex(null);
        }}
        changes={infoChanges}
        kcalDelta={infoHabit?.adjustmentKcal ?? null}
        dish={
          infoIndex != null
            ? (todayMeals.find((m) => m.moment === habits[infoIndex]?.label)?.idea ??
              "lo que comiste")
            : "lo que comiste"
        }
      />

      <SnackSheet
        open={snackOpen}
        onOpenChange={setSnackOpen}
        today={today0}
        onSaved={afterSnackChange}
      />

      {/* Qué ha movido el picoteo en los próximos días. */}
      <AdjustmentInfoSheet
        open={snackInfoOpen}
        onOpenChange={setSnackInfoOpen}
        changes={snacks?.adjustment?.changes ?? []}
        kcalDelta={snacks?.adjustment?.kcal ?? null}
        dish="tu picoteo de hoy"
      />

      <ExerciseSheet
        open={activityOpen}
        onOpenChange={setActivityOpen}
        today={today0}
        onSaved={afterExerciseChange}
      />

      {/* Qué ha repuesto el deporte en los próximos días. */}
      <AdjustmentInfoSheet
        open={exerciseInfoOpen}
        onOpenChange={setExerciseInfoOpen}
        changes={exercise?.adjustment?.changes ?? []}
        kcalDelta={exercise?.adjustment?.kcal ?? null}
        dish="tu deporte de hoy"
        verb="hacer"
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
              new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
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
  // Mismas comidas que ve el día en su tarjeta (con los platos cambiados a mano
  // para ese día), no la lista entera de desayunos de la semana.
  const meals = mealsForDate(plan, date, selectedSlots);
  // Día crudo del plan, para saber qué slots están fijados a mano (`pinned`) y
  // no ofrecerles receta: ya se sabe qué se va a comer, así que enseñarla solo
  // gastaría una llamada a la IA sin aportar nada — salvo que el cambio lo
  // haya hecho otra persona del hogar (`isPinnedByViewer`).
  const day = planForDate(plan, date)?.day ?? null;
  const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
  const homeCtx: HouseholdPinContext | null = homePlanner ? { ...homePlanner, weekday } : null;
  const label = capitalizeFirst(
    new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );

  return (
    <div className="surface-card animate-sheet-up mt-3 p-4">
      <div className="flex items-center gap-2">
        <ChevronDown className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      {meals.length ? (
        <div className="mt-3 space-y-2">
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
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Aún no hay menú para este día. Crea tu plan del mes en la pestaña Plan.
        </p>
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
