import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { MacroBars } from "@/components/macro-bars";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MEAL_STATUS_LABEL,
  todayISO,
  updateLogByDate,
  type DailyLog,
  type MealStatus,
  type Profile,
} from "@/lib/daily";
import { sumDoneMacros, ZERO_MACROS } from "@/lib/macros";
import { isBeforeAppStart, mealsForDate, type MonthlyPlan } from "@/lib/plan-shared";

const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/**
 * Detalle reducido de un día pasado: qué se comió, qué se falló y las macros del
 * día — como la pestaña Hoy pero en pequeño y sin el chat del coach ni la guía.
 * Reemplaza a la lista "Conversación por día" de la antigua subpestaña Historial.
 * El día de hoy y el futuro no llegan aquí (los abre el diálogo de menú del
 * calendario); este sheet es solo para `date < hoy`.
 */
export function DayDetailSheet({
  date,
  plan,
  log,
  profile,
  onClose,
}: {
  date: string | null;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">{date ? longDate(date) : ""}</DialogTitle>
        </DialogHeader>
        {date ? <DayDetailBody date={date} plan={plan} log={log} profile={profile} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DayDetailBody({
  date,
  plan,
  log,
  profile,
}: {
  date: string;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);

  const habits = log?.habits ?? [];
  const editable = date < todayISO();
  const beforeStart = isBeforeAppStart(date, profile?.app_started_on);

  const correct = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateLogByDate(date, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logs"] });
      qc.invalidateQueries({ queryKey: ["logs", date.slice(0, 7)] });
    },
    onError: () => toast.error("No hemos podido guardar la corrección"),
  });
  const setStatus = (index: number, status: MealStatus) => {
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    correct.mutate({ habits: next });
    setEditing(null);
  };

  // Plato planificado de cada momento (comida/cena del día exacto, desayuno/snack
  // por rotación o plato pedido a mano). El detalle recorre `habits` porque son
  // el registro real de lo que se siguió ese día.
  const plannedByLabel = new Map(mealsForDate(plan, date).map((m) => [m.moment, m.idea]));

  if (!habits.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {beforeStart
          ? "Antes de empezar a usar Peppers. No hay nada registrado de este día."
          : "No registraste ninguna comida este día."}
      </p>
    );
  }

  const doneCount = habits.filter((h) => h.done).length;
  const failedCount = habits.filter((h) => h.status === "salteo" || h.status == null).length;
  const consumed = sumDoneMacros(log?.guide?.mealMacros, habits) ?? ZERO_MACROS;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Comidas
          </span>
          <span className="font-num text-[11px] tabular-nums text-muted-foreground">
            {doneCount} de {habits.length}
            {failedCount ? ` · ${failedCount} sin cumplir` : ""}
          </span>
        </div>
        {habits.map((h, i) => {
          const planned = plannedByLabel.get(h.label) ?? "";
          // `wasIdea` = plato que había en el plan antes de que el coach lo
          // cambiara por lo que de verdad se comió (ver daily.ts). Si sigue
          // coincidiendo con lo planificado, no cuenta como cambio.
          const wasIdea = h.wasIdea && h.wasIdea !== planned ? h.wasIdea : null;
          const skipped = h.status === "salteo";
          const unlogged = h.status == null;
          const changed = h.status === "distinto";

          return (
            <div key={h.label}>
              <button
                type="button"
                disabled={!editable}
                onClick={() => setEditing((prev) => (prev === i ? null : i))}
                className="w-full rounded-xl bg-secondary/50 px-3 py-2.5 text-left disabled:opacity-70"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold tracking-[0.01em] text-foreground">
                    {h.label}
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      h.status === "plan"
                        ? "text-success"
                        : skipped || unlogged
                          ? "text-muted-foreground"
                          : "text-primary"
                    }`}
                  >
                    {unlogged ? "Sin registrar" : MEAL_STATUS_LABEL[h.status!]}
                  </span>
                </div>
                {planned || wasIdea ? (
                  <p
                    className={`mt-1 text-sm ${
                      skipped || unlogged
                        ? "text-muted-foreground line-through"
                        : changed
                          ? "text-primary"
                          : "text-foreground"
                    }`}
                  >
                    {planned || wasIdea}
                  </p>
                ) : null}
                {wasIdea ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    Plan sugerido: <span className="line-through">{wasIdea}</span>
                  </p>
                ) : null}
              </button>
              {editing === i ? (
                <div className="mt-1.5 flex flex-wrap gap-2 rounded-xl bg-secondary/40 p-2.5">
                  {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(i, s)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 ${
                        h.status === s
                          ? "bg-foreground text-background"
                          : "bg-surface text-muted-foreground"
                      }`}
                    >
                      {MEAL_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {editable ? (
          <p className="pt-0.5 text-[11px] text-muted-foreground">
            Corregir aquí es solo para tu historial: la compra ya hecha de ese mes no cambia.
          </p>
        ) : null}
      </div>

      <div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Macros del día
        </span>
        {log?.guide?.macroEstimate || log?.guide?.mealMacros?.length ? (
          <MacroBars
            estimate={consumed}
            target={log.guide.macroEstimate ?? null}
            weightKg={profile?.current_weight_kg ?? null}
            note={`~${consumed.kcal} kcal de lo que comiste ese día`}
          />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No hay estimación de macros para este día.
          </p>
        )}
      </div>
    </div>
  );
}
