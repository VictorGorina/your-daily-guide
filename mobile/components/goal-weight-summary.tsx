import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Rect } from "react-native-svg";

import {
  goalProgress,
  logTodayWeight,
  normalizeGoalType,
  type DailyLog,
  type Profile,
  type GoalProgress,
} from "../lib/daily";

// "2026-12-01" -> "01/12/2026", como pide el diseño de la tarjeta de objetivo.
const formatMetaDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
};

/** Direccion de tendencia de los ultimos pesajes respecto al target. */
function trendDirection(weights: number[], targetKg: number): "toward" | "away" | "stable" {
  if (weights.length < 2) return "stable";
  const last = weights[weights.length - 1]!;
  const prev = weights[weights.length - 2]!;
  const delta = last - prev;
  if (Math.abs(delta) < 0.2) return "stable";
  const distNow = Math.abs(last - targetKg);
  const distPrev = Math.abs(prev - targetKg);
  return distNow < distPrev ? "toward" : "away";
}

/** Constantes del gauge */
const PADDING_KG = 3;
const MAINTAIN_ZONE = 1;

/**
 * Indicador visual de peso actual vs peso objetivo (react-native-svg).
 * Reemplaza la barra de progreso lineal: muestra una escala horizontal con
 * el peso objetivo como referencia central, un punto coloreado para el peso
 * actual y una franja ±1 kg alrededor del objetivo ("zona de mantenimiento").
 */
function WeightGauge({
  targetKg,
  currentKg,
  startKg,
  regressing,
  trend,
}: {
  targetKg: number;
  currentKg: number;
  startKg: number;
  regressing: boolean;
  trend: "toward" | "away" | "stable";
}) {
  const rangeMin = Math.min(targetKg, currentKg, startKg) - PADDING_KG;
  const rangeMax = Math.max(targetKg, currentKg, startKg) + PADDING_KG;
  const rangeSpan = rangeMax - rangeMin;

  const pct = (kg: number) => ((kg - rangeMin) / rangeSpan) * 100;

  const targetPct = pct(targetKg);
  const currentPct = pct(currentKg);
  const zoneLPct = pct(targetKg - MAINTAIN_ZONE);
  const zoneRPct = pct(targetKg + MAINTAIN_ZONE);

  const distanceKg = Math.abs(currentKg - targetKg);
  const inZone = distanceKg <= MAINTAIN_ZONE;

  const dotColor = inZone
    ? "#6DBE7B" // Verde fresco — en zona de mantenimiento
    : regressing
      ? "#E57373" // Rojo suave — alejandose
      : "#FF8A3D"; // Naranja Peppers — acercandose

  const distanceLabel =
    distanceKg < 0.5
      ? "En tu peso"
      : `${distanceKg.toFixed(1)} kg ${currentKg > targetKg ? "por encima" : "por debajo"}`;

  const trendArrow = trend === "toward" ? "→" : trend === "away" ? "←" : null;

  return (
    <View>
      {/* Cabecera: peso objetivo + distancia */}
      <View className="mb-3 flex-row items-baseline justify-between gap-2">
        <Text className="text-sm font-sans-semibold text-foreground">
          Objetivo: <Text className="font-mono-medium tabular-nums">{targetKg}</Text> kg
        </Text>
        <Text className="font-mono-medium text-xs tabular-nums" style={{ color: dotColor }}>
          {distanceLabel}
        </Text>
      </View>

      {/* Escala SVG */}
      <Svg
        width="100%"
        height={40}
        viewBox="0 0 300 40"
        preserveAspectRatio="xMidYMid meet"
        accessibilityLabel={`Peso actual ${currentKg} kg, objetivo ${targetKg} kg`}
      >
        {/* Rail de fondo */}
        <Rect x={10} y={14} width={280} height={6} rx={3} fill="#EAE6DD" />

        {/* Zona de mantenimiento (+-1 kg alrededor del target) */}
        <Rect
          x={10 + (zoneLPct / 100) * 280}
          y={10}
          width={((zoneRPct - zoneLPct) / 100) * 280}
          height={14}
          rx={3}
          fill="#6DBE7B"
          opacity={0.18}
        />

        {/* Linea del target */}
        <Line
          x1={10 + (targetPct / 100) * 280}
          y1={8}
          x2={10 + (targetPct / 100) * 280}
          y2={26}
          stroke="#6DBE7B"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Punto del peso actual */}
        <Circle cx={10 + (currentPct / 100) * 280} cy={17} r={6} fill={dotColor} />
      </Svg>
    </View>
  );
}

/**
 * Foto transversal del objetivo de peso y la tendencia de los últimos pesajes.
 * Vivía en la subpestaña Historial; ahora encabeza la subpestaña Plan y se
 * muestra sea cual sea el mes seleccionado (el objetivo no es "del mes").
 *
 * Con `target_weight_kg`: indicador de posicion (WeightGauge) centrado en el
 * objetivo, con zona de mantenimiento, punto de peso actual y tendencia.
 * Sin target (legacy): barra de progreso lineal como antes.
 */
export function GoalWeightSummary({
  logs,
  profile,
}: {
  logs: DailyLog[];
  profile: Profile | null;
}) {
  const progress = goalProgress(profile ?? null);
  const goal = profile?.goal_type ? normalizeGoalType(profile.goal_type) : null;

  // -- Camino nuevo: peso objetivo con WeightGauge --
  if (progress.targetKg != null && profile) {
    const points = weighPoints(logs);
    const trend = trendDirection(points, progress.targetKg);

    return (
      <View className="rounded-3xl bg-surface p-5">
        <WeightGauge
          targetKg={progress.targetKg}
          currentKg={Number(
            profile.current_weight_kg ?? profile.start_weight_kg ?? progress.targetKg,
          )}
          startKg={Number(
            profile.start_weight_kg ?? profile.current_weight_kg ?? progress.targetKg,
          )}
          regressing={progress.regressing}
          trend={trend}
        />
        <WeightPanel
          logs={logs}
          lastKnown={profile.current_weight_kg ?? null}
          regressing={progress.regressing}
        />
      </View>
    );
  }

  // -- Fallback legacy: barra de progreso lineal --
  const pct = Math.round(progress.pct * 100);

  const metaCaption = profile?.goal_target_date
    ? `meta: ${formatMetaDate(profile.goal_target_date)}`
    : null;

  const progressLabel = () => {
    if (goal === "mantener") return "Estabilidad";
    if (progress.regressing) {
      const kg = Math.abs(progress.done).toFixed(1);
      return goal === "perder" ? `+${kg} kg (retroceso)` : `−${kg} kg (retroceso)`;
    }
    if (progress.hasTarget) return `${progress.done.toFixed(1)} de ${progress.total} kg`;
    const kg = progress.done.toFixed(1);
    return goal === "ganar" ? `${kg} kg más` : `${kg} kg menos`;
  };

  // Con meta numérica (o "mantener") se enseña la barra; sin meta, solo un dato.
  const showBar = progress.measurable && (progress.hasTarget || goal === "mantener");
  const barColor = progress.regressing ? "#e2685f" : "#6dbe7b";
  const pctColor = progress.regressing ? "text-destructive" : "text-foreground";

  return (
    <View className="rounded-3xl bg-surface p-5">
      {showBar ? (
        <>
          <View className="flex-row items-end justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-sans-semibold text-foreground">{progressLabel()}</Text>
              {metaCaption ? (
                <Text className="mt-1 font-mono-medium text-[10.5px] text-muted-foreground">
                  {metaCaption}
                </Text>
              ) : null}
            </View>
            <Text className={`font-heading text-2xl ${pctColor}`}>{pct}%</Text>
          </View>
          <View className="mt-3.5 h-2 overflow-hidden rounded-full bg-secondary">
            <View
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
          </View>
        </>
      ) : progress.measurable ? (
        <View className="min-w-0">
          <Text
            className={`text-sm font-sans-semibold ${
              progress.regressing ? "text-destructive" : "text-foreground"
            }`}
          >
            {progressLabel()}
          </Text>
          <Text className="mt-1 font-mono-medium text-[10.5px] text-muted-foreground">
            {metaCaption ?? "sin meta de kg — anótala en Ajustes"}
          </Text>
        </View>
      ) : (
        <Text className="text-sm font-sans-semibold text-foreground">Tu peso</Text>
      )}
      <WeightPanel
        logs={logs}
        lastKnown={profile?.current_weight_kg ?? null}
        regressing={progress.regressing}
      />
    </View>
  );
}

// Tendencia de los últimos pesajes + botón para anotar el peso de hoy. El
// botón despliega un campo en la misma fila (sin diálogo) para que anotar sea
// un gesto corto, como "registrar es un toque" del resto de la app.
function WeightPanel({
  logs,
  lastKnown,
  regressing,
}: {
  logs: DailyLog[];
  lastKnown: number | null;
  regressing: boolean;
}) {
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
      {points.length >= 2 ? (
        <Sparkline weights={points} regressing={regressing} />
      ) : (
        <Scale size={28} color="#83796c" />
      )}

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

function Sparkline({ weights, regressing }: { weights: number[]; regressing: boolean }) {
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
        stroke={regressing ? "#e2685f" : "#ff8a3d"}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
