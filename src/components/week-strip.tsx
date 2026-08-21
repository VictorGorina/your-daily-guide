import { ratioSignal, type DailyLog } from "@/lib/daily";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function habitSignal(log: DailyLog | undefined, fallbackHabits: string[]) {
  const habits = log?.habits ?? (fallbackHabits ?? []).map((label) => ({ label, done: false }));
  return ratioSignal(habits.filter((h) => h.done).length, habits.length);
}

/**
 * Tira de la semana. El día de hoy va siempre en oscuro como marca de "estás
 * aquí" — su progreso ya lo cuentan el contador "x de y" y el estado de cada
 * comida, así que la tira no lo repite. Los días pasados llevan el semáforo de
 * cumplimiento (sin rojo) y los futuros quedan en neutro, con el fin de semana
 * apenas teñido para que se distinga de un vistazo.
 */
export function WeekStrip({
  selected,
  onSelect,
  logs = [],
  todayHabits = [],
}: {
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

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((d) => {
        const isToday = d.toDateString() === today.toDateString();
        const date = iso(d);
        const isOpen = selected === date;
        const isPast = date < todayIso;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const signal = isPast ? habitSignal(logByDate.get(date), todayHabits) : "none";

        const signalClass =
          signal === "success"
            ? "bg-success text-success-foreground"
            : signal === "warning"
              ? "bg-warning text-warning-foreground"
              : signal === "muted"
                ? "bg-muted text-muted-foreground"
                : "";

        const baseClass = isToday
          ? "bg-foreground text-background"
          : isPast
            ? signalClass || "bg-secondary text-muted-foreground"
            : isWeekend
              ? ""
              : "bg-secondary text-muted-foreground";

        // El fin de semana futuro se tiñe con el naranja de la paleta en vez de
        // con un color propio, así sigue al tema activo (incluido "noche").
        const weekendStyle =
          !isToday && !isPast && isWeekend
            ? {
                backgroundColor:
                  "color-mix(in oklab, var(--color-chart-2) 18%, var(--color-surface))",
                color: "color-mix(in oklab, var(--color-chart-2) 55%, var(--color-foreground))",
              }
            : undefined;

        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelect?.(date)}
            aria-expanded={isOpen}
            style={weekendStyle}
            className={`rounded-[14px] px-1 pt-2.5 pb-2 text-center transition-transform active:scale-95 ${baseClass} ${
              isOpen ? "ring-2 ring-inset ring-primary" : ""
            }`}
          >
            <span className="block font-title text-[15px] font-semibold leading-none">
              {d.getDate()}
            </span>
            <span className="mt-1 block font-num text-[8.5px] font-medium uppercase tracking-[0.05em] opacity-80">
              {DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
