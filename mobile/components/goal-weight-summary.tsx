import { Text, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

import { goalProgress, type DailyLog, type Profile } from "../lib/daily";

// "2026-12-01" -> "01/12/2026", como pide el diseño de la tarjeta de objetivo.
const formatMetaDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
};

/**
 * Foto transversal del objetivo de peso y la tendencia de los últimos pesajes.
 * Vivía en la subpestaña Historial; ahora encabeza la subpestaña Plan y se
 * muestra sea cual sea el mes seleccionado (el objetivo no es "del mes").
 */
export function GoalWeightSummary({
  logs,
  profile,
}: {
  logs: DailyLog[];
  profile: Profile | null;
}) {
  const progress = goalProgress(profile ?? null);

  return (
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
