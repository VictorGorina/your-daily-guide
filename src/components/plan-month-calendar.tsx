import { useState } from "react";

import { DishRecipe } from "@/components/dish-recipe";
import { foodBgStyle, FoodCategoryBadge } from "@/components/food-category-bg";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ratioSignal, todayISO, type DailyLog } from "@/lib/daily";
import {
  isBeforeAppStart,
  mealsForDate,
  offListNote,
  planForDate,
  type MonthlyPlan,
  type PlanMonthStatus,
} from "@/lib/plan-shared";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

const dayNum = (date: string) => Number(date.slice(8, 10));

const SIGNAL_CLASS: Record<string, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  muted: "bg-muted text-muted-foreground",
};

/**
 * Calendario del mes. Además del menú por día (hoy y días futuros abren un
 * diálogo con los platos), los días pasados llevan el semáforo de cumplimiento
 * — verde/amarillo/gris, sin rojo — y al tocarlos abren el detalle reducido del
 * día (`onOpenDay`). Es el navegador del historial desde que se fundió la
 * subpestaña Historial en Plan.
 */
export function PlanMonthCalendar({
  plan,
  month,
  logs,
  monthStatus,
  appStartedOn,
  onOpenDay,
}: {
  plan: MonthlyPlan | null;
  month: string;
  logs: DailyLog[];
  monthStatus: PlanMonthStatus;
  appStartedOn: string | null;
  onOpenDay: (date: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const [year, m] = month.split("-").map(Number);
  const monthIdx = (m ?? 1) - 1;
  const y = year ?? new Date().getFullYear();
  const daysInMonth = new Date(y, monthIdx + 1, 0).getDate();
  const firstOffset = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  // Un plan creado a media de mes no cubre los días previos: sin menú, se
  // muestran apagados (salvo que haya registro de ese día).
  const fromDay = plan?.coverage?.fromDay ?? 1;

  const logByDate = new Map(logs.map((l) => [l.log_date, l]));

  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(i + 1)),
  ];

  const detail = selected ? planForDate(plan, selected) : null;
  const meals = selected ? mealsForDate(plan, selected).filter((mm) => mm.idea) : [];

  const hint =
    monthStatus === "past"
      ? "Toca un día para ver lo que comiste y sus macros."
      : "Toca un día pasado para ver lo que comiste; uno futuro para su menú.";

  return (
    <div className="surface-card p-5">
      <h2 className="text-sm font-semibold">Calendario del mes</h2>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`} className="text-[11px] font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} />;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          const log = logByDate.get(date);
          const isToday = date === today;
          const isPast = date < today;
          const inertBefore = isBeforeAppStart(date, appStartedOn) || dayNum(date) < fromDay;

          // Día previo a la fecha de alta o a la cobertura del plan, y sin
          // registro: no hay nada que enseñar, no se puede abrir.
          if (inertBefore && !log) {
            return (
              <span
                key={date}
                aria-hidden
                className="grid aspect-square place-items-center rounded-xl bg-muted/50 text-sm text-muted-foreground/40"
              >
                {dayNum(date)}
              </span>
            );
          }

          if (isPast) {
            const habits = log?.habits ?? [];
            const signal = ratioSignal(habits.filter((h) => h.done).length, habits.length);
            const signalClass = SIGNAL_CLASS[signal] ?? "bg-secondary/70 text-muted-foreground";
            return (
              <button
                key={date}
                onClick={() => onOpenDay(date)}
                aria-label={`Ver el día ${dayNum(date)}`}
                className={`aspect-square rounded-xl text-sm transition-all active:scale-95 ${signalClass}`}
              >
                {dayNum(date)}
              </button>
            );
          }

          return (
            <button
              key={date}
              onClick={() => setSelected(date)}
              className={`aspect-square rounded-xl text-sm transition-all active:scale-95 ${
                isWeekend ? "bg-accent/60 text-accent-foreground" : "bg-secondary text-foreground"
              } ${isToday ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
            >
              {dayNum(date)}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Verde: todas las comidas. Amarillo: comiste algo. Gris: sin comidas ese día.
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

          {detail ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {detail.week.label} · {detail.week.focus}
              </p>
              <div className="space-y-2">
                {meals.map((meal) => (
                  <div key={meal.slot} className="rounded-xl p-3" style={foodBgStyle(meal.idea)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-primary">{meal.moment}</span>
                      <FoodCategoryBadge dish={meal.idea} />
                    </div>
                    <p className="mt-1 text-sm text-foreground">{meal.idea}</p>
                    {offListNote(meal.off) ? (
                      <span className="mt-1.5 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {offListNote(meal.off)}
                      </span>
                    ) : null}
                    <DishRecipe dish={meal.idea} month={month} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este día todavía no tiene menú en el plan.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
