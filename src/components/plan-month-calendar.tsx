import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { todayISO } from "@/lib/daily";
import { planForDate, type MonthlyPlan } from "@/lib/plan-shared";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

export function PlanMonthCalendar({ plan, month }: { plan: MonthlyPlan; month: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const [year, m] = month.split("-").map(Number);
  const monthIdx = (m ?? 1) - 1;
  const y = year ?? new Date().getFullYear();
  const daysInMonth = new Date(y, monthIdx + 1, 0).getDate();
  const firstOffset = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(i + 1)),
  ];

  const detail = selected ? planForDate(plan, selected) : null;

  return (
    <div className="surface-card p-5">
      <h2 className="text-sm font-semibold">Calendario del mes</h2>
      <p className="mt-1 text-xs text-muted-foreground">Toca un día para ver su menú completo.</p>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`} className="text-[11px] font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} />;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          return (
            <button
              key={date}
              onClick={() => setSelected(date)}
              className={`aspect-square rounded-xl border text-sm transition-all active:scale-95 ${
                isWeekend
                  ? "border-accent/40 bg-accent/30 text-accent-foreground"
                  : "border-border bg-surface text-foreground"
              } ${date === today ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""} ${
                date < today && !isWeekend ? "text-muted-foreground" : ""
              }`}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>

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
                {(
                  [
                    ["Desayuno", detail.week.breakfasts?.join(" · ")],
                    ["Comida", detail.day?.lunch],
                    ["Cena", detail.day?.dinner],
                    ["Snacks", detail.week.snacks?.join(" · ")],
                  ] as const
                )
                  .filter(([, value]) => Boolean(value))
                  .map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-border bg-surface p-3">
                      <span className="text-xs font-semibold text-primary">{label}</span>
                      <p className="mt-1 text-sm text-foreground">{value}</p>
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
