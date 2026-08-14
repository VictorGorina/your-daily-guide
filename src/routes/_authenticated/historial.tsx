import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { BottomNav } from "@/components/bottom-nav";
import { ProgressBar } from "@/components/progress-bar";
import { fetchLogs, fetchMessages, fetchProfile, goalProgress, type DailyLog } from "@/lib/daily";

export const Route = createFileRoute("/_authenticated/historial")({
  component: Historial,
});

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
      </section>

      <div className="mt-6 space-y-2">
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
            {habits.filter((h) => h.done).length}/{habits.length} hábitos
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
