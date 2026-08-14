import type { DailyLog } from "@/lib/daily";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function habitSignal(log: DailyLog | undefined, fallbackHabits: string[]) {
  const habits = log?.habits ?? (fallbackHabits ?? []).map((label) => ({ label, done: false }));

  if (!habits.length) return "none" as const;
  const done = habits.filter((h) => h.done).length;
  if (done >= 3) return "success" as const;
  if (done === 2) return "warning" as const;
  if (done === 1) return "danger" as const;
  return "none" as const;
}

export function WeekStrip({
  done,
  total,
  selected,
  onSelect,
  logs = [],
  todayHabits = [],
}: {
  done: number;
  total: number;
  selected?: string | null;
  onSelect?: (date: string) => void;
  logs?: DailyLog[];
  todayHabits?: string[];
}) {
  const today = new Date();
  const todayIso = iso(today);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const logByDate = new Map((logs ?? []).map((l) => [l.log_date, l]));

  const todaySignal =
    done >= 3 ? "success" : done === 2 ? "warning" : done === 1 ? "danger" : "none";

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto overflow-y-visible px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {days.map((d) => {
        const isToday = d.toDateString() === today.toDateString();
        const date = iso(d);
        const isOpen = selected === date;
        const isPast = date < todayIso;
        const signal = isToday
          ? todaySignal
          : isPast
            ? habitSignal(logByDate.get(date), todayHabits)
            : "none";

        const signalClass =
          signal === "success"
            ? "border-transparent bg-success text-success-foreground"
            : signal === "warning"
              ? "border-transparent bg-warning text-warning-foreground"
              : signal === "danger"
                ? "border-transparent bg-danger text-danger-foreground"
                : "";

        const baseClass = isToday
          ? signalClass || "border-transparent bg-foreground text-background"
          : isPast
            ? signalClass || "border-border bg-surface text-muted-foreground"
            : "border-border bg-surface text-muted-foreground";

        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect?.(date)}
            aria-expanded={isOpen}
            className={`flex min-w-[56px] flex-1 flex-col items-center gap-0.5 rounded-2xl border px-2 py-2.5 text-center transition-transform active:scale-95 ${baseClass} ${
              isOpen ? "ring-2 ring-inset ring-primary" : ""
            }`}
          >
            <span className="font-display text-lg leading-none">{d.getDate()}</span>
            <span className="text-[11px] font-semibold opacity-80">
              {DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
            </span>
          </button>
        );
      })}
      <div className="grid min-w-[56px] flex-1 place-items-center rounded-2xl border border-border bg-surface px-2 text-center">
        <span className="text-[11px] font-semibold leading-tight text-muted-foreground">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}
