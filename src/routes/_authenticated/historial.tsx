import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { BottomNav } from "@/components/bottom-nav";
import { ProgressBar } from "@/components/progress-bar";
import {
  fetchLogs,
  fetchMessages,
  fetchProfile,
  goalProgress,
  ratioSignal,
  type DailyLog,
} from "@/lib/daily";

export const Route = createFileRoute("/_authenticated/historial")({
  component: Historial,
});

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Historial() {
  const [open, setOpen] = useState<string | null>(null);
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const logs = logsQ.data ?? [];
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const progress = goalProgress(profile ?? null);

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <h1 className="font-display text-3xl">Historial</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cada día cuenta. Toca un día para ver su conversación.
      </p>

      <section className="surface-card animate-rise mt-6 p-5">
        <ProgressBar
          value={progress.pct}
          label={
            profile?.goal_type === "mantener"
              ? "Estabilidad"
              : `${progress.done.toFixed(1)} de ${progress.total} kg`
          }
          caption={profile?.goal_target_date ? `Meta: ${profile.goal_target_date}` : undefined}
        />
        <WeightTrend logs={logs} />
      </section>

      <AdherenceHeatmap logs={logs} />

      <div className="mt-6 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Conversación por día
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay días registrados.</p>
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
      </div>

      <BottomNav />
    </main>
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
    <div className="mt-4 flex items-center gap-4 border-t border-border pt-4">
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
        <p className="text-sm font-semibold tabular-nums text-foreground">{last} kg</p>
        <p className="text-[11px] text-muted-foreground">
          {delta === 0 ? "Sin cambios" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`} en tus
          últimos {points.length} pesajes
        </p>
      </div>
    </div>
  );
}

// Mapa de calor de las últimas dos semanas: mismo semáforo verde/naranja/rojo
// que ya usa la app en Hoy, para leer la adherencia sin abrir cada día.
function AdherenceHeatmap({ logs }: { logs: DailyLog[] }) {
  const logByDate = new Map(logs.map((l) => [l.log_date, l]));
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (13 - i));
    return d;
  });

  return (
    <section className="surface-card animate-rise mt-4 p-5">
      <h2 className="text-sm font-semibold">Adherencia · últimos 14 días</h2>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const date = iso(d);
          const log = logByDate.get(date);
          const habits = log?.habits ?? [];
          const signal = ratioSignal(habits.filter((h) => h.done).length, habits.length);
          const cellClass =
            signal === "success"
              ? "bg-success"
              : signal === "warning"
                ? "bg-warning"
                : signal === "muted"
                  ? "bg-muted"
                  : "bg-secondary";
          return (
            <span key={date} title={date} className={`aspect-square rounded-md ${cellClass}`} />
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Verde: todas las comidas. Naranja: comiste algo. Gris claro: sin comidas ese día. Gris
        oscuro: sin registro.
      </p>
    </section>
  );
}

function DayRow({ log, open, onToggle }: { log: DailyLog; open: boolean; onToggle: () => void }) {
  const habits = log.habits ?? [];
  const ratio = habits.length ? habits.filter((h) => h.done).length / habits.length : 0;
  const messagesQ = useQuery({
    queryKey: ["messages", log.log_date],
    queryFn: () => fetchMessages(log.log_date),
    enabled: open,
  });

  return (
    <div className="surface-card overflow-hidden">
      <button
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium capitalize">
            {new Date(`${log.log_date}T12:00:00`).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {habits.filter((h) => h.done).length}/{habits.length} comidas
            {log.weight_kg ? ` · ${log.weight_kg} kg` : ""}
          </p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-foreground">
          {Math.round(ratio * 100)}%
        </span>
      </button>

      {open && (
        <div className="animate-rise border-t border-border p-4">
          {log.guide?.intro ? (
            <p className="mb-3 text-sm text-muted-foreground">{log.guide.intro}</p>
          ) : null}
          <div className="space-y-2">
            {(messagesQ.data ?? []).map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-6 bg-primary text-primary-foreground"
                    : "mr-6 bg-secondary text-foreground"
                }`}
              >
                {m.content}
              </div>
            ))}
            {messagesQ.isSuccess && (messagesQ.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin conversación este día.</p>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Solo lectura: los días pasados no se pueden editar.
          </p>
        </div>
      )}
    </div>
  );
}
