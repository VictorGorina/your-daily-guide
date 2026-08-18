import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Flame, Sparkle, X } from "lucide-react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DishRecipe } from "@/components/dish-recipe";
import { foodBgStyle, FoodCategoryBadge } from "@/components/food-category-bg";
import { GuidedLogSheet } from "@/components/guided-log-sheet";
import { NightlyReviewSheet } from "@/components/nightly-review-sheet";
import { WeekStrip } from "@/components/week-strip";
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

import { generateDailyGuide } from "@/lib/guide.functions";
import { fetchHousehold } from "@/lib/household";
import { sharedDays, type MealKey } from "@/lib/household-shared";
import { setPendingChatMessage } from "@/lib/pending-chat-message";
import { mealsForDate, offListNote, type MonthlyPlan } from "@/lib/plan-shared";
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

// Solo desayuno/comida/cena pueden ser comidas compartidas del hogar (el snack no).
const MOMENT_TO_MEAL_KEY: Record<string, MealKey | undefined> = {
  Desayuno: "desayuno",
  Comida: "comida",
  Cena: "cena",
};

function Hoy() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [expandedMeal, setExpandedMeal] = useState<number | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [nightlyOpen, setNightlyOpen] = useState(false);
  const nightlyAutoOpenedRef = useRef(false);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

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
    // Espera a que el plan mensual haya terminado de cargar (con o sin datos)
    // para crear el registro de hoy con las comidas reales del día.
    enabled: !!profileQ.data?.onboarding_completed && planQ.isFetched,
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
      const g = await makeGuide({ data: undefined } as never);
      await updateTodayLog({ guide: g });
      qc.invalidateQueries({ queryKey: ["today"] });
    } catch {
      toast.error("El coach no ha podido responder ahora mismo");
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
  const nextMeal = nextIndex != null ? habits[nextIndex] : null;
  const nextPlanned = nextMeal ? todayMeals.find((m) => m.moment === nextMeal.label) : undefined;
  const expandedPlanned =
    expandedMeal != null
      ? todayMeals.find((m) => m.moment === habits[expandedMeal]?.label)
      : undefined;
  const nextIdea = nextPlanned?.idea;
  const allDone = habits.length > 0 && nextIndex == null;

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-36 pt-12">
      <header className="animate-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted-foreground">{greeting},</p>
          <h1 className="truncate font-display text-[2.6rem] leading-[1.05] text-foreground">
            {profile?.display_name || "Vamos allá"}
          </h1>
        </div>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-bold text-background"
          title="Impulso: sube con los días buenos, baja con los flojos, nunca vuelve a cero"
        >
          <Flame className="h-3.5 w-3.5" /> {impulso}%
        </span>
      </header>

      <p className="animate-rise mt-2 text-sm italic leading-snug text-muted-foreground">
        “{quote.text}” <span className="not-italic">— {quote.author}</span>
      </p>

      <section className="animate-rise mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">Comidas de hoy</h2>
          {habits.length ? (
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold tabular-nums text-secondary-foreground">
              {doneCount}/{habits.length}
            </span>
          ) : null}
        </div>

        {!habits.length ? (
          <div className="surface-card p-5">
            <p className="animate-pulse text-sm text-muted-foreground">
              Preparando las comidas de hoy...
            </p>
          </div>
        ) : allDone ? (
          <div className="surface-card flex items-center gap-3 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight">Todo registrado hoy</p>
              <p className="text-sm text-muted-foreground">
                Has anotado las {habits.length} comidas del día.
              </p>
            </div>
          </div>
        ) : nextMeal ? (
          <div className="rounded-3xl bg-primary p-5 text-neutral-200">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-200/70">
              Siguiente · {nextMeal.label}
            </span>
            <p className="mt-1 font-display text-xl leading-snug">
              {nextIdea || "Aún no hay menú para esta comida"}
            </p>
            {offListNote(nextPlanned?.off) ? (
              <p className="mt-1.5 text-xs text-neutral-200/80">{offListNote(nextPlanned?.off)}</p>
            ) : null}
            {sharedWith(nextMeal.label) ? (
              <p className="mt-1.5 text-xs text-neutral-200/80">
                Base común con {sharedWith(nextMeal.label)}. ¿Ración distinta? dilo en "comiste otra
                cosa".
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setMealStatus(nextIndex!, "plan")}
              className="mt-4 w-full rounded-full bg-primary-foreground py-3 text-sm font-semibold text-primary transition-transform active:scale-[0.98]"
            >
              Comí esto
            </button>
            <div className="mt-2.5 flex items-center justify-center gap-5 text-xs font-medium text-neutral-200/80">
              <button type="button" onClick={() => handleMealStatus(nextIndex!, "distinto")}>
                ¿comiste otra cosa?
              </button>
              <button type="button" onClick={() => setMealStatus(nextIndex!, "salteo")}>
                me lo salté
              </button>
            </div>
          </div>
        ) : null}

        {habits.length ? (
          <div className="mt-3 flex gap-2">
            {habits.map((h, i) => {
              const isNext = i === nextIndex;
              const isDone = h.done;
              const isSkipped = h.status === "salteo";
              return (
                <button
                  key={h.label}
                  type="button"
                  onClick={() => setExpandedMeal((prev) => (prev === i ? null : i))}
                  aria-expanded={expandedMeal === i}
                  className={`flex-1 rounded-2xl border px-2 py-2.5 text-center transition-colors active:scale-95 ${
                    isNext
                      ? "border-primary bg-primary-soft"
                      : isDone
                        ? "border-success/30 bg-success/10"
                        : isSkipped
                          ? "border-border bg-secondary/50"
                          : "border-border bg-surface"
                  } ${expandedMeal === i ? "ring-2 ring-inset ring-primary" : ""}`}
                >
                  <span className="block truncate text-[11px] font-semibold text-foreground">
                    {h.label}
                  </span>
                  <span className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground">
                    {isDone ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : isSkipped ? (
                      <X className="h-3 w-3" />
                    ) : null}
                    {isNext ? "ahora" : isDone ? "hecho" : isSkipped ? "saltado" : "pendiente"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {expandedMeal != null ? (
          <div
            className="surface-card animate-sheet-up mt-2 p-4"
            style={expandedPlanned?.idea ? foodBgStyle(expandedPlanned.idea) : {}}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="block font-display text-sm">{habits[expandedMeal].label}</span>
              {expandedPlanned?.idea ? <FoodCategoryBadge dish={expandedPlanned.idea} /> : null}
            </div>
            {expandedPlanned?.idea ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {expandedPlanned.idea}
              </span>
            ) : null}
            {offListNote(expandedPlanned?.off) ? (
              <span className="mt-1.5 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
                {offListNote(expandedPlanned?.off)}
              </span>
            ) : null}
            {sharedWith(habits[expandedMeal].label) ? (
              <span className="mt-1.5 block text-xs text-primary">
                Base común con {sharedWith(habits[expandedMeal].label)} · marca "Comí distinto" si
                tu ración se sale de eso
              </span>
            ) : null}
            {expandedPlanned?.idea ? (
              <DishRecipe dish={expandedPlanned.idea} month={month} />
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    handleMealStatus(expandedMeal, s);
                    setExpandedMeal(null);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 ${
                    habits[expandedMeal].status === s
                      ? "border-foreground bg-foreground text-background"
                      : "border-input text-muted-foreground"
                  }`}
                >
                  {MEAL_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-4">
        <button
          type="button"
          onClick={() => setGuideOpen((o) => !o)}
          aria-expanded={guideOpen}
          className="flex w-full items-center justify-between rounded-2xl border border-dashed border-border px-4 py-3 text-left text-xs font-medium text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Sparkle className="h-3.5 w-3.5 text-primary" />
            Guía del coach{guide?.calories ? ` · ${guide.calories}` : ""}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${guideOpen ? "rotate-180" : ""}`}
          />
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
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Platos sugeridos
                    </span>
                    {guide.meals.map((m) => (
                      <div
                        key={m.moment}
                        className="flex gap-3 rounded-xl border border-border p-3"
                        style={foodBgStyle(m.idea)}
                      >
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
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
          done={doneCount}
          total={habits.length}
          selected={openDay}
          onSelect={(d) => setOpenDay((prev) => (prev === d ? null : d))}
          logs={logsQ.data ?? []}
          todayHabits={habits.length ? habits.map((h) => h.label) : todayMeals.map((m) => m.moment)}
        />
        {openDay ? <DayMenu date={openDay} plan={planQ.data?.plan ?? null} /> : null}
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">Toca un día para ver su menú.</p>
      </section>

      <GuidedLogSheet
        trigger={false}
        initialMode="exceso"
        open={guidedIndex != null}
        onOpenChange={(v) => {
          if (!v) setGuidedIndex(null);
        }}
        contextNote={guidedMeal ? `Qué has comido en vez de: ${guidedMeal.label}` : undefined}
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
  );
}
