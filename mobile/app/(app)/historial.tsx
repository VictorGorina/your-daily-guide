import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";

import { BottomNav } from "../../components/bottom-nav";
import {
  fetchLogs,
  fetchMessages,
  fetchProfile,
  goalProgress,
  MEAL_STATUS_LABEL,
  ratioSignal,
  todayISO,
  updateLogByDate,
  type DailyLog,
  type MealStatus,
} from "../../lib/daily";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Historial() {
  const [open, setOpen] = useState<string | null>(null);
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const logs = logsQ.data ?? [];
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const progress = goalProgress(profile ?? null);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-6">
        <Text className="text-3xl font-display text-foreground">Historial</Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          Cada día cuenta. Toca un día para ver su conversación.
        </Text>

        {/* Progreso hacia el objetivo */}
        <View className="mt-6 rounded-3xl border border-border bg-surface p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-sans-semibold text-foreground">
              {profile?.goal_type === "mantener"
                ? "Estabilidad"
                : `${progress.done.toFixed(1)} de ${progress.total} kg`}
            </Text>
            <Text className="text-sm font-sans-bold tabular-nums text-primary">
              {Math.round(progress.pct * 100)}%
            </Text>
          </View>
          <View className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
            <View
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round(progress.pct * 100)}%` }}
            />
          </View>
          {profile?.goal_target_date ? (
            <Text className="mt-1.5 text-[11px] text-muted-foreground">
              Meta: {profile.goal_target_date}
            </Text>
          ) : null}
          <WeightTrend logs={logs} />
        </View>

        <AdherenceHeatmap logs={logs} />

        <Text className="mt-6 px-1 text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
          Conversación por día
        </Text>
        <View className="mt-2 gap-2">
          {logs.length === 0 ? (
            <Text className="text-sm text-muted-foreground">Aún no hay días registrados.</Text>
          ) : (
            logs.map((log) => (
              <DayRow
                key={log.id}
                log={log}
                open={open === log.log_date}
                onToggle={() => setOpen(open === log.log_date ? null : log.log_date)}
              />
            ))
          )}
        </View>
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

// Línea de tendencia de los últimos pesajes registrados — de un vistazo, sin
// tener que abrir cada día para reconstruir si la semana fue a mejor o peor.
function WeightTrend({ logs }: { logs: DailyLog[] }) {
  const points = [...logs]
    .filter((l): l is DailyLog & { weight_kg: number } => l.weight_kg != null)
    .sort((a, b) => a.log_date.localeCompare(b.log_date))
    .slice(-10);

  if (points.length < 2) return null;

  const weights = points.map((p) => p.weight_kg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = max - min || 1;
  const W = 100;
  const H = 32;
  const coords = weights
    .map((w, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((w - min) / span) * H;
      return `${x},${y}`;
    })
    .join(" ");

  const first = weights[0]!;
  const last = weights[weights.length - 1]!;
  const delta = last - first;

  return (
    <View className="mt-4 flex-row items-center gap-4 border-t border-border pt-4">
      <Svg width={96} height={32} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polyline
          points={coords}
          fill="none"
          stroke="#6dbe7b"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-sans-semibold tabular-nums text-foreground">{last} kg</Text>
        <Text className="text-[11px] text-muted-foreground">
          {delta === 0 ? "Sin cambios" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`} en tus
          últimos {points.length} pesajes
        </Text>
      </View>
    </View>
  );
}

// Mapa de calor de las últimas dos semanas: mismo semáforo verde/naranja/gris
// que ya usa la app en Hoy, para leer la adherencia sin abrir cada día.
function AdherenceHeatmap({ logs }: { logs: DailyLog[] }) {
  const logByDate = new Map(logs.map((l) => [l.log_date, l]));
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (13 - i));
    return iso(d);
  });
  const rows = [days.slice(0, 7), days.slice(7, 14)];

  const cellColor = (date: string) => {
    const habits = logByDate.get(date)?.habits ?? [];
    const signal = ratioSignal(habits.filter((h) => h.done).length, habits.length);
    return signal === "success"
      ? "bg-success"
      : signal === "warning"
        ? "bg-warning"
        : signal === "muted"
          ? "bg-muted"
          : "bg-secondary";
  };

  return (
    <View className="mt-4 rounded-3xl border border-border bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">Adherencia · últimos 14 días</Text>
      <View className="mt-3 gap-1.5">
        {rows.map((row, r) => (
          <View key={r} className="flex-row gap-1.5">
            {row.map((date) => (
              <View key={date} className={`aspect-square flex-1 rounded-md ${cellColor(date)}`} />
            ))}
          </View>
        ))}
      </View>
      <Text className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Verde: todas las comidas. Naranja: comiste algo. Gris claro: sin comidas ese día. Gris
        oscuro: sin registro.
      </Text>
    </View>
  );
}

function DayRow({ log, open, onToggle }: { log: DailyLog; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const habits = log.habits ?? [];
  const ratio = habits.length ? habits.filter((h) => h.done).length / habits.length : 0;
  const isToday = log.log_date === todayISO();
  const [editingMeal, setEditingMeal] = useState<number | null>(null);
  const messagesQ = useQuery({
    queryKey: ["messages", log.log_date],
    queryFn: () => fetchMessages(log.log_date),
    enabled: open,
  });

  // Corrección retroactiva de un día pasado — mismo patrón que la web: solo
  // cambia el registro personal, nunca reescribe la compra ya confirmada.
  const correctLog = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateLogByDate(log.log_date, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logs"] }),
    onError: () => Alert.alert("No hemos podido guardar la corrección"),
  });
  const correctMeal = (index: number, status: MealStatus) => {
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    correctLog.mutate({ habits: next });
    setEditingMeal(null);
  };

  const dayLabel = new Date(`${log.log_date}T12:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  return (
    <View className="overflow-hidden rounded-3xl border border-border bg-surface">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between gap-3 p-4 active:opacity-80"
      >
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-sans-medium capitalize text-foreground" numberOfLines={1}>
            {dayLabel}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {habits.filter((h) => h.done).length}/{habits.length} comidas
            {log.weight_kg ? ` · ${log.weight_kg} kg` : ""}
          </Text>
        </View>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <Text className="text-xs font-sans-semibold text-foreground">{Math.round(ratio * 100)}%</Text>
        </View>
      </Pressable>

      {open ? (
        <View className="border-t border-border p-4">
          {log.guide?.intro ? (
            <Text className="mb-3 text-sm text-muted-foreground">{log.guide.intro}</Text>
          ) : null}

          {habits.length ? (
            <View className="mb-4 gap-1.5">
              <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
                Comidas
              </Text>
              {habits.map((h, i) => (
                <View key={h.label}>
                  <Pressable
                    disabled={isToday}
                    onPress={() => setEditingMeal((prev) => (prev === i ? null : i))}
                    className="flex-row items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 active:opacity-80"
                    style={isToday ? { opacity: 0.6 } : undefined}
                  >
                    <Text className="text-sm text-foreground">{h.label}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {h.status ? MEAL_STATUS_LABEL[h.status] : "Sin marcar"}
                    </Text>
                  </Pressable>
                  {editingMeal === i ? (
                    <View className="mt-1.5 flex-row flex-wrap gap-2 rounded-xl bg-secondary/40 p-2.5">
                      {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => {
                        const active = h.status === s;
                        return (
                          <Pressable
                            key={s}
                            onPress={() => correctMeal(i, s)}
                            className={`rounded-full border px-3 py-1.5 active:opacity-80 ${
                              active ? "border-foreground bg-foreground" : "border-input"
                            }`}
                          >
                            <Text
                              className={`text-xs font-sans-semibold ${
                                active ? "text-background" : "text-muted-foreground"
                              }`}
                            >
                              {MEAL_STATUS_LABEL[s]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ))}
              <Text className="pt-1 text-[11px] text-muted-foreground">
                {isToday
                  ? "Es el día de hoy: corrígelo desde la pestaña Hoy."
                  : "Corregir aquí es solo para tu historial: la compra ya hecha de ese mes no cambia."}
              </Text>
            </View>
          ) : null}

          <View className="gap-2">
            {(messagesQ.data ?? []).map((m) => (
              <View
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  m.role === "user"
                    ? "self-end bg-primary"
                    : "self-start border border-border bg-secondary"
                }`}
              >
                <Text
                  className={`text-sm ${
                    m.role === "user" ? "text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {m.content}
                </Text>
              </View>
            ))}
            {messagesQ.isSuccess && (messagesQ.data ?? []).length === 0 ? (
              <Text className="text-xs text-muted-foreground">Sin conversación este día.</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
