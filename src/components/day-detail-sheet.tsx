import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cookie, Loader2, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MacroBars } from "@/components/macro-bars";
import { SnackSheet } from "@/components/snack-sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MEAL_STATUS_LABEL,
  todayISO,
  updateLogByDate,
  type DailyLog,
  type MealStatus,
  type Profile,
} from "@/lib/daily";
import { dayMovedChanges } from "@/lib/day-balance";
import { cleanDayExercise } from "@/lib/exercise";
import { isSharedSlot, type SharedSlots } from "@/lib/household-shared";
import { propagateLogToFamily } from "@/lib/household.functions";
import { generateDailyGuide } from "@/lib/guide.functions";
import {
  addMacros,
  donePendingMeals,
  mealsToRecalculate,
  mergeGuide,
  showsNutritionNumbers,
  sumDoneMacros,
  ZERO_MACROS,
} from "@/lib/macros";
import {
  capitalizeFirst,
  childMealsForDate,
  effectiveMealSlots,
  isBeforeAppStart,
  mealsForDate,
  offListNote,
  suggestedDish,
  type MonthlyPlan,
} from "@/lib/plan-shared";
import { cleanDaySnacks, snackTotals } from "@/lib/snacks";
import { removeSnack as removeSnackFn } from "@/lib/snacks.functions";

const longDate = (date: string) =>
  capitalizeFirst(
    new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );

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
          <DialogTitle>{date ? longDate(date) : ""}</DialogTitle>
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
 * que Hoy lo pueda renderizar inline al tocar un día pasado en la tira de WeekPager.
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
  const [snackSheetOpen, setSnackSheetOpen] = useState(false);
  const [removingSnackId, setRemovingSnackId] = useState<string | null>(null);
  const propagate = useServerFn(propagateLogToFamily);
  const removeSnackCall = useServerFn(removeSnackFn);
  const makeGuide = useServerFn(generateDailyGuide);

  const refreshLogs = () => {
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["logs", date.slice(0, 7)] });
  };

  // Un día con platos que se quedaron "calculando" (D13) se recalcula al abrir
  // su detalle: solo esos platos y sin texto. Una vez por apertura; si vuelve a
  // fallar, se queda diciendo "por calcular" hasta la siguiente.
  const recalcTriedRef = useRef("");
  useEffect(() => {
    const guide = log?.guide;
    const pending = mealsToRecalculate(guide?.mealMacros).filter((m) => m.idea);
    if (!guide || !pending.length || recalcTriedRef.current === date) return;
    recalcTriedRef.current = date;
    void makeGuide({
      data: {
        meals: pending.map((m) => ({ moment: m.moment, idea: m.idea! })),
        macrosOnly: true,
      },
    })
      .then(async ({ mealMacros }) => {
        if (!mealMacros?.length) return;
        const merged = (guide.mealMacros ?? []).map(
          (m) => mealMacros.find((f) => f.moment === m.moment && f.idea === m.idea) ?? m,
        );
        await updateLogByDate(date, { guide: mergeGuide(guide, { ...guide, mealMacros: merged }) });
        refreshLogs();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, log?.guide]);

  // Corregir el picoteo de un día pasado solo actualiza su historial: a
  // diferencia de hoy, no se llama a `scheduleSnackSettle` (el asentamiento
  // recoloca días posteriores a HOY, no a un día que ya pasó).
  const removeSnack = async (id: string) => {
    setRemovingSnackId(id);
    try {
      await removeSnackCall({ data: { today: date, id } });
      refreshLogs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No hemos podido quitar el picoteo");
    } finally {
      setRemovingSnackId(null);
    }
  };

  const editable = date < todayISO();
  const beforeStart = isBeforeAppStart(date, profile?.app_started_on);
  const mySlots = effectiveMealSlots(profile ?? {});

  // Si ese día no tiene registro (la persona no abrió la app), se parte de las
  // comidas del plan para poder rellenarlo. Antes salía "No registraste ninguna
  // comida" sin forma de corregirlo. Solo para días editables y posteriores al
  // alta; `updateLogByDate` crea la fila en el primer cambio. Antes esto no
  // filtraba por `.idea`: un slot sin plato colaba igualmente un hábito vacío
  // ("Desayuno: false") que se podía marcar como hecho sin haber existido.
  const planHabits: DailyLog["habits"] = mealsForDate(plan, date, mySlots).map((m) => ({
    label: m.moment,
    done: false,
  }));
  const isBackfill = !log?.habits?.length && editable && !beforeStart && planHabits.length > 0;
  const habits = log?.habits?.length ? log.habits : isBackfill ? planHabits : [];

  const correct = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateLogByDate(date, patch),
    onSuccess: refreshLogs,
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
        today: todayISO(),
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

  // Picoteo del día (`picoteo-hoy`): editable (añadir/quitar) igual que hoy,
  // pero sin disparar el asentamiento — ese ajusta días posteriores a HOY, no
  // a un día que ya pasó (ver `resumeSnackSettle` en snack-settle.ts).
  const snacks = cleanDaySnacks(log?.snacks);
  const snackEntries = snacks?.entries ?? [];
  // Lo que el desvío de ESTE día movió en los siguientes. Es del día entero,
  // no del picoteo: antes esta línea vivía dentro del bloque de picoteo y solo
  // contaba lo suyo, con lo que un día movido por el deporte o por un cambio de
  // plato no enseñaba nada (`balance-del-dia`).
  const moved = dayMovedChanges({
    adjustment: log?.adjustment,
    habits,
    snacks,
    exercise: cleanDayExercise(log?.exercise),
  }).length;

  if (!habits.length && !snackEntries.length && beforeStart) {
    return (
      <p className="text-sm text-muted-foreground">
        Antes de empezar a usar Peppers. No hay nada registrado de este día.
      </p>
    );
  }

  const doneCount = habits.filter((h) => h.done).length;
  // Solo cuenta como "saltada" lo que la persona marcó explícitamente como tal;
  // una comida sin registrar es neutra, no un fallo (roadmap UX: "un mal día es
  // gris apagado, nunca se enmarca como fracaso").
  const skippedCount = habits.filter((h) => h.status === "salteo").length;
  const consumed = addMacros(
    sumDoneMacros(log?.guide?.mealMacros, habits) ?? ZERO_MACROS,
    snackTotals(snacks),
  );
  // Ticket 01: sin cifras si la persona ha elegido no verlas.
  const showNumbers = showsNutritionNumbers(profile);
  const hasMacros =
    !!(log?.guide?.macroEstimate || log?.guide?.mealMacros?.length) || snackEntries.length > 0;

  return (
    <div className="space-y-4">
      {habits.length ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Comidas
            </span>
            <span className="font-num text-[11px] tabular-nums text-muted-foreground">
              {doneCount} de {habits.length}
              {skippedCount ? ` · ${skippedCount} saltada${skippedCount > 1 ? "s" : ""}` : ""}
            </span>
          </div>
          {habits.map((h, i) => {
            const planned = plannedByLabel.get(h.label) ?? "";
            // La sugerencia original del plan para ese momento, si lo que se ve
            // ya no es ella (ver `plannedIdea` en plan-shared.ts).
            const wasIdea = suggestedDish(h, planned);
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
      ) : null}

      {!beforeStart || snackEntries.length ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Picoteo
            </span>
            {snackEntries.length && showNumbers ? (
              <span className="font-num text-[11px] tabular-nums text-muted-foreground">
                ~{snackTotals(snacks).kcal} kcal
              </span>
            ) : null}
          </div>
          {snackEntries.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 text-sm text-foreground">{e.text}</span>
              {showNumbers ? (
                <span className="font-num text-[11px] tabular-nums text-muted-foreground">
                  {e.kcal} kcal
                </span>
              ) : null}
              {!beforeStart ? (
                <button
                  type="button"
                  onClick={() => void removeSnack(e.id)}
                  disabled={removingSnackId != null}
                  aria-label={`Quitar ${e.text}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground transition-opacity hover:text-foreground disabled:opacity-60"
                >
                  {removingSnackId === e.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              ) : null}
            </div>
          ))}
          {!beforeStart ? (
            <button
              type="button"
              onClick={() => setSnackSheetOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-secondary/50 py-2 text-xs font-semibold text-foreground transition-transform active:scale-[0.99]"
            >
              <Cookie className="h-3.5 w-3.5" aria-hidden />
              Añadir picoteo
            </button>
          ) : null}
        </div>
      ) : null}

      {moved ? (
        <p className="text-[11px] text-muted-foreground">
          Lo de este día ajustó {moved === 1 ? "1 comida" : `${moved} comidas`} de los días
          siguientes.
        </p>
      ) : null}

      <SnackSheet
        open={snackSheetOpen}
        onOpenChange={setSnackSheetOpen}
        today={date}
        onSaved={refreshLogs}
        pastDay
        showNumbers={showNumbers}
      />

      {showNumbers ? (
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Macros del día
          </span>
          {hasMacros ? (
            <MacroBars
              estimate={consumed}
              target={log?.guide?.targets ?? log?.guide?.macroEstimate ?? null}
              weightKg={profile?.current_weight_kg ?? null}
              note={`~${consumed.kcal} kcal de lo que comiste ese día`}
              pending={donePendingMeals(log?.guide?.mealMacros, habits).length}
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No hay estimación de macros para este día.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
