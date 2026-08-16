import { useMemo, useState } from "react";
import { Check, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { ratioSignal, todayISO, type DailyLog } from "../lib/daily";
import { planForDate, type MonthlyPlan } from "../lib/plan-shared";
import { Dialog } from "./ui/dialog";

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

  const signalFor = (date: string) => {
    const log = logByDate.get(date);
    const habits = log?.habits ?? [];
    return ratioSignal(habits.filter((h) => h.done).length, habits.length);
  };

  const selectedLog = selected ? (logByDate.get(selected) ?? null) : null;
  const selectedPlan = selected ? planForDate(plan, selected) : null;
  const selectedHabits = selectedLog?.habits ?? [];
  const isFuture = selected ? selected > today : false;
  const isToday = selected === today;

  const cellClasses = (signal: ReturnType<typeof ratioSignal>, isWeekend: boolean, past: boolean) => {
    if (signal === "success") return "border-transparent bg-success";
    if (signal === "warning") return "border-transparent bg-warning";
    if (signal === "muted") return "border-transparent bg-muted";
    if (isWeekend) return "border-accent bg-accent";
    return past ? "border-border bg-surface" : "border-border bg-surface";
  };
  const cellText = (signal: ReturnType<typeof ratioSignal>) => {
    if (signal === "success") return "text-success-foreground";
    if (signal === "warning") return "text-warning-foreground";
    if (signal === "muted") return "text-muted-foreground";
    return "text-foreground";
  };

  return (
    <View className="mt-6 rounded-3xl border border-border bg-surface p-5">
      <Text className="text-sm font-semibold capitalize text-foreground">{monthLabel}</Text>

      <View className="mt-4 flex-row flex-wrap">
        {WEEKDAYS.map((d, i) => (
          <View key={`${d}-${i}`} className="w-[14.28%] items-center pb-1">
            <Text className="text-[11px] font-medium text-muted-foreground">{d}</Text>
          </View>
        ))}
        {cells.map((date, i) => {
          if (!date) return <View key={`empty-${i}`} className="w-[14.28%] p-0.5" />;
          const signal = signalFor(date);
          const past = date < today;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          return (
            <View key={date} className="w-[14.28%] p-0.5">
              <Pressable
                onPress={() => setSelected(date)}
                className={`aspect-square items-center justify-center rounded-xl border active:opacity-80 ${cellClasses(
                  signal,
                  isWeekend,
                  past,
                )} ${date === today ? "border-primary" : ""}`}
              >
                <Text className={`text-sm ${cellText(signal)}`}>{Number(date.slice(8, 10))}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Semáforo de comidas: verde si comiste todas, naranja si comiste algo, gris si no hubo
        registro. Toca cualquier día para ver su menú.
      </Text>

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={
          selected
            ? new Date(`${selected}T00:00:00`).toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : ""
        }
      >
        <Text className="text-xs text-muted-foreground">
          {isFuture
            ? "Día futuro: este es el menú previsto en tu plan del mes."
            : isToday
              ? "Hoy: tu menú y tus hábitos."
              : "Día pasado: esto es lo que tocaba y cómo fueron tus hábitos."}
        </Text>

        <View className="gap-2">
          <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Menú del día
          </Text>
          {!isFuture && selectedLog?.guide?.meals?.length ? (
            selectedLog.guide.meals.map((m) => <Row key={m.moment} label={m.moment} value={m.idea} />)
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
            <Text className="text-sm text-muted-foreground">
              Aún no hay menú para este día. Crea tu plan del mes en la pestaña Plan.
            </Text>
          )}
        </View>

        {!isFuture ? (
          <View className="gap-2">
            <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Comidas del día
            </Text>
            {(selectedHabits.length
              ? selectedHabits
              : planHabits.map((label) => ({ label, done: false }))
            ).map((h) => (
              <View
                key={h.label}
                className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-3"
              >
                <View
                  className={`h-6 w-6 items-center justify-center rounded-full ${
                    h.done ? "bg-success" : "bg-secondary"
                  }`}
                >
                  {h.done ? (
                    <Check size={14} color="#f7fef8" />
                  ) : (
                    <X size={14} color="#677380" />
                  )}
                </View>
                <Text className="flex-1 text-sm text-foreground">{h.label}</Text>
              </View>
            ))}
            {!selectedHabits.length ? (
              <Text className="text-xs text-muted-foreground">Sin registro de ese día.</Text>
            ) : null}
          </View>
        ) : (
          <View className="gap-2">
            <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Comidas previstas
            </Text>
            {planHabits.map((label) => (
              <View key={label} className="rounded-xl border border-border bg-surface p-3">
                <Text className="text-sm text-foreground">{label}</Text>
              </View>
            ))}
          </View>
        )}
      </Dialog>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3 rounded-xl border border-border bg-surface p-3">
      <Text className="text-xs font-semibold text-primary">{label}</Text>
      <Text className="flex-1 text-sm text-foreground">{value}</Text>
    </View>
  );
}
