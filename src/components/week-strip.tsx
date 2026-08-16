import { ratioSignal, type DailyLog } from "@/lib/daily";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function habitSignal(log: DailyLog | undefined, fallbackHabits: string[]) {
  const habits = log?.habits ?? (fallbackHabits ?? []).map((label) => ({ label, done: false }));
  return ratioSignal(habits.filter((h) => h.done).length, habits.length);
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

  const todaySignal = ratioSignal(done, total);

  return (
    <div className="grid grid-cols-7 gap-1.5">
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
              : signal === "muted"
                ? "border-transparent bg-muted text-muted-foreground"
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
            className={`flex flex-col items-center gap-0.5 rounded-2xl border px-1 py-2.5 text-center transition-transform active:scale-95 ${baseClass} ${
              isOpen ? "ring-2 ring-inset ring-primary" : ""
            }`}
          >
            <span className="font-display text-lg leading-none">{d.getDate()}</span>
            <span className="text-[10px] font-semibold opacity-80">
              {DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
