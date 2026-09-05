import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
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
import { isSharedSlot, type SharedSlots } from "@/lib/household-shared";
import { propagateLogToFamily } from "@/lib/household.functions";
import { sumDoneMacros, ZERO_MACROS } from "@/lib/macros";
import {
  childMealsForDate,
  isBeforeAppStart,
  mealsForDate,
  offListNote,
  type MonthlyPlan,
} from "@/lib/plan-shared";

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
  householdChildren,
  household,
  onClose,
}: {
  date: string | null;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  /** Niños de la casa, para el plato aparte de un niño ese día (issue 07). */
  householdChildren?: { id: string; name: string }[];
  /** Contexto del hogar para el toggle "toda la familia comió esto". */
  household?: DayDetailHousehold;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">{date ? longDate(date) : ""}</DialogTitle>
        </DialogHeader>
        {date ? (
          <DayDetailBody
            date={date}
            plan={plan}
            log={log}
            profile={profile}
            householdChildren={householdChildren}
            household={household}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cuerpo del detalle de un día pasado, sin wrapper de diálogo. Se exporta para
 * que Hoy lo pueda renderizar inline al tocar un día pasado en el WeekStrip.
 */
/** Contexto del hogar que necesita el toggle "toda la familia comió esto". */
export type DayDetailHousehold = {
  sharedSlots: SharedSlots;
  /** Todos los miembros con user_id (para saber si hay alguien más a quien propagar). */
  memberCount: number;
};

export function DayDetailBody({
  date,
  plan,
  log,
  profile,
  householdChildren,
  household,
}: {
  date: string;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  householdChildren?: { id: string; name: string }[];
  /** Si se pasa, habilita el toggle "toda la familia comió esto" en las comidas compartidas. */
  household?: DayDetailHousehold;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  // Texto libre de "qué comí realmente" por índice de habit, mientras se edita.
  const [actualDraft, setActualDraft] = useState<Record<number, string>>({});
  // Toggle "toda la familia comió esto" por índice de habit.
  const [familyToggle, setFamilyToggle] = useState<Record<number, boolean>>({});
  const propagate = useServerFn(propagateLogToFamily);

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

  /** ¿Este habit corresponde a una comida compartida ese día? */
  const isShared = (label: string): boolean => {
    if (!household || household.memberCount <= 1) return false;
    const labelToKey: Record<string, "desayuno" | "comida" | "cena"> = {
      desayuno: "desayuno",
      comida: "comida",
      cena: "cena",
    };
    const mealKey = labelToKey[label.toLowerCase()];
    if (!mealKey) return false;
    const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
    return isSharedSlot(household.sharedSlots, mealKey, weekday);
  };

  const maybePropagateToFamily = (index: number, status: MealStatus, actual?: string) => {
    if (!familyToggle[index] || !habits[index]) return;
    propagate({
      data: {
        date,
        habitLabel: habits[index].label,
        status,
        actual,
      },
    }).then(
      (r) => {
        if (r.propagated > 0) toast.success(`Aplicado a ${r.propagated} familiar(es) más`);
      },
      () => {
        // Silencioso: el log propio ya se guardó, la propagación es best-effort.
      },
    );
  };

  const setStatus = (index: number, status: MealStatus) => {
    const actual = status === "distinto" ? actualDraft[index]?.trim() : undefined;
    const next = habits.map((h, i) =>
      i === index
        ? {
            ...h,
            status,
            done: status === "plan" || status === "distinto",
            ...(status === "distinto" ? { actual: actual || h.actual } : { actual: undefined }),
          }
        : h,
    );
    correct.mutate({ habits: next });
    maybePropagateToFamily(index, status, actual || habits[index]?.actual);
    setEditing(null);
    setActualDraft((d) => {
      const copy = { ...d };
      delete copy[index];
      return copy;
    });
    setFamilyToggle((t) => {
      const copy = { ...t };
      delete copy[index];
      return copy;
    });
  };

  /** Guardar solo el texto de "qué comí" sin cambiar el status. */
  const saveActual = (index: number) => {
    const text = actualDraft[index]?.trim();
    if (!text) return;
    const next = habits.map((h, i) => (i === index ? { ...h, actual: text } : h));
    correct.mutate({ habits: next });
    maybePropagateToFamily(index, "distinto", text);
    setEditing(null);
    setActualDraft((d) => {
      const copy = { ...d };
      delete copy[index];
      return copy;
    });
    setFamilyToggle((t) => {
      const copy = { ...t };
      delete copy[index];
      return copy;
    });
  };

  // Plato planificado de cada momento (comida/cena del día exacto, desayuno/snack
  // por rotación o plato pedido a mano). El detalle recorre `habits` porque son
  // el registro real de lo que se siguió ese día.
  const dayMeals = mealsForDate(plan, date);
  const plannedByLabel = new Map(dayMeals.map((m) => [m.moment, m.idea]));
  // Platos aparte de un niño ese día (issue 07), agrupados por el rótulo del
  // momento para colgarlos bajo la comida correspondiente.
  const kidMealsByLabel = new Map<string, { name: string; dish: string; off: string[] }[]>();
  for (const c of householdChildren ?? []) {
    for (const k of childMealsForDate(plan, date, c.id)) {
      const label = dayMeals.find((m) => m.slot === k.slot)?.moment;
      if (!label) continue;
      const list = kidMealsByLabel.get(label) ?? [];
      list.push({ name: c.name, dish: k.dish, off: k.off });
      kidMealsByLabel.set(label, list);
    }
  }

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
                onClick={() => {
                  setEditing((prev) => (prev === i ? null : i));
                  // Pre-rellenar el draft con el valor existente si lo hay
                  if (h.actual && !(i in actualDraft)) {
                    setActualDraft((d) => ({ ...d, [i]: h.actual! }));
                  }
                }}
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
                        : changed && h.actual
                          ? "text-muted-foreground line-through"
                          : changed
                            ? "text-primary"
                            : "text-foreground"
                    }`}
                  >
                    {planned || wasIdea}
                  </p>
                ) : null}
                {/* Mostrar qué comió realmente si ya lo indicó */}
                {changed && h.actual ? (
                  <p className="mt-0.5 text-sm text-primary">Comí: {h.actual}</p>
                ) : null}
                {wasIdea ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    Plan sugerido: <span className="line-through">{wasIdea}</span>
                  </p>
                ) : null}
                {(kidMealsByLabel.get(h.label) ?? []).map((k) => (
                  <p
                    key={`${k.name}-${k.dish}`}
                    className="mt-0.5 text-[11px] leading-snug text-muted-foreground"
                  >
                    Para {k.name}: <span className="text-foreground">{k.dish}</span>
                    {offListNote(k.off) ? ` · ${offListNote(k.off)}` : ""}
                  </p>
                ))}
              </button>
              {editing === i ? (
                <div className="mt-1.5 space-y-2 rounded-xl bg-secondary/40 p-2.5">
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          if (s === "distinto") {
                            // Si no hay texto aún, no cerrar — esperar a que escriba
                            if (!actualDraft[i]?.trim() && !h.actual) return;
                          }
                          setStatus(i, s);
                        }}
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
                  {/* Toggle "toda la familia comió esto" para comidas compartidas */}
                  {isShared(h.label) ? (
                    <button
                      type="button"
                      onClick={() => setFamilyToggle((t) => ({ ...t, [i]: !t[i] }))}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        familyToggle[i]
                          ? "bg-primary/10 text-primary"
                          : "bg-surface text-muted-foreground"
                      }`}
                    >
                      <Users className="h-4 w-4" />
                      Toda la familia comió esto
                    </button>
                  ) : null}
                  {/* Campo de texto para indicar qué comió realmente */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      ¿Qué comiste realmente?
                    </label>
                    <input
                      type="text"
                      autoFocus={!h.actual}
                      value={actualDraft[i] ?? h.actual ?? ""}
                      onChange={(e) => setActualDraft((d) => ({ ...d, [i]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (h.status === "distinto") saveActual(i);
                          else setStatus(i, "distinto");
                        }
                      }}
                      placeholder="Ej.: pizza, ensalada de pollo..."
                      className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <button
                      type="button"
                      disabled={!actualDraft[i]?.trim() && !h.actual}
                      onClick={() => {
                        if (h.status === "distinto") saveActual(i);
                        else setStatus(i, "distinto");
                      }}
                      className="w-full rounded-full bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {h.status === "distinto" ? "Guardar" : "Comí esto"}
                    </button>
                  </div>
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
