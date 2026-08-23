import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

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
} from "../lib/daily";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "2026-12-01" -> "01/12/2026", como pide el diseño de la tarjeta de objetivo.
const formatMetaDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
};

// Contenido de "Historial", extraído a su propio componente para poder vivir
// como tercera sub-pestaña de Plan en vez de como pestaña de primer nivel.
export function HistorialSection() {
  const [open, setOpen] = useState<string | null>(null);
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const logs = logsQ.data ?? [];
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const progress = goalProgress(profile ?? null);

  return (
    <View className="mt-5 gap-4">
      <View className="rounded-3xl bg-surface p-5">
        <View className="flex-row items-end justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-sans-semibold text-foreground">
              {profile?.goal_type === "mantener"
                ? "Estabilidad"
                : `${progress.done.toFixed(1)} de ${progress.total} kg`}
            </Text>
            {profile?.goal_target_date ? (
              <Text className="mt-1 font-mono-medium text-[10.5px] text-muted-foreground">
                meta: {formatMetaDate(profile.goal_target_date)}
              </Text>
            ) : null}
          </View>
          <Text className="font-heading text-2xl text-foreground">
            {Math.round(progress.pct * 100)}%
          </Text>
        </View>
        <View className="mt-3.5 h-2 overflow-hidden rounded-full bg-secondary">
          <View
            className="h-full rounded-full bg-[#6dbe7b]"
            style={{ width: `${Math.round(progress.pct * 100)}%` }}
          />
        </View>
        <WeightTrend logs={logs} />
      </View>

      <AdherenceHeatmap logs={logs} />

      <Text className="px-1 text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
        Conversación por día
      </Text>
      <View className="gap-2">
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
    </View>
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
    <View className="mt-4 flex-row items-center gap-3.5">
      <Svg width={96} height={32} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polyline
          points={coords}
          fill="none"
          stroke="#ff8a3d"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-mono-medium tabular-nums text-foreground">{last} kg</Text>
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
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">
        Adherencia · últimos 14 días
      </Text>
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
    <View className="overflow-hidden rounded-3xl bg-surface">
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
          <Text className="text-xs font-sans-semibold text-foreground">
            {Math.round(ratio * 100)}%
          </Text>
        </View>
      </Pressable>

      {open ? (
        <View className="bg-secondary/30 p-4">
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
                    className="flex-row items-center justify-between rounded-xl bg-surface px-3 py-2 active:opacity-80"
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
                            className={`rounded-full px-3 py-1.5 active:opacity-80 ${
                              active ? "bg-foreground" : "bg-surface"
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
                  m.role === "user" ? "self-end bg-primary" : "self-start bg-secondary"
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
