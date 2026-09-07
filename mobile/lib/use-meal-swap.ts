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
import { kcalDeltaOf } from "./macros";
import {
  diffFutureMeals,
  mealsForDate,
  type MealChange,
  type MealSlot,
  type MonthlyPlan,
} from "./plan-shared";

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
 * guía del día una sola vez y se llama una sola vez a `plan/adjust` con el
 * desvío real en kcal.
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
};

type BatchDeps = { onDone: () => void };

let pending = new Map<string, PendingChange>();
let pendingDate = "";
let deps: BatchDeps | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
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

function noteFor(changes: PendingChange[]) {
  const lines = changes.map(
    (c) => `${c.label}: ha comido "${c.dish}" en vez de "${c.plannedDish || "(plato del plan)"}"`,
  );
  return `Cambios de hoy — ${lines.join("; ")}. Recoloca los días futuros para compensar.`;
}

async function run(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending.size || !deps) return;
  if (running) {
    timer = setTimeout(() => void run(), BATCH_MS);
    return;
  }
  const changes = [...pending.values()];
  const { onDone } = deps;
  const today = pendingDate;
  const month = today.slice(0, 7);
  running = true;
  pending = new Map();
  persist();
  publish();

  try {
    const planRow = await fetchMonthlyPlan(month);
    const planBefore = ((planRow?.plan as MonthlyPlan | null) ?? null) as MonthlyPlan | null;

    const meals = mealsForDate(planBefore, today)
      .filter((m) => m.idea)
      .map((m) => ({ moment: m.moment, idea: m.idea }));
    const freshGuide = await apiPost<DailyGuide>("guide", { meals });
    const currentGuide = (await fetchTodayLog())?.guide ?? null;
    const guide: DailyGuide = {
      ...freshGuide,
      macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate,
    };
    await updateTodayLog({ guide });

    const kcalDelta = kcalDeltaOf(changes, freshGuide.mealMacros);

    const { plan: planAfter, summary } = await apiPost<{ plan: MonthlyPlan; summary: string }>(
      "plan/adjust",
      { month, note: noteFor(changes), today, kcalDelta },
    );

    const futureChanges = diffFutureMeals(planBefore, planAfter, today);
    await patchTodayHabits((habits) =>
      habits.map((h) =>
        changes.some((c) => c.label === h.label)
          ? {
              ...h,
              adjustmentChanges: futureChanges,
              adjustmentSummary: summary,
              ...(kcalDelta == null ? {} : { adjustmentKcal: kcalDelta }),
            }
          : h,
      ),
    );
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

export function flushMealSwapBatch(): void {
  if (pending.size) void run();
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
      onDone: () => {
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
        qc.invalidateQueries({ queryKey: ["plan"] });
      },
    };
  }, [qc]);

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
      void run();
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
      try {
        const { previousIdea } = await apiPost<{ previousIdea: string }>("plan/meal", {
          date: today,
          slot,
          dish,
          today,
        });
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
        dish,
        plannedDish: before?.plannedDish || plannedDish,
        prevKcal: before ? before.prevKcal : prevKcal,
      });
      bindDeps();
      persist();
      publish();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), BATCH_MS);
    },
    [bindDeps, getLog, getPlan, qc],
  );

  return {
    swap,
    isSaving: (label: string) => state.saving.has(label),
    isAdjusting: (label: string) => state.pending.has(label),
  };
}
