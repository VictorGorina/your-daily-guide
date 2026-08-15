import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ChevronDown, Flame, Sparkle } from "lucide-react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { MonthCalendar } from "@/components/month-calendar";
import { WeekStrip } from "@/components/week-strip";
import {
  ensureTodayLog,
  fetchLogs,
  fetchMonthlyPlan,
  fetchProfile,
  monthISO,
  streakFrom,
  todayISO,
  updateTodayLog,
  type DailyLog,
} from "@/lib/daily";

import { generateDailyGuide } from "@/lib/guide.functions";
import { mealsForDate, planForDate } from "@/lib/plan-shared";
import { applyTheme } from "@/lib/theme";
import { quoteOfTheDay } from "@/lib/quotes";

export const Route = createFileRoute("/_authenticated/hoy")({
  component: Hoy,
});

const HABIT_COLORS = ["bg-habit-1", "bg-habit-2", "bg-habit-3", "bg-habit-4"];

type MealStatus = "plan" | "distinto" | "salteo";

const MEAL_STATUS_LABEL: Record<MealStatus, string> = {
  plan: "Comí lo del plan",
  distinto: "Comí distinto",
  salteo: "Me lo salté",
};

function Hoy() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const makeGuide = useServerFn(generateDailyGuide);
  const [generating, setGenerating] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });

  const today0 = todayISO();
  const todayMeals = mealsForDate(planQ.data?.plan ?? null, today0);

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

  const streak = streakFrom(logsQ.data ?? []);
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

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-36 pt-12">
      <header className="animate-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted-foreground">{greeting},</p>
          <h1 className="truncate font-display text-[2.6rem] leading-[1.05] text-foreground">
            {profile?.display_name || "Vamos allá"}
          </h1>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-bold text-background">
          <Flame className="h-3.5 w-3.5" /> {streak}
        </span>
      </header>

      <p className="animate-rise mt-2 text-sm italic leading-snug text-muted-foreground">
        “{quote.text}” <span className="not-italic">— {quote.author}</span>
      </p>

      <section className="animate-rise mt-5">
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

      <section className="surface-card animate-rise mt-8 p-5">
        <div className="flex items-center gap-2">
          <Sparkle className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Tu guía de hoy</h2>
        </div>
        {generating || (!guide && todayQ.isLoading) ? (
          <p className="mt-3 animate-pulse text-sm text-muted-foreground">
            Preparando tu guía del día...
          </p>
        ) : guide ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="leading-relaxed text-foreground">{guide.intro}</p>
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
                    className="flex gap-3 rounded-xl border border-border bg-surface p-3"
                  >
                    <span className="shrink-0 text-xs font-semibold text-primary">{m.moment}</span>
                    <span className="min-w-0 text-sm text-foreground">{m.idea}</span>
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
          <button onClick={requestGuide} className="mt-3 text-sm font-medium text-primary">
            Generar guía
          </button>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">Comidas de hoy</h2>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-secondary-foreground">
            {doneCount}/{habits.length}
          </span>
        </div>
        <div className="grid gap-3">
          {habits.map((h, i) => {
            const idea = todayMeals.find((m) => m.moment === h.label)?.idea;
            const status = h.status;
            return (
              <div
                key={h.label}
                className={`habit-tile p-5 ${HABIT_COLORS[i % HABIT_COLORS.length]}`}
              >
                <span className="block font-display text-lg leading-tight">{h.label}</span>
                {idea ? (
                  <span className="mt-0.5 block text-sm opacity-80">{idea}</span>
                ) : (
                  <span className="mt-0.5 block text-xs font-semibold opacity-70">
                    {status ? MEAL_STATUS_LABEL[status] : "Pendiente hoy"}
                  </span>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setMealStatus(i, s)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 ${
                        status === s
                          ? "border-habit-foreground bg-habit-foreground text-background"
                          : "border-habit-foreground/40 text-habit-foreground/80"
                      }`}
                    >
                      {MEAL_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <MonthCalendar
        logs={logsQ.data ?? []}
        plan={planQ.data?.plan ?? null}
        planHabits={habits.length ? habits.map((h) => h.label) : todayMeals.map((m) => m.moment)}
      />

      <BottomNav />
    </main>
  );
}

function DayMenu({ date, plan }: { date: string; plan: Parameters<typeof planForDate>[0] }) {
  const found = planForDate(plan, date);
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
      {found?.day ? (
        <div className="mt-3 space-y-2">
          {found.week.breakfasts.length ? (
            <Field label="Desayuno" value={found.week.breakfasts.join(" · ")} />
          ) : null}
          <Field label="Comida" value={found.day.lunch} />
          <Field label="Cena" value={found.day.dinner} />
          {found.week.snacks.length ? (
            <Field label="Snacks" value={found.week.snacks.join(" · ")} />
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Aún no hay menú para este día. Crea tu plan del mes en la pestaña Plan.
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 p-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <p className="mt-0.5 text-sm text-foreground">{value}</p>
    </div>
  );
}
