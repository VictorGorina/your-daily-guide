import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Alert } from "react-native";

import { apiPost } from "./api";
import {
  fetchMonthlyPlan,
  fetchTodayLog,
  patchTodayHabits,
  todayISO,
  updateTodayLog,
  type DailyGuide,
  type DailyLog,
} from "./daily";
import {
  bindDaySettleDeps,
  daySettleInFlight,
  queueDishChange,
  unqueueDishChange,
  useDaySettle,
  type DishDelta,
  type PendingDish,
  type ResolvedDishes,
} from "./day-settle";
import { VAGUE_DISH_MESSAGE } from "./content-guard";
import type { DishMacros } from "./daily";
import { guideReuse, isMealCalculated, mergeGuide, perMealDeltas } from "./macros";
import { mealsForDate, type MealChange, type MealSlot, type MonthlyPlan } from "./plan-shared";

export type { MealChange };

/**
 * Cambio de plato desde Hoy, en dos tiempos. Copia de `src/lib/use-meal-swap.ts`
 * de la web (este repo no es un monorepo); la única diferencia es que aquí las
 * operaciones con IA van por el espejo HTTP `/api/v1/*` con `apiPost`, porque la
 * app no puede llamar server functions de TanStack Start.
 *
 * **Al tocar el plato (sin IA, inmediato):** `plan/meal` escribe el plato tal
 * cual y se marca esa comida como "comí distinto". Nada bloquea la pantalla.
 *
 * **Tras la ventana de calma:** el cambio entra en el lote del DÍA
 * (`day-settle.ts`), que es el mismo para el picoteo y el deporte. Lo único que
 * aporta este módulo a ese lote es `resolveDishDeltas`: regenerar las macros de
 * hoy una sola vez y sacar de ahí el desvío por comida. Quién decide si hay que
 * recolocar días futuros, y con cuánto, es `settleDay` mirando el día entero —
 * ver `day-balance.ts` para por qué esa decisión no puede ser por origen.
 */

/** Comidas que esta persona planifica, para no inflar el objetivo del día. */
let plannedSlots: readonly MealSlot[] = [];

/**
 * Regenera las macros del día con los platos ya cambiados y saca el desvío de
 * cada comida. UNA llamada por lote, y solo se descompone lo que ha cambiado:
 * lo que ya tenía cifra va como `reuse`.
 *
 * Solo se mide con las dos cifras calculadas (D13). Si el plato del plan no
 * tenía cifra congelada, se calcula en la misma llamada (`extraDishes`); si el
 * plato nuevo sigue "calculando", el cambio vuelve a la cola del día.
 */
async function resolveDishDeltas(dishes: PendingDish[]): Promise<ResolvedDishes> {
  const today = todayISO();
  const month = today.slice(0, 7);

  const planRow = await fetchMonthlyPlan(month);
  const planBefore = ((planRow?.plan as MonthlyPlan | null) ?? null) as MonthlyPlan | null;

  // Solo las comidas que esta persona planifica: con todas, el objetivo del día
  // (`macroEstimate`) salía inflado con una merienda que ni se muestra en Hoy, y
  // ese objetivo es contra el que se miden la barra de macros y el semáforo del
  // calendario.
  const meals = mealsForDate(planBefore, today, plannedSlots)
    .filter((m) => m.idea)
    .map((m) => ({ moment: m.moment, idea: m.idea }));
  const currentLog = await fetchTodayLog();
  const currentGuide = currentLog?.guide ?? null;
  const measured = dishes.filter((d) => d.kcalDeltaOverride == null);
  // Plato del plan sin cifra: se calcula ahora, con su receta, antes de medir.
  const needPlanned = measured.filter((d) => d.prevKcal == null && d.plannedDish);
  const { dishMacros, ...freshGuide } = await apiPost<DailyGuide & { dishMacros?: DishMacros[] }>(
    "guide",
    {
      meals,
      reuse: guideReuse(currentGuide?.mealMacros, currentLog?.habits),
      extraDishes: needPlanned.map((d) => d.plannedDish),
    },
  );
  const guide: DailyGuide = {
    // Nunca perder cifras buenas si la regeneración vuelve sin ellas.
    ...mergeGuide(currentGuide, freshGuide),
    // Y el objetivo de la barra se fija con el plan original: no se mueve porque
    // la persona haya cambiado un plato.
    macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate ?? null,
  };
  await updateTodayLog({ guide });

  // Las cifras del plan recién calculadas se congelan en la comida.
  const planned = new Map<string, { kcal: number; protein: number }>();
  needPlanned.forEach((d, i) => {
    const m = dishMacros?.[i];
    if (m?.status === "calculado") planned.set(d.label, { kcal: m.kcal, protein: m.protein_g });
  });
  if (planned.size) {
    await patchTodayHabits((habits) =>
      habits.map((h) => {
        const p = planned.get(h.label);
        return p && h.plannedKcal == null
          ? { ...h, plannedKcal: p.kcal, plannedProtein: p.protein }
          : h;
      }),
    ).catch(() => {});
  }
  const withPlanned = measured.map((d) => {
    const p = planned.get(d.label);
    return p ? { ...d, prevKcal: p.kcal, prevProtein: p.protein } : d;
  });

  const { resolved, unresolved } = perMealDeltas(withPlanned, guide.mealMacros);
  const byLabel = new Map(withPlanned.map((d) => [d.label, d]));
  const overrides = dishes.filter((d) => d.kcalDeltaOverride != null);
  const deltas: DishDelta[] = [
    ...resolved.map(({ label, kcalDelta, proteinDelta }) => {
      const d = byLabel.get(label)!;
      return {
        label,
        slot: d.slot,
        dish: d.dish,
        plannedDish: d.plannedDish,
        kcalDelta,
        proteinDelta,
      };
    }),
    ...overrides.map((d) => ({
      label: d.label,
      slot: d.slot,
      dish: d.dish,
      plannedDish: d.plannedDish,
      kcalDelta: d.kcalDeltaOverride!,
      proteinDelta: d.proteinDeltaOverride ?? null,
    })),
  ];
  return { deltas, unresolved: unresolved.map((label) => byLabel.get(label)!).filter(Boolean) };
}

// ---------------------------------------------------------------------------
// "Guardando" es por comida y vive fuera del componente: cambiar una comida no
// debe bloquear las demás, y el guardado puede terminar con Hoy desmontado.
// ---------------------------------------------------------------------------

let savingSnapshot = new Set<string>();
const savingListeners = new Set<() => void>();

function markSaving(label: string, on: boolean) {
  const next = new Set(savingSnapshot);
  if (on) next.add(label);
  else next.delete(label);
  savingSnapshot = next;
  for (const cb of savingListeners) cb();
}

const subscribeSaving = (cb: () => void) => {
  savingListeners.add(cb);
  return () => {
    savingListeners.delete(cb);
  };
};

export function useMealSwap(
  getLog: () => DailyLog | undefined,
  getPlan: () => MonthlyPlan | null | undefined,
  /** Comidas que esta persona planifica (`effectiveMealSlots` de su perfil). */
  slots: readonly MealSlot[],
) {
  const qc = useQueryClient();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["plan"] });
  }, [qc]);

  // Las dependencias del lote del día viven a nivel de módulo, no del
  // componente: el lote puede saltar con Hoy ya desmontado.
  useEffect(() => {
    plannedSlots = slots;
    bindDaySettleDeps({ resolveDishDeltas, onDone: refresh });
  }, [refresh, slots]);

  const state = useDaySettle(todayISO(), () => {
    /* el refresco lo hace `onDone` de las deps; aquí solo se suscribe el estado */
  });
  const saving = useSyncExternalStore(
    subscribeSaving,
    () => savingSnapshot,
    () => savingSnapshot,
  );

  /**
   * Cambia el plato. Devuelve `{ ok: false, vague: true }` si el texto no dice
   * qué se comió (ticket 13): la hoja se queda abierta y pide concretar u
   * ofrece apuntar las kcal a mano (`manualKcal`), que salta esa comprobación.
   */
  const swap = useCallback(
    async (
      label: string,
      slot: MealSlot,
      dish: string,
      opts: { manualKcal?: number } = {},
    ): Promise<{ ok: true } | { ok: false; vague: boolean; message: string }> => {
      const today = todayISO();
      const log = getLog();
      const habitNow = log?.habits?.find((h) => h.label === label);
      const plannedDish =
        habitNow?.plannedIdea ||
        habitNow?.wasIdea ||
        mealsForDate(getPlan() ?? null, today).find((m) => m.slot === slot)?.idea ||
        "";
      // Solo una cifra CALCULADA vale como referencia (D13): una comida que aún
      // estaba "calculando" deja `null` y se calcula al asentar.
      const plannedMacros = log?.guide?.mealMacros?.find(
        (m) => m.moment === label && isMealCalculated(m),
      );
      const prevKcal = habitNow?.plannedKcal ?? plannedMacros?.kcal ?? null;
      const prevProtein =
        habitNow?.plannedKcal != null
          ? (habitNow.plannedProtein ?? null)
          : (plannedMacros?.protein_g ?? null);
      const manualKcal =
        opts.manualKcal != null && Number.isFinite(opts.manualKcal)
          ? Math.max(0, Math.min(5000, Math.round(opts.manualKcal)))
          : undefined;

      markSaving(label, true);
      let savedDish = dish;
      try {
        // `dish` en la respuesta es el texto de la persona con la ortografía
        // corregida por el servidor (`resolveDish`): es lo que de verdad ha
        // quedado escrito en el plan, así que es lo que se manda al lote más
        // abajo (el texto crudo dejaría de coincidir con lo que ya se guardó).
        const { dish: correctedDish, previousIdea } = await apiPost<{
          dish: string;
          previousIdea: string;
        }>("plan/meal", {
          date: today,
          slot,
          dish,
          today,
          ...(manualKcal != null ? { manual: true } : {}),
        });
        savedDish = correctedDish;
        await patchTodayHabits((habits) =>
          habits.map((h) => {
            if (h.label !== label) return h;
            const { manualKcal: _previousManual, ...rest } = h;
            return {
              ...rest,
              status: "distinto" as const,
              done: true,
              confirmedIdea: correctedDish,
              plannedIdea: h.plannedIdea || h.wasIdea || previousIdea || plannedDish,
              ...(prevKcal == null
                ? {}
                : {
                    plannedKcal: h.plannedKcal ?? prevKcal,
                    ...(h.plannedKcal == null && prevProtein != null
                      ? { plannedProtein: prevProtein }
                      : {}),
                  }),
              ...(manualKcal != null ? { manualKcal } : {}),
              adjustmentChanges: undefined,
              adjustmentSummary: undefined,
              adjustmentKcal: undefined,
            };
          }),
        );
      } catch (err) {
        // La hoja enseña el error en su sitio (y, si es vago, ofrece las kcal a
        // mano): sin alerta, que lo duplicaría.
        const message = err instanceof Error ? err.message : "No hemos podido cambiar el plato";
        return { ok: false, vague: message === VAGUE_DISH_MESSAGE, message };
      } finally {
        markSaving(label, false);
      }

      refresh();
      queueDishChange(today, { label, slot, dish: savedDish, plannedDish, prevKcal, prevProtein });
      return { ok: true };
    },
    [getLog, getPlan, refresh],
  );

  /**
   * "Deshacer" de una comida de hoy: además de quitarle el estado, **devuelve
   * el plato del plan** si se había cambiado a mano. Es lo que hace que "Ver
   * receta" vuelva a aparecer: la receta se oculta porque el plato ya no es el
   * del plan (`suggestedDish`), así que restaurarlo la recupera sin ninguna
   * regla aparte. Si el cambio ya había movido días futuros, se encola el
   * desvío contrario. Copia de `src/lib/use-meal-swap.ts` de la web.
   *
   * `null` si no había nada que restaurar (la pantalla limpia entonces el
   * estado a secas).
   */
  const revert = useCallback(
    async (label: string, slot: MealSlot): Promise<DailyLog["habits"] | null> => {
      const today = todayISO();
      const currentDish = mealsForDate(getPlan() ?? null, today).find((m) => m.slot === slot)?.idea;

      // Un cambio aún sin mandar se retira del lote: compensarlo ya no tiene
      // sentido, el plato vuelve a ser el del plan.
      const queued = unqueueDishChange(label);
      // La fila se marca ocupada YA: si el lote está en vuelo hay que esperarlo
      // y son decenas de segundos en los que el botón parecería muerto.
      markSaving(label, true);
      try {
        // Si el lote de ESTA comida está en vuelo, hay que esperarlo: el desvío
        // que escribe el servidor es justo la cifra que luego hay que devolver.
        if (!queued) await daySettleInFlight()?.catch(() => {});

        // El registro se relee de la base de datos, no de la caché de la
        // pantalla: `swapCompensated` lo escribe el servidor y la caché puede ir
        // por detrás justo después de un lote.
        const habit =
          (await fetchTodayLog().catch(() => null))?.habits?.find((h) => h.label === label) ??
          getLog()?.habits?.find((h) => h.label === label);
        const plannedDish = habit?.plannedIdea || habit?.wasIdea || "";
        // Nada que restaurar: el plato ya es el del plan (o nunca se cambió).
        if (!plannedDish || plannedDish === currentDish) return null;

        // Lo que el cambio movió en los días futuros y hay que devolver. Si
        // seguía en la cola, no se movió nada.
        const compensated = !queued && habit?.swapCompensated ? (habit.swapKcalDelta ?? 0) : 0;
        const compensatedProtein =
          !queued && habit?.swapCompensated ? (habit.swapProteinDelta ?? null) : null;
        await apiPost("plan/meal", {
          date: today,
          slot,
          dish: plannedDish,
          today,
          pin: false,
        });
        const next = await patchTodayHabits((habits) =>
          habits.map((h) =>
            h.label !== label
              ? h
              : {
                  label: h.label,
                  done: false,
                  // `plannedIdea` se vuelve a congelar AQUÍ, con el plato que
                  // se acaba de restaurar, en vez de dejárselo a
                  // `reconcileHabits` en la siguiente carga: esa corre con el
                  // plan que tenga la caché en ese instante y, si todavía va
                  // por detrás, congelaba el plato cambiado — con lo que la
                  // comida seguía saliendo como "editada" (tachado y sin
                  // receta) después de deshacer.
                  plannedIdea: plannedDish,
                  ...(compensated || compensatedProtein
                    ? {
                        swapKcalDelta: -compensated,
                        ...(compensatedProtein ? { swapProteinDelta: -compensatedProtein } : {}),
                        swapCompensated: false,
                      }
                    : {}),
                },
          ),
        );
        if (compensated || compensatedProtein) {
          queueDishChange(today, {
            label,
            slot,
            dish: plannedDish,
            plannedDish,
            prevKcal: null,
            kcalDeltaOverride: -compensated,
            proteinDeltaOverride: compensatedProtein ? -compensatedProtein : null,
          });
        }
        refresh();
        return next;
      } catch (err) {
        Alert.alert(err instanceof Error ? err.message : "No hemos podido deshacer el cambio");
        return null;
      } finally {
        markSaving(label, false);
      }
    },
    [getLog, getPlan, refresh],
  );

  return {
    swap,
    revert,
    isSaving: (label: string) => saving.has(label),
    isAdjusting: (label: string) => state.dishes.has(label),
  };
}
