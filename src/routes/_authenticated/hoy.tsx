import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, PencilLine, X } from "lucide-react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DishRecipe } from "@/components/dish-recipe";
import { DishImage, foodBgStyle, FoodCategoryBadge } from "@/components/food-category-bg";
import { GuidedLogSheet } from "@/components/guided-log-sheet";
import { NightlyReviewSheet } from "@/components/nightly-review-sheet";
import { WeekStrip } from "@/components/week-strip";
import { classifyDish, dishAsset, FOOD_CATEGORIES } from "@/lib/food-categories";
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
  type DailyLog,
  type MealStatus,
} from "@/lib/daily";

import {
  generateDailyGuide,
  type MacroEstimate,
  type MealMacroEstimate,
} from "@/lib/guide.functions";
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

function Hoy() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const makePlan = useServerFn(generateMonthlyPlan);
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [expandedMeal, setExpandedMeal] = useState<number | null>(null);
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
    autoPlan.mutate();
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

  const requestGuide = async () => {
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
      toast.error("El coach no ha podido responder ahora mismo");
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
    if (!g || !g.meals?.length || !g.tips?.length || missingMacros) void requestGuide();
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
          <p className="mt-3.5 animate-pulse text-sm text-muted-foreground">
            {autoPlan.isPending
              ? "Preparando tu menú del mes..."
              : "Preparando las comidas de hoy..."}
          </p>
        ) : (
          <div className="mt-3.5 flex flex-col gap-2.5">
            {dayStrip.map(({ h, i }) => {
              const planned = todayMeals.find((m) => m.moment === h.label);
              const idea = planned?.idea ?? "";
              const cat = FOOD_CATEGORIES[classifyDish(idea)];
              const isNext = i === nextIndex;
              const isSkip = h.status === "salteo";
              const isExpanded = expandedMeal === i;
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
                      className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full text-base"
                      style={{ backgroundColor: tint(cat.accent, 20) }}
                    >
                      {dishAsset(idea) ? <DishImage dish={idea} size={40} /> : null}
                    </span>

                    <button
                      type="button"
                      onClick={() => setExpandedMeal((prev) => (prev === i ? null : i))}
                      aria-expanded={isExpanded}
                      className="min-w-0 text-left"
                    >
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
                    </button>

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
                            title="Me lo salté"
                            aria-label={`${h.label}: me lo salté`}
                            onClick={() => setMealStatus(i, "salteo")}
                            className="grid h-[30px] w-[30px] place-items-center rounded-full bg-surface text-muted-foreground transition-transform active:scale-95"
                          >
                            <X className="h-3.5 w-3.5" />
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

                  {isExpanded ? (
                    <div className="animate-sheet-up mt-3 pt-3">
                      {note ? (
                        <span className="mb-2 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {note}
                        </span>
                      ) : null}
                      {shared ? (
                        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                          Base común con {shared} · marca “Comí otra cosa” si tu ración se sale de
                          eso.
                        </p>
                      ) : null}
                      {idea ? (
                        <>
                          <FoodCategoryBadge dish={idea} />
                          <DishRecipe dish={idea} month={month} />
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Crea el menú del mes en la pestaña Plan para ver aquí el plato.
                        </p>
                      )}
                      {h.status != null ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => handleMealStatus(i, s)}
                              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors active:scale-95 ${
                                h.status === s
                                  ? "bg-foreground text-background"
                                  : "bg-surface text-muted-foreground"
                              }`}
                            >
                              {MEAL_STATUS_LABEL[s]}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => clearMealStatus(i)}
                            className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-destructive bg-destructive/10 transition-colors active:scale-95"
                          >
                            Deshacer
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-4">
        <button
          type="button"
          onClick={() => setGuideOpen((o) => !o)}
          aria-expanded={guideOpen}
          className="flex w-full items-center justify-between gap-2.5 rounded-2xl bg-surface px-4 py-3.5 text-left"
        >
          <span className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-muted-foreground">
            <span className="block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {/* `calories` es una frase entera del coach, no una cifra: se recorta
                a una línea para que la fila siga siendo una fila. */}
            <span className="truncate">
              Guía del coach{guide?.calories ? ` · ${guide.calories}` : ""}
            </span>
          </span>
          <span className="font-num text-[11px] font-medium text-muted-foreground">
            {guideOpen ? "cerrar" : "ver"}
          </span>
        </button>
        {guideOpen ? (
          <div className="surface-card animate-sheet-up mt-2 p-5">
            {generating || (!guide && todayQ.isLoading) ? (
              <p className="animate-pulse text-sm text-muted-foreground">
                Preparando tu guía del día...
              </p>
            ) : guide ? (
              <div className="space-y-3 text-sm">
                <p className="hyphens-auto text-justify leading-relaxed text-foreground">
                  {guide.intro}
                </p>
                <div className="grid gap-2">
                  <Field label="Energía" value={guide.calories} />
                  <Field label="Macros" value={guide.macros} />
                </div>
                {guide.meals?.length ? (
                  <div className="space-y-2 pt-1">
                    <span className="font-num text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      Platos sugeridos
                    </span>
                    {guide.meals.map((m) => (
                      <div
                        key={m.moment}
                        className="flex items-center gap-3 rounded-xl p-3"
                        style={foodBgStyle(m.idea)}
                      >
                        <DishImage dish={m.idea} size={36} />
                        <span className="shrink-0 text-xs font-semibold text-primary">
                          {m.moment}
                        </span>
                        <div className="min-w-0">
                          <span className="text-sm text-foreground">{m.idea}</span>
                          <div className="mt-1">
                            <FoodCategoryBadge dish={m.idea} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {guide.tips?.length ? (
                  <div className="space-y-1.5 pt-1">
                    <span className="font-num text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      Consejos de nutrición
                    </span>
                    <ul className="space-y-1.5">
                      {guide.tips.map((t) => (
                        <li key={t} className="flex gap-2 text-sm text-foreground">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span className="min-w-0">{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <button onClick={requestGuide} className="text-sm font-medium text-primary">
                Generar guía
              </button>
            )}
          </div>
        ) : null}
      </section>

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
        onSend={(text) => {
          setPendingChatMessage(text);
          setGuidedIndex(null);
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

/** Punto de partida de la barra de macros mientras no hay nada que sumar
 * todavía (guía sin cargar o ninguna comida marcada): la sección se muestra
 * igual, en 0, en vez de esperar a la primera comida confirmada. */
const ZERO_MACROS: MacroEstimate = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

/**
 * Suma las estimaciones por plato (`mealMacros`) de las comidas que ya están
 * marcadas como comidas ("comí esto" / "comí distinto"), para que la barra
 * de Hoy refleje solo lo confirmado — no el menú del día entero de golpe.
 * Deshacer una comida la resta de la suma, igual que el contador "x de y".
 * null cuando la guía todavía no trae `mealMacros` — el caller cae entonces a
 * `ZERO_MACROS` para seguir mostrando la barra (en 0) en vez de ocultarla.
 */
function sumDoneMacros(
  mealMacros: MealMacroEstimate[] | null | undefined,
  habits: DailyLog["habits"],
): MacroEstimate | null {
  if (!mealMacros?.length) return null;
  const doneLabels = new Set(
    habits.filter((h) => h.status === "plan" || h.status === "distinto").map((h) => h.label),
  );
  const totals: MacroEstimate = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const m of mealMacros) {
    if (!doneLabels.has(m.moment)) continue;
    totals.kcal += m.kcal;
    totals.protein_g += m.protein_g;
    totals.carbs_g += m.carbs_g;
    totals.fat_g += m.fat_g;
    totals.fiber_g += m.fiber_g;
  }
  return totals;
}

/**
 * Referencia genérica (no personalizada por profesional alguno) de respaldo,
 * solo para cuando todavía no hay `macroEstimate` del día (guía sin generar o
 * sin plan). La proteína se ajusta al peso (~1,2 g/kg, cifra habitual para
 * población general); carbohidratos, grasa y fibra usan un valor fijo. En
 * cuanto hay guía, el objetivo real es el total estimado para los platos
 * reales de hoy (`macroEstimate`) — así comer todo el menú se acerca al 100%,
 * en vez de compararse contra una referencia genérica que puede no cuadrar
 * con ese menú. Todo el bloque es orientativo — ver el aviso bajo la barra.
 */
function macroTargets(weightKg: number | null) {
  const proteinTarget = Math.round(Math.min(200, Math.max(45, (weightKg ?? 70) * 1.2)));
  return { protein_g: proteinTarget, carbs_g: 250, fat_g: 70, fiber_g: 30 };
}

const MACRO_BAR_ITEMS = [
  { key: "protein_g", label: "prot", color: "var(--color-chart-1)" },
  { key: "carbs_g", label: "carb", color: "var(--color-chart-2)" },
  { key: "fat_g", label: "gras", color: "var(--color-chart-3)" },
  { key: "fiber_g", label: "fibra", color: "var(--color-chart-4)" },
] as const;

/**
 * `target` es el `macroEstimate` del día (calculado por el coach a partir de
 * los platos reales de hoy) cuando ya existe; si un plato cambia a mano (el
 * coach lo recalcula, ver `cambiar_plato` en use-coach-actions.ts), este
 * objetivo se actualiza con él. Solo cae a la referencia genérica de peso
 * (`macroTargets`) mientras aún no hay guía. El porcentaje NO se recorta a
 * 100: si ya comiste de más, la barra se queda llena pero el número de al
 * lado enseña el exceso (p.ej. "132 g · 118%"); ese número solo se muestra
 * cuando el objetivo es el real de hoy, no la referencia genérica.
 */
function MacroBars({
  estimate,
  target,
  weightKg,
}: {
  estimate: MacroEstimate;
  target: MacroEstimate | null;
  weightKg: number | null;
}) {
  const fallbackTargets = macroTargets(weightKg);
  return (
    <section className="animate-rise mt-[22px]">
      <div className="grid grid-cols-4 gap-2.5">
        {MACRO_BAR_ITEMS.map((it) => {
          const value = estimate[it.key];
          const goal = target?.[it.key] || fallbackTargets[it.key];
          const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;
          const width = Math.min(100, pct);
          return (
            <div key={it.key} className="min-w-0">
              <div className="h-[5px] overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-out"
                  style={{ width: `${width}%`, backgroundColor: it.color }}
                />
              </div>
              <p className="mt-[7px] truncate font-num text-[9.5px] font-medium uppercase leading-none tracking-[0.06em] text-muted-foreground">
                {it.label}
              </p>
              <p className="mt-[3px] font-num text-[11px] font-medium leading-none tabular-nums text-foreground">
                {value} g{target ? ` · ${pct}%` : ""}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        ~{estimate.kcal} kcal de lo que llevas comido hoy: estimación orientativa, no un conteo
        nutricional exacto.
      </p>
    </section>
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
        {recipeMonth ? <DishImage dish={value} size={32} /> : null}
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
