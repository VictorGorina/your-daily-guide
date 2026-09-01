import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Activity, Check, ChevronDown, PencilLine, X } from "lucide-react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DishRecipe } from "@/components/dish-recipe";
import { DishCategoryIcon, foodBgStyle, FoodCategoryBadge } from "@/components/food-category-bg";
import { GuidedLogSheet } from "@/components/guided-log-sheet";
import { MacroBars } from "@/components/macro-bars";
import { NightlyReviewSheet } from "@/components/nightly-review-sheet";
import { WeekStrip } from "@/components/week-strip";
import { classifyDish, FOOD_CATEGORIES } from "@/lib/food-categories";
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
  type DailyLog,
  type MealStatus,
} from "@/lib/daily";

import { generateDailyGuide } from "@/lib/guide.functions";
import { sumDoneMacros, ZERO_MACROS } from "@/lib/macros";
import { fetchHousehold } from "@/lib/household";
import { sharedDays, type MealKey } from "@/lib/household-shared";
import { setPendingChatMessage } from "@/lib/pending-chat-message";
import { mealsForDate, offListNote, type MonthlyPlan } from "@/lib/plan-shared";
import { generateMonthlyPlan } from "@/lib/plan.functions";
import { applyTheme } from "@/lib/theme";
import { quoteOfTheDay } from "@/lib/quotes";

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
let lastAutoGuideAttempt = 0;

function Hoy() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const makePlan = useServerFn(generateMonthlyPlan);
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
    mutationFn: () => makePlan({ data: { month } }),
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
  const todayMeals = mealsForDate(planQ.data?.plan ?? null, today0);
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

  useEffect(() => {
    if (profileQ.isFetching) return;
    if (profileQ.isSuccess && (!profile || !profile.onboarding_completed)) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [profileQ.isSuccess, profileQ.isFetching, profile, navigate]);

  useEffect(() => {
    if (profile?.theme) applyTheme(profile.theme);
  }, [profile?.theme]);

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
      await updateTodayLog({ guide: g });
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      // El reintento automático (`silent`) falla sin ruido: hay un botón
      // "Generar" a la vista para reintentar a mano, y así un fallo no deja un
      // toast por cada vez que Hoy se vuelve a montar.
      if (!silent) toast.error("El coach no ha podido responder ahora mismo");
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
  const habits = today?.habits ?? [];
  const doneCount = habits.filter((h) => h.done).length;
  // La barra de macros suma solo lo ya marcado como comido ("comí esto" /
  // "comí distinto"), no el menú completo del día: así deshacer una comida
  // la mueve, en vez de quedarse fija en un total del día entero. Se muestra
  // siempre (arrancando en 0) para que se vea cómo se va llenando según se
  // marcan comidas, en vez de aparecer de golpe con la primera.
  const doneMacros = sumDoneMacros(guide?.mealMacros, habits) ?? ZERO_MACROS;

  const quote = quoteOfTheDay();
  const dateLabel = new Date(`${today0}T00:00:00`)
    .toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
    .replace(",", "");

  const setMealStatus = (index: number, status: MealStatus) => {
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    save.mutate({ habits: next });
  };

  const clearMealStatus = (index: number) => {
    const next = habits.map((h, i) => (i === index ? { ...h, status: undefined, done: false } : h));
    save.mutate({ habits: next });
  };

  const handleMealStatus = (index: number, status: MealStatus) => {
    setMealStatus(index, status);
    // "Comí distinto" queda registrado al instante, pero ofrecemos detallar qué
    // ha cambiado para que el coach ajuste solo los días futuros del plan.
    if (status === "distinto") setGuidedIndex(index);
  };

  const guidedMeal = guidedIndex != null ? habits[guidedIndex] : undefined;

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
              // El coach cambió el plato de este momento hoy (desde el chat o
              // desde "comí otra cosa"): se muestra el plato real en naranja,
              // con el que había antes tachado debajo — ver `wasIdea` en
              // daily.ts. Si el cambio acaba coincidiendo otra vez con lo que
              // había (p.ej. se revierte), deja de contar como editado.
              const wasIdea = h.wasIdea && h.wasIdea !== idea ? h.wasIdea : null;

              return (
                <div
                  key={h.label}
                  className="rounded-[20px] px-3.5 py-3.5 transition-[background-color,opacity] duration-300"
                  style={{
                    backgroundColor: isSkip
                      ? "var(--color-muted)"
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
                      {h.status == null ? (
                        <>
                          <button
                            type="button"
                            title="Comí otra cosa"
                            aria-label={`${h.label}: comí otra cosa`}
                            onClick={() => handleMealStatus(i, "distinto")}
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
                          className="animate-pop grid h-[34px] w-[34px] place-items-center rounded-full transition-transform active:scale-95"
                          style={{ backgroundColor: cat.accent, color: onAccent(cat.accent) }}
                        >
                          <Check className="h-[17px] w-[17px]" strokeWidth={2.6} />
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
                  {shared ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      Base común con {shared} · marca “Comí otra cosa” si tu ración se sale de eso.
                    </p>
                  ) : null}
                  {idea ? <DishRecipe dish={idea} month={month} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Registrar deporte: pegado encima de la tira de la semana, como en la
          app móvil. Abre el registro guiado en modo actividad. */}
      <button
        type="button"
        onClick={() => setActivityOpen(true)}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-surface py-3.5 text-sm font-semibold text-foreground transition-transform active:scale-[0.99]"
      >
        <Activity className="h-4 w-4" aria-hidden />
        Registrar deporte
      </button>

      <section className="animate-rise mt-6">
        <WeekStrip
          selected={openDay}
          onSelect={(d) => setOpenDay((prev) => (prev === d ? null : d))}
          logs={logsQ.data ?? []}
          todayHabits={habits.length ? habits.map((h) => h.label) : todayMeals.map((m) => m.moment)}
        />
        {openDay ? <DayMenu date={openDay} plan={planQ.data?.plan ?? null} /> : null}
        <p className="mt-2.5 px-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
          Toca un día para ver su menú.
        </p>
      </section>

      <section className="mt-6 px-0.5">
        <p className="font-title text-sm leading-[1.45] tracking-[-0.01em] text-pretty text-muted-foreground">
          “{quote.text}”
        </p>
        <p className="mt-1.5 font-num text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
          {quote.author}
        </p>
      </section>

      <GuidedLogSheet
        trigger={false}
        initialMode="exceso"
        open={guidedIndex != null}
        onOpenChange={(v) => {
          if (!v) setGuidedIndex(null);
        }}
        contextNote={guidedMeal ? `Qué has comido en vez de: ${guidedMeal.label}` : undefined}
        mealLabel={guidedMeal?.label}
        onSkip={() => {
          if (guidedIndex != null) setMealStatus(guidedIndex, "salteo");
          setGuidedIndex(null);
        }}
        onSend={(text) => {
          setPendingChatMessage(text);
          setGuidedIndex(null);
          navigate({ to: "/chat" });
        }}
      />

      {/* Registrar deporte: mismo sheet, modo actividad, abierto desde el botón
          de encima de la tira de la semana. Igual que en la app móvil. */}
      <GuidedLogSheet
        trigger={false}
        initialMode="actividad"
        open={activityOpen}
        onOpenChange={setActivityOpen}
        onSend={(text) => {
          setPendingChatMessage(text);
          setActivityOpen(false);
          navigate({ to: "/chat" });
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
    </main>
  );
}

function DayMenu({ date, plan }: { date: string; plan: MonthlyPlan | null }) {
  // Mismas comidas que ve el día en su tarjeta (con los platos cambiados a mano
  // para ese día), no la lista entera de desayunos de la semana.
  const meals = mealsForDate(plan, date).filter((m) => m.idea);
  const label = new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="surface-card animate-sheet-up mt-3 p-4">
      <div className="flex items-center gap-2">
        <ChevronDown className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold capitalize">{label}</h3>
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
}: {
  label: string;
  value: string;
  note?: string | null;
  /** Si se pasa, el valor es un plato y se ofrece "Ver receta" para ese mes. */
  recipeMonth?: string;
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
          {recipeMonth ? <DishRecipe dish={value} month={recipeMonth} /> : null}
        </div>
      </div>
    </div>
  );
}
