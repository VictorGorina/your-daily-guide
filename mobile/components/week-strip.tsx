import { Pressable, Text, View } from "react-native";

import { ratioSignal, type DailyLog } from "../lib/daily";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function habitSignal(log: DailyLog | undefined, fallbackHabits: string[]) {
  const habits = log?.habits ?? (fallbackHabits ?? []).map((label) => ({ label, done: false }));
  return ratioSignal(habits.filter((h) => h.done).length, habits.length);
}

// Clases de cada semáforo (verde/naranja/gris), sin rojo a propósito.
function signalClasses(signal: ReturnType<typeof ratioSignal>) {
  switch (signal) {
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "muted":
      return "bg-muted";
    default:
      return "";
  }
}
function signalText(signal: ReturnType<typeof ratioSignal>) {
  switch (signal) {
    case "success":
      return "text-success-foreground";
    case "warning":
      return "text-warning-foreground";
    case "muted":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

// Fin de semana futuro — mismo hex fijo que la web (docs/design-guidelines.md
// §2, tokens --weekend/--weekend-foreground en src/styles.css).
const WEEKEND_BG = "#f7e2ce";
const WEEKEND_TEXT = "#a85f24";

/**
 * Tira de la semana. El día de hoy va siempre en oscuro como marca de "estás
 * aquí" — su progreso ya lo cuentan el contador "x de y" y el estado de cada
 * comida, así que la tira no lo repite. Los días pasados llevan el semáforo de
 * cumplimiento (sin rojo) y los futuros quedan en neutro, con el fin de semana
 * apenas teñido para que se distinga de un vistazo. Mismo criterio que la web
 * (ver src/components/week-strip.tsx) — no se replica su CSS, sino su regla.
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

  // Fila de 7 columnas iguales (sin scroll horizontal ni la píldora de "x/y",
  // que ya se ve en el contador de "Comidas de hoy") para que la semana entera
  // quepa siempre en el ancho de la pantalla, del iPhone más estrecho en adelante.
  return (
    <View className="flex-row gap-1.5">
      {days.map((d) => {
        const isToday = d.toDateString() === today.toDateString();
        const date = iso(d);
        const isOpen = selected === date;
        const isPast = date < todayIso;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const signal = isPast ? habitSignal(logByDate.get(date), todayHabits) : "none";
        const isFutureWeekend = !isToday && !isPast && isWeekend;

        const containerBase = isToday
          ? "bg-foreground"
          : isPast
            ? signalClasses(signal) || "bg-secondary"
            : isFutureWeekend
              ? ""
              : "bg-secondary";
        const textBase = isToday
          ? "text-background"
          : isPast
            ? signalText(signal)
            : isFutureWeekend
              ? ""
              : "text-muted-foreground";

        return (
          <Pressable
            key={date}
            onPress={() => onSelect?.(date)}
            style={isFutureWeekend ? { backgroundColor: WEEKEND_BG } : undefined}
            className={`flex-1 items-center gap-0.5 rounded-[14px] py-2.5 active:opacity-80 ${containerBase} ${
              isOpen ? "border-2 border-primary" : ""
            }`}
          >
            <Text
              style={isFutureWeekend ? { color: WEEKEND_TEXT } : undefined}
              className={`text-base font-heading-medium leading-none ${textBase}`}
            >
              {d.getDate()}
            </Text>
            <Text
              style={isFutureWeekend ? { color: WEEKEND_TEXT } : undefined}
              className={`text-[9.5px] font-mono-medium uppercase tracking-[0.06em] ${textBase}`}
            >
              {DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
