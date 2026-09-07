import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  fetchMonthlyPlan,
  fetchTodayLog,
  monthISO,
  patchTodayHabits,
  todayISO,
  updateTodayLog,
  type DailyGuide,
  type DailyLog,
} from "@/lib/daily";
import { generateDailyGuide, type GeneratedGuide } from "@/lib/guide.functions";
import { kcalDeltaOf } from "@/lib/macros";
import { adjustMonthlyPlan, setPlanMeal } from "@/lib/plan.functions";
import {
  diffFutureMeals,
  mealsForDate,
  type MealChange,
  type MealSlot,
  type MonthlyPlan,
} from "@/lib/plan-shared";

export type { MealChange };

/**
 * Cambio de plato desde Hoy, en dos tiempos.
 *
 * **Al tocar el plato (sin IA, inmediato):** `setPlanMeal` escribe el plato tal
 * cual y se marca esa comida como "comí distinto". Nada bloquea la pantalla, y
 * se puede cambiar otra comida acto seguido.
 *
 * **Tras `BATCH_MS` sin tocar nada (un lote, dos llamadas):** se regenera la
 * guía del día una sola vez (macros nuevas) y se llama una sola vez a
 * `adjustMonthlyPlan` para recolocar los días futuros, con el desvío real en
 * kcal calculado a partir de las macros de antes y de después.
 *
 * Antes cada plato disparaba sus dos llamadas de IA en cadena y bloqueaba el
 * sheet entero mientras tanto (~10-25 s por plato), así que cambiar tres
 * comidas seguidas era imposible; además cada una reescribía el array `habits`
 * completo desde una copia vieja y se borraban entre sí el plato tachado.
 *
 * El estado del lote vive a nivel de módulo, no del componente, con la misma
 * forma que `plan-recalc.ts`: así el lote sobrevive a salir de Hoy, se persiste
 * por si se cierra la app dentro de la ventana, y se fuerza al ocultar la
 * pestaña.
 */

/** Ventana de calma antes de mandar el lote. */
const BATCH_MS = 10_000;
const STORAGE_PREFIX = "meal-swap-batch:";

type PendingChange = {
  /** Momento del día ("Cena"), que es como se identifica la comida en el registro. */
  label: string;
  slot: MealSlot;
  /** Lo que ha comido de verdad. */
  dish: string;
  /** Lo que el plan proponía para ese momento. */
  plannedDish: string;
  /** kcal que la guía estimaba para ese momento ANTES del cambio. */
  prevKcal: number | null;
};

/**
 * Lo que hace falta para mandar el lote. Se captura al programarlo, porque el
 * lote puede saltar con la pantalla de Hoy ya desmontada.
 */
type BatchDeps = {
  adjustPlan: (opts: {
    data: { month: string; note: string; today: string; kcalDelta: number | null };
  }) => Promise<{ plan: MonthlyPlan; summary: string }>;
  makeGuide: (opts: {
    data: { meals: { moment: string; idea: string }[] };
  }) => Promise<GeneratedGuide>;
  onDone: () => void;
};

let pending = new Map<string, PendingChange>();
let pendingDate = "";
let deps: BatchDeps | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** Comidas cuyo `setPlanMeal` está en vuelo (bloquean solo su propia fila). */
const saving = new Set<string>();

/** Instantánea estable para `useSyncExternalStore` (no puede devolver objetos nuevos). */
let snapshot = { pending: new Set<string>(), saving: new Set<string>() };
const listeners = new Set<() => void>();

function publish() {
  snapshot = { pending: new Set(pending.keys()), saving: new Set(saving) };
  for (const cb of listeners) cb();
}

function persist() {
  try {
    if (!pending.size) localStorage.removeItem(`${STORAGE_PREFIX}${pendingDate}`);
    else {
      localStorage.setItem(
        `${STORAGE_PREFIX}${pendingDate}`,
        JSON.stringify([...pending.values()]),
      );
    }
  } catch {
    /* modo incógnito / storage lleno: seguimos con el lote en memoria */
  }
}

function readPersisted(date: string): PendingChange[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${date}`);
    const parsed = raw ? (JSON.parse(raw) as PendingChange[]) : null;
    return Array.isArray(parsed) ? parsed.filter((c) => c?.label && c?.slot && c?.dish) : [];
  } catch {
    return [];
  }
}

/** "Cena: has comido X en vez de Y" para cada comida del lote. */
function noteFor(changes: PendingChange[]) {
  const lines = changes.map(
    (c) => `${c.label}: ha comido "${c.dish}" en vez de "${c.plannedDish || "(plato del plan)"}"`,
  );
  return `Cambios de hoy — ${lines.join("; ")}. Recoloca los días futuros para compensar.`;
}

/**
 * Manda el lote: una llamada para las macros, otra para recolocar el plan.
 * Nunca lanza — un fallo de IA no debe dejar la pantalla rota, y el plato ya
 * está guardado de todas formas.
 */
async function run(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending.size || !deps) return;
  // Si el lote anterior sigue en vuelo, se reintenta en vez de descartarse:
  // dejarlo caer aquí dejaría un cambio sin compensar hasta el siguiente.
  if (running) {
    timer = setTimeout(() => void run(), BATCH_MS);
    return;
  }
  const changes = [...pending.values()];
  const { adjustPlan, makeGuide, onDone } = deps;
  const today = pendingDate;
  const month = today.slice(0, 7);
  running = true;
  pending = new Map();
  persist();
  publish();

  try {
    // El plan se relee de la base de datos en vez de fiarlo a la caché de la
    // pantalla: el lote puede saltar con Hoy ya desmontado.
    const planRow = await fetchMonthlyPlan(month);
    const planBefore: MonthlyPlan | null = planRow?.plan ?? null;

    // --- Macros: UNA regeneración con todas las comidas de hoy ya cambiadas ---
    const meals = mealsForDate(planBefore, today)
      .filter((m) => m.idea)
      .map((m) => ({ moment: m.moment, idea: m.idea }));
    const freshGuide = await makeGuide({ data: { meals } });
    const currentGuide = (await fetchTodayLog())?.guide ?? null;
    // El objetivo de la barra (`macroEstimate`) se fija con el plan original y
    // no se mueve: un cambio de plato tiene que poder quedar por encima o por
    // debajo, no desplazar el listón. `mealMacros` sí se actualiza entero.
    const guide: DailyGuide = {
      ...freshGuide,
      macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate,
    };
    await updateTodayLog({ guide });

    const kcalDelta = kcalDeltaOf(changes, freshGuide.mealMacros);

    // --- Recolocación de días futuros: UNA llamada para todo el lote ---
    const { plan: planAfter, summary } = await adjustPlan({
      data: { month, note: noteFor(changes), today, kcalDelta },
    });

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
    console.error("meal swap batch failed", err);
    toast.error("El plato se ha cambiado, pero no se han podido ajustar los días futuros.");
  } finally {
    running = false;
    publish();
    onDone();
  }
}

/** Fuerza el lote pendiente sin esperar a la ventana de calma. */
export function flushMealSwapBatch(): void {
  if (pending.size) void run();
}

let wired = false;
function wireFlushOnHide() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushMealSwapBatch();
  });
}

export function useMealSwap(
  getLog: () => DailyLog | undefined,
  getPlan: () => MonthlyPlan | null | undefined,
) {
  const qc = useQueryClient();
  const changeMeal = useServerFn(setPlanMeal);
  const adjustPlan = useServerFn(adjustMonthlyPlan);
  const makeGuide = useServerFn(generateDailyGuide);

  const state = useSyncExternalStore(
    useCallback((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }, []),
    () => snapshot,
    () => snapshot,
  );

  const bindDeps = useCallback(() => {
    deps = {
      adjustPlan,
      makeGuide,
      onDone: () => {
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
        qc.invalidateQueries({ queryKey: ["plan"] });
      },
    };
  }, [adjustPlan, makeGuide, qc]);

  // Red de seguridad: si la app se cerró dentro de la ventana de calma, el lote
  // guardado se manda al volver a Hoy. El plato ya estaba guardado; lo que se
  // recupera aquí es la compensación de los días futuros.
  const restoredRef = useRef(false);
  useEffect(() => {
    wireFlushOnHide();
    if (restoredRef.current) return;
    restoredRef.current = true;
    const today = todayISO();
    const stored = readPersisted(today);
    if (!stored.length || pending.size || running) return;
    pendingDate = today;
    pending = new Map(stored.map((c) => [c.label, c]));
    bindDeps();
    publish();
    void run();
  }, [bindDeps]);

  const swap = useCallback(
    async (label: string, slot: MealSlot, dish: string) => {
      const today = todayISO();
      const log = getLog();
      // Lo que le contamos a la IA es contra qué se compara: la sugerencia
      // original del plan si ya está congelada en el registro, y si no el
      // plato que hay ahora mismo en el plan.
      const habitNow = log?.habits?.find((h) => h.label === label);
      const plannedDish =
        habitNow?.plannedIdea ||
        habitNow?.wasIdea ||
        mealsForDate(getPlan() ?? null, today).find((m) => m.slot === slot)?.idea ||
        "";
      // Las kcal contra las que se compara son las del plato del PLAN, y hay
      // que capturarlas en el primer cambio: cuando salte el lote la guía ya se
      // habrá regenerado con el plato nuevo. En cambios posteriores se reusa la
      // congelada, para que el desvío siga midiéndose contra el plan.
      const prevKcal =
        habitNow?.plannedKcal ??
        log?.guide?.mealMacros?.find((m) => m.moment === label)?.kcal ??
        null;

      saving.add(label);
      publish();
      try {
        const { previousIdea } = await changeMeal({ data: { date: today, slot, dish, today } });
        await patchTodayHabits((habits) =>
          habits.map((h) =>
            h.label !== label
              ? h
              : {
                  ...h,
                  status: "distinto" as const,
                  done: true,
                  // El tachado es la sugerencia ORIGINAL del plan, congelada.
                  // `reconcileHabits` ya la habrá puesto al cargar Hoy; esto es
                  // el cinturón para un registro que venga de antes.
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
      // `plannedDish` se conserva del primer cambio del día: si se cambia la
      // misma comida dos veces, lo que se compara sigue siendo el plan.
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
    [bindDeps, changeMeal, getLog, getPlan, qc],
  );

  return {
    swap,
    /** ¿Se está guardando el cambio de ESTA comida? Bloquea solo su fila. */
    isSaving: (label: string) => state.saving.has(label),
    /** ¿Esta comida espera al ajuste del plan? Pinta su spinner. */
    isAdjusting: (label: string) => state.pending.has(label),
  };
}
