import { ProgressBar } from "@/components/progress-bar";
import { goalProgress, type DailyLog, type Profile } from "@/lib/daily";

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
    <div className="surface-card animate-rise p-5">
      <ProgressBar
        value={progress.pct}
        label={
          profile?.goal_type === "mantener"
            ? "Estabilidad"
            : `${progress.done.toFixed(1)} de ${progress.total} kg`
        }
        caption={
          profile?.goal_target_date
            ? `meta: ${formatMetaDate(profile.goal_target_date)}`
            : undefined
        }
      />
      <WeightTrend logs={logs} />
    </div>
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

  const first = weights[0];
  const last = weights[weights.length - 1];
  const delta = last - first;

  return (
    <div className="mt-4 flex items-center gap-3.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-8 w-24 shrink-0"
        aria-hidden="true"
      >
        <polyline
          points={coords}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="min-w-0">
        <p className="font-num text-sm font-medium tabular-nums text-foreground">{last} kg</p>
        <p className="text-[11px] text-muted-foreground">
          {delta === 0 ? "Sin cambios" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`} en tus
          últimos {points.length} pesajes
        </p>
      </div>
    </div>
  );
}
