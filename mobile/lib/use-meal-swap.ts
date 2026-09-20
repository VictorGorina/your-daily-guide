import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Alert, AppState } from "react-native";

import { apiPost } from "./api";
import {
  fetchMonthlyPlan,
  fetchTodayLog,
  monthISO,
  patchTodayHabits,
  todayISO,
  updateTodayLog,
  type DailyGuide,
  type DailyLog,
} from "./daily";
import { mergeGuide, perMealKcalDeltas } from "./macros";
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
 * **Tras `BATCH_MS` sin tocar nada (un lote, dos llamadas):** se regenera la
 * guía del día una sola vez y se llama una sola vez a `plan/compensate`, con
 * el desvío por comida. El servidor decide EN CÓDIGO (núcleo de
 * compensación, ticket 08 de `hoy-semanas-editables`) si el desvío del día
 * completo (este lote + lo pendiente de lotes anteriores) pide recolocar —
 * ver `compensateDishChanges` en `src/lib/plan.functions.ts` de la web.
 */

/** Ventana de calma antes de mandar el lote. */
const BATCH_MS = 10_000;
const STORAGE_PREFIX = "meal-swap-batch:";

type PendingChange = {
  label: string;
  slot: MealSlot;
  dish: string;
  plannedDish: string;
  prevKcal: number | null;
  /**
   * Desvío en kcal ya decidido, en vez de deducirlo de las macros de antes y
   * de después. Lo usa "Deshacer": al volver al plato del plan hay que
   * DEVOLVER la energía que el cambio movió en los días futuros, y esa cifra
   * es la del cambio original con el signo cambiado. Mismo criterio que borrar
   * un picoteo ya compensado.
   */
  kcalDeltaOverride?: number;
};

type BatchDeps = {
  /** Comidas que esta persona planifica de verdad (`effectiveMealSlots`). */
  slots: readonly MealSlot[];
  onDone: () => void;
};

let pending = new Map<string, PendingChange>();
let pendingDate = "";
let deps: BatchDeps | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/**
 * El lote en vuelo, para poder esperarlo. "Deshacer" lo necesita: si pulsa
 * mientras el lote está compensando ESA comida, el `swapKcalDelta` que hay
 * guardado todavía no es el definitivo y se devolvería la energía equivocada.
 */
let runningPromise: Promise<void> | null = null;
const saving = new Set<string>();

let snapshot = { pending: new Set<string>(), saving: new Set<string>() };
const listeners = new Set<() => void>();

function publish() {
  snapshot = { pending: new Set(pending.keys()), saving: new Set(saving) };
  for (const cb of listeners) cb();
}

function persist() {
  const key = `${STORAGE_PREFIX}${pendingDate}`;
  if (!pending.size) void AsyncStorage.removeItem(key).catch(() => {});
  else void AsyncStorage.setItem(key, JSON.stringify([...pending.values()])).catch(() => {});
}

async function readPersisted(date: string): Promise<PendingChange[]> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}${date}`);
    const parsed = raw ? (JSON.parse(raw) as PendingChange[]) : null;
    return Array.isArray(parsed) ? parsed.filter((c) => c?.label && c?.slot && c?.dish) : [];
  } catch {
    return [];
  }
}

async function run(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending.size || !deps) return;
  if (running) {
    timer = setTimeout(startRun, BATCH_MS);
    return;
  }
  const changes = [...pending.values()];
  const { onDone, slots } = deps;
  const today = pendingDate;
  const month = today.slice(0, 7);
  running = true;
  pending = new Map();
  persist();
  publish();

  try {
    const planRow = await fetchMonthlyPlan(month);
    const planBefore = ((planRow?.plan as MonthlyPlan | null) ?? null) as MonthlyPlan | null;

    // Solo las comidas que esta persona planifica: con todas, el objetivo del
    // día (`macroEstimate`) salía inflado con una merienda que ni se muestra en
    // Hoy, y ese objetivo es contra el que se miden la barra de macros y el
    // semáforo del calendario.
    const meals = mealsForDate(planBefore, today, slots)
      .filter((m) => m.idea)
      .map((m) => ({ moment: m.moment, idea: m.idea }));
    const freshGuide = await apiPost<DailyGuide>("guide", { meals });
    const currentGuide = (await fetchTodayLog())?.guide ?? null;
    const guide: DailyGuide = {
      // Nunca perder cifras buenas si la regeneración vuelve sin ellas.
      ...mergeGuide(currentGuide, freshGuide),
      // Y el objetivo de la barra se fija con el plan original: no se mueve
      // porque la persona haya cambiado un plato.
      macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate ?? null,
    };
    await updateTodayLog({ guide });

    // El servidor decide si el desvío del DÍA (este lote + lo que quedara
    // pendiente de lotes anteriores) pide recolocar; escribe él mismo
    // `adjustmentChanges`/`adjustmentSummary`/`adjustmentKcal` sobre las
    // comidas que de verdad compensó — `onDone` invalida `["today"]` y la UI
    // los recoge de ahí.
    const deltas = [
      ...perMealKcalDeltas(
        changes.filter((c) => c.kcalDeltaOverride == null),
        freshGuide.mealMacros,
      ),
      ...changes
        .filter((c) => c.kcalDeltaOverride != null)
        .map((c) => ({ label: c.label, kcalDelta: c.kcalDeltaOverride! })),
    ];
    if (deltas.length) {
      const byLabel = new Map(changes.map((c) => [c.label, c]));
      await apiPost("plan/compensate", {
        today,
        changes: deltas.map(({ label, kcalDelta }) => {
          const c = byLabel.get(label)!;
          return { label, slot: c.slot, dish: c.dish, plannedDish: c.plannedDish, kcalDelta };
        }),
      });
    }
  } catch (err) {
    console.warn("meal swap batch failed", err);
    Alert.alert(
      "Plato cambiado",
      "El plato se ha cambiado, pero no se han podido ajustar los días futuros.",
    );
  } finally {
    running = false;
    publish();
    onDone();
  }
}

/** Lanza el lote guardando su promesa, para que "Deshacer" pueda esperarlo. */
function startRun(): void {
  runningPromise = run().finally(() => {
    runningPromise = null;
  });
}

export function flushMealSwapBatch(): void {
  if (pending.size) startRun();
}

let wired = false;
function wireFlushOnBackground() {
  if (wired) return;
  wired = true;
  AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") flushMealSwapBatch();
  });
}

export function useMealSwap(
  getLog: () => DailyLog | undefined,
  getPlan: () => MonthlyPlan | null | undefined,
  /** Comidas que esta persona planifica (`effectiveMealSlots` de su perfil). */
  slots: readonly MealSlot[],
) {
  const qc = useQueryClient();

  const state = useSyncExternalStore(
    useCallback((cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }, []),
    () => snapshot,
  );

  const bindDeps = useCallback(() => {
    deps = {
      slots,
      onDone: () => {
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
        qc.invalidateQueries({ queryKey: ["plan"] });
      },
    };
  }, [qc, slots]);

  const restoredRef = useRef(false);
  useEffect(() => {
    wireFlushOnBackground();
    if (restoredRef.current) return;
    restoredRef.current = true;
    const today = todayISO();
    void readPersisted(today).then((stored) => {
      if (!stored.length || pending.size || running) return;
      pendingDate = today;
      pending = new Map(stored.map((c) => [c.label, c]));
      bindDeps();
      publish();
      startRun();
    });
  }, [bindDeps]);

  const swap = useCallback(
    async (label: string, slot: MealSlot, dish: string) => {
      const today = todayISO();
      const log = getLog();
      const habitNow = log?.habits?.find((h) => h.label === label);
      const plannedDish =
        habitNow?.plannedIdea ||
        habitNow?.wasIdea ||
        mealsForDate(getPlan() ?? null, today).find((m) => m.slot === slot)?.idea ||
        "";
      const prevKcal =
        habitNow?.plannedKcal ??
        log?.guide?.mealMacros?.find((m) => m.moment === label)?.kcal ??
        null;

      saving.add(label);
      publish();
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
                  plannedIdea: h.plannedIdea || h.wasIdea || previousIdea || plannedDish,
                  ...(prevKcal == null ? {} : { plannedKcal: h.plannedKcal ?? prevKcal }),
                  adjustmentChanges: undefined,
                  adjustmentSummary: undefined,
                  adjustmentKcal: undefined,
                },
          ),
        );
      } catch (err) {
        Alert.alert(
          "No hemos podido cambiar el plato",
          err instanceof Error ? err.message : "Inténtalo otra vez",
        );
        return;
      } finally {
        saving.delete(label);
        publish();
      }

      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["logs"] });
      qc.invalidateQueries({ queryKey: ["plan"] });

      if (pendingDate !== today) {
        pendingDate = today;
        pending = new Map();
      }
      const before = pending.get(label);
      pending.set(label, {
        label,
        slot,
        dish: savedDish,
        plannedDish: before?.plannedDish || plannedDish,
        prevKcal: before ? before.prevKcal : prevKcal,
      });
      bindDeps();
      persist();
      publish();
      if (timer) clearTimeout(timer);
      timer = setTimeout(startRun, BATCH_MS);
    },
    [bindDeps, getLog, getPlan, qc],
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
      const queued = pending.get(label);
      if (queued) {
        pending.delete(label);
        persist();
        publish();
      }
      // La fila se marca ocupada YA: si el lote está en vuelo hay que esperarlo
      // (abajo) y son decenas de segundos en los que el botón parecería muerto.
      saving.add(label);
      publish();
      try {
        // Si el lote de ESTA comida está en vuelo, hay que esperarlo: el desvío
        // que escribe el servidor es justo la cifra que luego hay que devolver.
        if (!queued && runningPromise) await runningPromise.catch(() => {});

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
                  // Lo demás describía el cambio y ya no existe: el estado, la
                  // referencia de kcal y el resumen del ajuste.
                  ...(compensated ? { swapKcalDelta: -compensated, swapCompensated: false } : {}),
                },
          ),
        );
        if (compensated) {
          if (pendingDate !== today) {
            pendingDate = today;
            pending = new Map();
          }
          pending.set(label, {
            label,
            slot,
            dish: plannedDish,
            plannedDish,
            prevKcal: null,
            kcalDeltaOverride: -compensated,
          });
          bindDeps();
          persist();
          publish();
          if (timer) clearTimeout(timer);
          timer = setTimeout(startRun, BATCH_MS);
        }
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
        qc.invalidateQueries({ queryKey: ["plan"] });
        return next;
      } catch (err) {
        Alert.alert(err instanceof Error ? err.message : "No hemos podido deshacer el cambio");
        return null;
      } finally {
        saving.delete(label);
        publish();
      }
    },
    [bindDeps, getLog, getPlan, qc],
  );

  return {
    swap,
    revert,
    isSaving: (label: string) => state.saving.has(label),
    isAdjusting: (label: string) => state.pending.has(label),
  };
}
