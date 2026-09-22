import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  fetchMonthlyPlan,
  fetchTodayLog,
  patchTodayHabits,
  todayISO,
  updateTodayLog,
  type DailyGuide,
  type DailyLog,
} from "@/lib/daily";
import {
  bindDaySettleDeps,
  daySettleInFlight,
  queueDishChange,
  unqueueDishChange,
  useDaySettle,
  type DishDelta,
  type PendingDish,
} from "@/lib/day-settle";
import { settleDay } from "@/lib/day-settle.functions";
import { generateDailyGuide } from "@/lib/guide.functions";
import { mergeGuide, perMealKcalDeltas } from "@/lib/macros";
import { setPlanMeal } from "@/lib/plan.functions";
import { mealsForDate, type MealChange, type MealSlot, type MonthlyPlan } from "@/lib/plan-shared";

export type { MealChange };

/**
 * Cambio de plato desde Hoy, en dos tiempos.
 *
 * **Al tocar el plato (sin IA, inmediato):** `setPlanMeal` escribe el plato tal
 * cual y se marca esa comida como "comí distinto". Nada bloquea la pantalla, y
 * se puede cambiar otra comida acto seguido.
 *
 * **Tras la ventana de calma:** el cambio entra en el lote del DÍA
 * (`day-settle.ts`), que es el mismo para el picoteo y el deporte. Lo único que
 * aporta este módulo a ese lote es `resolveDishDeltas`: regenerar las macros de
 * hoy una sola vez y sacar de ahí el desvío por comida. Quién decide si hay que
 * recolocar días futuros, y con cuánto, es `settleDay` mirando el día entero —
 * ver `day-balance.ts` para por qué esa decisión no puede ser por origen.
 *
 * Antes este módulo tenía su propio timer, su propia clave de `localStorage` y
 * su propia llamada a `compensateDishChanges`, en paralelo a las de picoteo y
 * deporte. De eso solo queda el cálculo de macros.
 */

/** Comidas que esta persona planifica, para no inflar el objetivo del día. */
let plannedSlots: readonly MealSlot[] = [];

/**
 * Regenera las macros del día con los platos ya cambiados y saca el desvío de
 * cada comida. UNA llamada al modelo por lote, no una por plato.
 */
async function resolveDishDeltas(dishes: PendingDish[]): Promise<DishDelta[]> {
  const today = todayISO();
  const month = today.slice(0, 7);

  // El plan se relee de la base de datos en vez de fiarlo a la caché de la
  // pantalla: el lote puede saltar con Hoy ya desmontado.
  const planRow = await fetchMonthlyPlan(month);
  const planBefore: MonthlyPlan | null = planRow?.plan ?? null;

  // Solo las comidas que esta persona planifica: con todas, el objetivo del día
  // (`macroEstimate`) salía inflado con una merienda que ni se muestra en Hoy, y
  // ese objetivo es contra el que se miden la barra de macros y el semáforo del
  // calendario.
  const meals = mealsForDate(planBefore, today, plannedSlots)
    .filter((m) => m.idea)
    .map((m) => ({ moment: m.moment, idea: m.idea }));
  const freshGuide = await generateDailyGuide({ data: { meals } });
  const currentGuide = (await fetchTodayLog())?.guide ?? null;
  const guide: DailyGuide = {
    // Nunca perder cifras buenas si la regeneración vuelve sin ellas.
    ...mergeGuide(currentGuide, freshGuide),
    // Y el objetivo de la barra se fija con el plan original: no se mueve porque
    // la persona haya cambiado un plato.
    macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate ?? null,
  };
  await updateTodayLog({ guide });

  const byLabel = new Map(dishes.map((d) => [d.label, d]));
  const deltas = [
    ...perMealKcalDeltas(
      dishes.filter((d) => d.kcalDeltaOverride == null),
      freshGuide.mealMacros,
    ),
    ...dishes
      .filter((d) => d.kcalDeltaOverride != null)
      .map((d) => ({ label: d.label, kcalDelta: d.kcalDeltaOverride! })),
  ];
  return deltas.map(({ label, kcalDelta }) => {
    const d = byLabel.get(label)!;
    return { label, slot: d.slot, dish: d.dish, plannedDish: d.plannedDish, kcalDelta };
  });
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
  const changeMeal = useServerFn(setPlanMeal);
  const settle = useServerFn(settleDay);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["today"] });
    qc.invalidateQueries({ queryKey: ["logs"] });
    qc.invalidateQueries({ queryKey: ["plan"] });
  }, [qc]);

  // Las dependencias del lote del día viven a nivel de módulo, no del
  // componente: el lote puede saltar con Hoy ya desmontado.
  useEffect(() => {
    plannedSlots = slots;
    bindDaySettleDeps({ resolveDishDeltas, settle, onDone: refresh });
  }, [refresh, settle, slots]);

  const state = useDaySettle(todayISO(), () => {
    /* el refresco lo hace `onDone` de las deps; aquí solo se suscribe el estado */
  });
  const saving = useSyncExternalStore(
    subscribeSaving,
    () => savingSnapshot,
    () => savingSnapshot,
  );

  const swap = useCallback(
    async (label: string, slot: MealSlot, dish: string) => {
      const today = todayISO();
      const log = getLog();
      // Contra qué se compara: la sugerencia original del plan si ya está
      // congelada en el registro, y si no el plato que hay ahora en el plan.
      const habitNow = log?.habits?.find((h) => h.label === label);
      const plannedDish =
        habitNow?.plannedIdea ||
        habitNow?.wasIdea ||
        mealsForDate(getPlan() ?? null, today).find((m) => m.slot === slot)?.idea ||
        "";
      // Las kcal contra las que se compara son las del plato del PLAN, y hay que
      // capturarlas en el primer cambio: cuando salte el lote la guía ya se
      // habrá regenerado con el plato nuevo.
      const prevKcal =
        habitNow?.plannedKcal ??
        log?.guide?.mealMacros?.find((m) => m.moment === label)?.kcal ??
        null;

      markSaving(label, true);
      let savedDish = dish;
      try {
        // `dish` en la respuesta es el texto de la persona con la ortografía
        // corregida por el servidor (`resolveDish`): es lo que de verdad ha
        // quedado escrito en el plan, así que es lo que hay que guardar aquí
        // también — si se guardara el texto crudo, `confirmedIdea` dejaría de
        // coincidir con el plato del plan y `reconcileHabits` lo trataría como
        // una confirmación caducada en la siguiente carga.
        const { dish: correctedDish, previousIdea } = await changeMeal({
          data: { date: today, slot, dish, today },
        });
        savedDish = correctedDish;
        await patchTodayHabits((habits) =>
          habits.map((h) =>
            h.label !== label
              ? h
              : {
                  ...h,
                  status: "distinto" as const,
                  done: true,
                  confirmedIdea: correctedDish,
                  // El tachado es la sugerencia ORIGINAL del plan, congelada.
                  plannedIdea: h.plannedIdea || h.wasIdea || previousIdea || plannedDish,
                  ...(prevKcal == null ? {} : { plannedKcal: h.plannedKcal ?? prevKcal }),
                  // El ajuste anterior de esta comida ya no describe la realidad.
                  adjustmentChanges: undefined,
                  adjustmentSummary: undefined,
                  adjustmentKcal: undefined,
                },
          ),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No hemos podido cambiar el plato");
        return;
      } finally {
        markSaving(label, false);
      }

      refresh();
      queueDishChange(today, { label, slot, dish: savedDish, plannedDish, prevKcal });
    },
    [changeMeal, getLog, getPlan, refresh],
  );

  /**
   * "Deshacer" de una comida de hoy: además de quitarle el estado, **devuelve el
   * plato del plan** si se había cambiado a mano. Es lo que hace que "Ver
   * receta" vuelva a aparecer: la receta se oculta porque el plato ya no es el
   * del plan (`suggestedDish`), así que restaurarlo la recupera sin ninguna
   * regla aparte.
   *
   * Si el cambio ya había movido días futuros (`swapCompensated`), se encola el
   * desvío contrario para deshacer también ese movimiento — igual que borrar un
   * picoteo ya compensado devuelve la energía. Si aún estaba en el lote sin
   * mandar, basta con sacarlo de la cola.
   *
   * Devuelve las comidas ya actualizadas, o `null` si no había nada que
   * restaurar (la pantalla limpia entonces el estado a secas).
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

        // El registro se relee de la base de datos, no de la caché: el servidor
        // escribe `swapCompensated` y la caché puede ir por detrás.
        const habit =
          (await fetchTodayLog().catch(() => null))?.habits?.find((h) => h.label === label) ??
          getLog()?.habits?.find((h) => h.label === label);
        const plannedDish = habit?.plannedIdea || habit?.wasIdea || "";
        // Nada que restaurar: el plato ya es el del plan (o nunca se cambió).
        if (!plannedDish || plannedDish === currentDish) return null;

        // Lo que el cambio movió en los días futuros y hay que devolver. Si
        // seguía en la cola, no se movió nada.
        const compensated = !queued && habit?.swapCompensated ? (habit.swapKcalDelta ?? 0) : 0;
        await changeMeal({ data: { date: today, slot, dish: plannedDish, today, pin: false } });
        const next = await patchTodayHabits((habits) =>
          habits.map((h) =>
            h.label !== label
              ? h
              : {
                  label: h.label,
                  done: false,
                  // `plannedIdea` se vuelve a congelar AQUÍ, con el plato que se
                  // acaba de restaurar, en vez de dejárselo a `reconcileHabits`
                  // en la siguiente carga: esa corre con el plan que tenga la
                  // caché en ese instante y, si todavía va por detrás, congelaba
                  // el plato cambiado — con lo que la comida seguía saliendo
                  // como "editada" (tachado y sin receta) tras deshacer.
                  plannedIdea: plannedDish,
                  ...(compensated ? { swapKcalDelta: -compensated, swapCompensated: false } : {}),
                },
          ),
        );
        if (compensated) {
          queueDishChange(today, {
            label,
            slot,
            dish: plannedDish,
            plannedDish,
            prevKcal: null,
            kcalDeltaOverride: -compensated,
          });
        }
        refresh();
        return next;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No hemos podido deshacer el cambio");
        return null;
      } finally {
        markSaving(label, false);
      }
    },
    [changeMeal, getLog, getPlan, refresh],
  );

  return {
    swap,
    revert,
    /** ¿Se está guardando el cambio de ESTA comida? Bloquea solo su fila. */
    isSaving: (label: string) => saving.has(label),
    /** ¿Esta comida espera al ajuste del plan? Pinta su spinner. */
    isAdjusting: (label: string) => state.dishes.has(label),
  };
}
