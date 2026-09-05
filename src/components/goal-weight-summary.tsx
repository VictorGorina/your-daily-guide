import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ProgressBar } from "@/components/progress-bar";
import {
  goalProgress,
  logTodayWeight,
  normalizeGoalType,
  type DailyLog,
  type Profile,
} from "@/lib/daily";

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
  const goal = profile?.goal_type ? normalizeGoalType(profile.goal_type) : null;
  const hasMetric = goal === "mantener" || progress.total > 0;

  const progressLabel = () => {
    if (goal === "mantener") return "Estabilidad";
    if (progress.regressing) {
      return `+${Math.abs(progress.done).toFixed(1)} kg (retroceso)`;
    }
    return `${progress.done.toFixed(1)} de ${progress.total} kg`;
  };

  return (
    <div className="surface-card animate-rise p-5">
      {hasMetric ? (
        <ProgressBar
          value={progress.pct}
          label={progressLabel()}
          variant={progress.regressing ? "danger" : "success"}
          caption={
            profile?.goal_target_date
              ? `meta: ${formatMetaDate(profile.goal_target_date)}`
              : undefined
          }
        />
      ) : (
        <p className="text-sm font-semibold text-foreground">Tu peso</p>
      )}
      <WeightPanel
        logs={logs}
        lastKnown={profile?.current_weight_kg ?? null}
        regressing={progress.regressing}
      />
    </div>
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
      toast.success("Peso de hoy anotado");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No hemos podido guardar el peso"),
  });

  const commit = () => {
    const kg = Number(value.trim().replace(",", "."));
    if (!Number.isFinite(kg) || kg < 25 || kg > 400) {
      toast.error("El peso debe estar entre 25 y 400 kg");
      return;
    }
    save.mutate(kg);
  };

  const points = weighPoints(logs);
  const last = points.at(-1) ?? lastKnown ?? null;

  return (
    <div className="mt-4 flex items-center gap-3.5">
      {points.length >= 2 ? (
        <Sparkline weights={points} regressing={regressing} />
      ) : (
        <Scale className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}

      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder={last != null ? String(last) : "kg"}
            className="w-16 rounded-lg bg-secondary px-2 py-1.5 text-right font-num text-sm tabular-nums text-foreground outline-none"
          />
          <span className="text-xs text-muted-foreground">kg</span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="ml-auto text-xs font-medium text-muted-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={save.isPending}
            className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-60"
          >
            {save.isPending ? "..." : "Guardar"}
          </button>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            {points.length >= 2 ? (
              <>
                <p className="font-num text-sm font-medium tabular-nums text-foreground">
                  {last} kg
                </p>
                <p className="text-[11px] text-muted-foreground">{trendCaption(points)}</p>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {last != null ? `Último: ${last} kg` : "Aún no has anotado tu peso"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setValue(last != null ? String(last) : "");
              setEditing(true);
            }}
            className="shrink-0 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-foreground"
          >
            Anotar peso
          </button>
        </>
      )}
    </div>
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
  const delta = weights[weights.length - 1] - weights[0];
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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-8 w-24 shrink-0"
      aria-hidden="true"
    >
      <polyline
        points={coords}
        fill="none"
        stroke={regressing ? "var(--color-destructive)" : "var(--color-primary)"}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
