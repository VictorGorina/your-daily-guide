import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { todayISO, type DailyLog } from "@/lib/daily";
import { planForDate, type MonthlyPlan } from "@/lib/plan-shared";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

type Props = {
  logs: DailyLog[];
  plan: MonthlyPlan | null;
  planHabits: string[];
};

export function MonthCalendar({ logs, plan, planHabits }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();
  const [cursor] = useState(() => new Date(`${today}T00:00:00`));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  const logByDate = useMemo(() => {
    const map = new Map<string, DailyLog>();
    for (const l of logs) map.set(l.log_date, l);
    return map;
  }, [logs]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(year, month, i + 1)),
  ];

  const habitState = (date: string) => {
    const log = logByDate.get(date);
    const habits = log?.habits ?? [];
    if (!habits.length) return { done: 0, total: 0, signal: "none" as const };
    const done = habits.filter((h) => h.done).length;
    return {
      done,
      total: habits.length,
      signal:
        done >= 3 ? ("success" as const) : done === 2 ? ("warning" as const) : ("danger" as const),
    };
  };

  const selectedLog = selected ? (logByDate.get(selected) ?? null) : null;
  const selectedPlan = selected ? planForDate(plan, selected) : null;
  const selectedHabits = selectedLog?.habits ?? [];
  const isFuture = selected ? selected > today : false;
  const isToday = selected === today;

  return (
    <section className="surface-card animate-rise mt-6 p-5">
      <h2 className="text-sm font-semibold capitalize">{monthLabel}</h2>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`} className="text-[11px] font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} />;
          const { signal } = habitState(date);
          const past = date < today;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          const weekendBase = isWeekend
            ? "border-accent/40 bg-accent/30 text-accent-foreground"
            : past
              ? "border-border bg-surface text-muted-foreground"
              : "border-border bg-surface text-foreground";
          const cellClass =
            signal === "success"
              ? "border-transparent bg-success text-success-foreground font-semibold"
              : signal === "warning"
                ? "border-transparent bg-warning text-warning-foreground font-semibold"
                : signal === "danger"
                  ? "border-transparent bg-danger text-danger-foreground font-semibold"
                  : weekendBase;
          return (
            <button
              key={date}
              onClick={() => setSelected(date)}
              className={`aspect-square rounded-xl border text-sm transition-all active:scale-95 ${cellClass} ${
                date === today ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
              } ${isWeekend && signal !== "none" ? "ring-1 ring-accent ring-offset-1 ring-offset-background" : ""}`}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Semáforo de hábitos: 1 completado = rojo, 2 = naranja, 3 o más = verde. Toca cualquier día
        para ver su menú.
      </p>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {selected
                ? new Date(`${selected}T00:00:00`).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })
                : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              {isFuture
                ? "Día futuro: este es el menú previsto en tu plan del mes."
                : isToday
                  ? "Hoy: tu menú y tus hábitos."
                  : "Día pasado: esto es lo que tocaba y cómo fueron tus hábitos."}
            </p>

            <div className="space-y-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Menú del día
              </span>
              {!isFuture && selectedLog?.guide?.meals?.length ? (
                selectedLog.guide.meals.map((m) => (
                  <Row key={m.moment} label={m.moment} value={m.idea} />
                ))
              ) : selectedPlan?.day ? (
                <>
                  <Row label="Comida" value={selectedPlan.day.lunch} />
                  <Row label="Cena" value={selectedPlan.day.dinner} />
                  {selectedPlan.week.breakfasts.length ? (
                    <Row label="Desayuno" value={selectedPlan.week.breakfasts.join(" · ")} />
                  ) : null}
                  {selectedPlan.week.snacks.length ? (
                    <Row label="Snacks" value={selectedPlan.week.snacks.join(" · ")} />
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aún no hay menú para este día. Crea tu plan del mes en la pestaña Plan.
                </p>
              )}
            </div>

            {!isFuture ? (
              <div className="space-y-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Hábitos del plan
                </span>
                {(selectedHabits.length
                  ? selectedHabits
                  : planHabits.map((label) => ({ label, done: false }))
                ).map((h) => (
                  <div
                    key={h.label}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                        h.done
                          ? "bg-success text-success-foreground"
                          : "bg-secondary/60 text-muted-foreground"
                      }`}
                    >
                      {h.done ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 text-sm">{h.label}</span>
                  </div>
                ))}
                {!selectedHabits.length ? (
                  <p className="text-xs text-muted-foreground">Sin registro de ese día.</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Hábitos previstos
                </span>
                {planHabits.map((label) => (
                  <div
                    key={label}
                    className="rounded-xl border border-border bg-surface p-3 text-sm"
                  >
                    {label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-surface p-3">
      <span className="shrink-0 text-xs font-semibold text-primary">{label}</span>
      <span className="min-w-0 text-sm">{value}</span>
    </div>
  );
}
