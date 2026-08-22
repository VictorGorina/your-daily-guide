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
      return "border-transparent bg-success";
    case "warning":
      return "border-transparent bg-warning";
    case "muted":
      return "border-transparent bg-muted";
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
        const signal = isToday
          ? todaySignal
          : isPast
            ? habitSignal(logByDate.get(date), todayHabits)
            : "none";

        const filled = signal !== "none";
        const containerBase = isToday
          ? filled
            ? signalClasses(signal)
            : "border-transparent bg-foreground"
          : "border-border bg-surface";
        const textBase = isToday
          ? filled
            ? signalText(signal)
            : "text-background"
          : filled
            ? signalText(signal)
            : "text-muted-foreground";

        return (
          <Pressable
            key={date}
            onPress={() => onSelect?.(date)}
            className={`flex-1 items-center gap-0.5 rounded-2xl border py-2.5 active:opacity-80 ${containerBase} ${
              isOpen ? "border-primary" : ""
            }`}
          >
            <Text className={`text-base font-sans-semibold leading-none ${textBase}`}>
              {d.getDate()}
            </Text>
            <Text className={`text-[10px] font-sans-semibold ${textBase}`}>
              {DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
