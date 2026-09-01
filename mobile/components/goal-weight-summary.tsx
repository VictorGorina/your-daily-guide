import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

import { goalProgress, logTodayWeight, type DailyLog, type Profile } from "../lib/daily";

// "2026-12-01" -> "01/12/2026", como pide el diseño de la tarjeta de objetivo.
const formatMetaDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
};

/**
 * Foto transversal del objetivo de peso y la tendencia de los últimos pesajes.
 * Vivía en la subpestaña Historial; ahora encabeza la subpestaña Plan y se
 * muestra sea cual sea el mes seleccionado (el objetivo no es "del mes").
 *
 * Solo enseña barra de progreso cuando hay una métrica real: objetivo de peso
 * con cantidad, o "mantener" (estabilidad). Para objetivos que no son de peso
 * ("hábitos", "energía") no hay porcentaje que enseñar — solo el peso y el
 * botón para anotarlo.
 */
export function GoalWeightSummary({
  logs,
  profile,
}: {
  logs: DailyLog[];
  profile: Profile | null;
}) {
  const progress = goalProgress(profile ?? null);
  const hasMetric = profile?.goal_type === "mantener" || progress.total > 0;
  const pct = Math.round(progress.pct * 100);

  return (
    <View className="rounded-3xl bg-surface p-5">
      {hasMetric ? (
        <>
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
            <Text className="font-heading text-2xl text-foreground">{pct}%</Text>
          </View>
          <View className="mt-3.5 h-2 overflow-hidden rounded-full bg-secondary">
            <View className="h-full rounded-full bg-[#6dbe7b]" style={{ width: `${pct}%` }} />
          </View>
        </>
      ) : (
        <Text className="text-sm font-sans-semibold text-foreground">Tu peso</Text>
      )}
      <WeightPanel logs={logs} lastKnown={profile?.current_weight_kg ?? null} />
    </View>
  );
}

// Tendencia de los últimos pesajes + botón para anotar el peso de hoy. El
// botón despliega un campo en la misma fila (sin diálogo) para que anotar sea
// un gesto corto, como "registrar es un toque" del resto de la app.
function WeightPanel({ logs, lastKnown }: { logs: DailyLog[]; lastKnown: number | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: (kg: number) => logTodayWeight(kg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logs"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      setEditing(false);
    },
    onError: (e) => Alert.alert(e instanceof Error ? e.message : "No hemos podido guardar el peso"),
  });

  const commit = () => {
    const kg = Number(value.trim().replace(",", "."));
    if (!Number.isFinite(kg) || kg < 25 || kg > 400) {
      Alert.alert("El peso debe estar entre 25 y 400 kg");
      return;
    }
    save.mutate(kg);
  };

  const points = weighPoints(logs);
  const last = points.at(-1) ?? lastKnown ?? null;

  return (
    <View className="mt-4 flex-row items-center gap-3">
      {points.length >= 2 ? <Sparkline weights={points} /> : <Scale size={28} color="#83796c" />}

      {editing ? (
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            onSubmitEditing={commit}
            keyboardType="decimal-pad"
            placeholder={last != null ? String(last) : "kg"}
            editable={!save.isPending}
            className="w-16 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm text-foreground"
          />
          <Text className="text-xs text-muted-foreground">kg</Text>
          <Pressable onPress={() => setEditing(false)} className="ml-auto active:opacity-60">
            <Text className="text-xs font-sans-medium text-muted-foreground">Cancelar</Text>
          </Pressable>
          <Pressable
            onPress={commit}
            disabled={save.isPending}
            className="rounded-full bg-foreground px-3 py-1.5 active:opacity-80"
            style={save.isPending ? { opacity: 0.6 } : undefined}
          >
            <Text className="text-xs font-sans-semibold text-background">
              {save.isPending ? "..." : "Guardar"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View className="min-w-0 flex-1">
            {points.length >= 2 ? (
              <>
                <Text className="text-sm font-mono-medium tabular-nums text-foreground">
                  {last} kg
                </Text>
                <Text className="text-[11px] text-muted-foreground">{trendCaption(points)}</Text>
              </>
            ) : (
              <Text className="text-[13px] text-muted-foreground">
                {last != null ? `Último: ${last} kg` : "Aún no has anotado tu peso"}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => {
              setValue(last != null ? String(last) : "");
              setEditing(true);
            }}
            className="shrink-0 rounded-full bg-secondary px-3 py-1.5 active:opacity-80"
          >
            <Text className="text-xs font-sans-semibold text-foreground">Anotar peso</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

// Últimos 10 pesajes en orden cronológico — de un vistazo, sin abrir cada día
// para reconstruir si la semana fue a mejor o peor.
function weighPoints(logs: DailyLog[]): number[] {
  return [...logs]
    .filter((l): l is DailyLog & { weight_kg: number } => l.weight_kg != null)
    .sort((a, b) => a.log_date.localeCompare(b.log_date))
    .slice(-10)
    .map((p) => p.weight_kg);
}

function trendCaption(weights: number[]): string {
  const delta = weights[weights.length - 1]! - weights[0]!;
  const change = delta === 0 ? "Sin cambios" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`;
  return `${change} en tus últimos ${weights.length} pesajes`;
}

function Sparkline({ weights }: { weights: number[] }) {
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = max - min || 1;
  const W = 100;
  const H = 32;
  const coords = weights
    .map((w, i) => {
      const x = (i / (weights.length - 1)) * W;
      const y = H - ((w - min) / span) * H;
      return `${x},${y}`;
    })
    .join(" ");

  return (
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
  );
}
