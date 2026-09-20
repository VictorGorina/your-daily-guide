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
import { mergeGuide, perMealKcalDeltas } from "@/lib/macros";
import { compensateDishChanges, setPlanMeal } from "@/lib/plan.functions";
import { mealsForDate, type MealChange, type MealSlot, type MonthlyPlan } from "@/lib/plan-shared";

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
 * `compensateDishChanges`, con el desvío por comida calculado a partir de las
 * macros de antes y de después. Esa función decide EN CÓDIGO (núcleo de
 * compensación, ticket 08 de `hoy-semanas-editables`) si hace falta recolocar
 * días futuros — el modelo ya no decide "suave" o "fuerte" leyendo el prompt.
 * El desvío se guarda por comida en `habits` y se acumula entre lotes
 * distintos del mismo día: dos cambios pequeños que por separado no llegarían
 * al umbral sí lo cruzan sumados.
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
  /**
   * Desvío en kcal ya decidido, en vez de deducirlo de las macros de antes y
   * de después. Lo usa "Deshacer": al volver al plato del plan hay que
   * DEVOLVER la energía que el cambio movió en los días futuros, y esa cifra
   * es la del cambio original con el signo cambiado, no una resta de macros
   * (que daría cero y dejaría el plan movido para siempre). Mismo criterio que
   * borrar un picoteo ya compensado.
   */
  kcalDeltaOverride?: number;
};

/**
 * Lo que hace falta para mandar el lote. Se captura al programarlo, porque el
 * lote puede saltar con la pantalla de Hoy ya desmontada.
 */
type BatchDeps = {
  /** Comidas que esta persona planifica de verdad (`effectiveMealSlots`). */
  slots: readonly MealSlot[];
  compensate: (opts: {
    data: {
      today: string;
      changes: {
        label: string;
        slot: MealSlot;
        dish: string;
        plannedDish: string;
        kcalDelta: number;
      }[];
    };
  }) => Promise<{ adjusted: boolean; reason?: string; summary?: string }>;
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
/**
 * El lote en vuelo, para poder esperarlo. "Deshacer" lo necesita: si pulsa
 * mientras el lote está compensando ESA comida, el `swapKcalDelta` que hay
 * guardado todavía no es el definitivo y se devolvería la energía equivocada.
 */
let runningPromise: Promise<void> | null = null;
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

/**
 * Manda el lote: una llamada para las macros, otra para que el servidor
 * decida (en código, no el modelo) si el día acumula desvío suficiente para
 * recolocar el plan. Nunca lanza — un fallo de IA no debe dejar la pantalla
 * rota, y el plato ya está guardado de todas formas.
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
    timer = setTimeout(startRun, BATCH_MS);
    return;
  }
  const changes = [...pending.values()];
  const { compensate, makeGuide, onDone, slots } = deps;
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
    // Solo las comidas que esta persona planifica: con todas, el objetivo del
    // día (`macroEstimate`) salía inflado con una merienda que ni se muestra en
    // Hoy, y ese objetivo es contra el que se miden la barra de macros y el
    // semáforo del calendario.
    const meals = mealsForDate(planBefore, today, slots)
      .filter((m) => m.idea)
      .map((m) => ({ moment: m.moment, idea: m.idea }));
    const freshGuide = await makeGuide({ data: { meals } });
    const currentGuide = (await fetchTodayLog())?.guide ?? null;
    const guide: DailyGuide = {
      // Nunca perder cifras buenas si la regeneración vuelve sin ellas.
      ...mergeGuide(currentGuide, freshGuide),
      // Y el objetivo de la barra se fija con el plan original: no se mueve
      // porque la persona haya cambiado un plato.
      macroEstimate: currentGuide?.macroEstimate ?? freshGuide.macroEstimate ?? null,
    };
    await updateTodayLog({ guide });

    // --- Compensación: el servidor decide si el desvío del DÍA (este lote +
    // lo que quedara pendiente de lotes anteriores) pide recolocar ---
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
      await compensate({
        data: {
          today,
          changes: deltas.map(({ label, kcalDelta }) => {
            const c = byLabel.get(label)!;
            return { label, slot: c.slot, dish: c.dish, plannedDish: c.plannedDish, kcalDelta };
          }),
        },
      });
    }
    // Los campos `adjustmentChanges`/`adjustmentSummary`/`adjustmentKcal` los
    // escribe el propio servidor sobre las comidas que de verdad compensó
    // (pueden ser más que las de este lote, si arrastraba un pendiente de
    // antes) — `onDone` invalida `["today"]` y la UI los recoge de ahí.
  } catch (err) {
    console.error("meal swap batch failed", err);
    toast.error("El plato se ha cambiado, pero no se han podido ajustar los días futuros.");
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

/** Fuerza el lote pendiente sin esperar a la ventana de calma. */
export function flushMealSwapBatch(): void {
  if (pending.size) startRun();
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
  /** Comidas que esta persona planifica (`effectiveMealSlots` de su perfil). */
  slots: readonly MealSlot[],
) {
  const qc = useQueryClient();
  const changeMeal = useServerFn(setPlanMeal);
  const compensate = useServerFn(compensateDishChanges);
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
      slots,
      compensate,
      makeGuide,
      onDone: () => {
        qc.invalidateQueries({ queryKey: ["today"] });
        qc.invalidateQueries({ queryKey: ["logs"] });
        qc.invalidateQueries({ queryKey: ["plan"] });
      },
    };
  }, [compensate, makeGuide, qc, slots]);

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
    startRun();
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
                  // Contra qué plato del plan se confirmó — ver `confirmedIdea`
                  // en plan-shared.ts. Aquí siempre es el plato nuevo, porque
                  // `changeMeal` ya lo ha escrito en el plan.
                  confirmedIdea: correctedDish,
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
    [bindDeps, changeMeal, getLog, getPlan, qc],
  );

  /**
   * "Deshacer" de una comida de hoy: además de quitarle el estado ("comí
   * esto" / "comí otra cosa"), **devuelve el plato del plan** si se había
   * cambiado a mano. Es lo que hace que "Ver receta" vuelva a aparecer: la
   * receta se oculta porque el plato ya no es el del plan (`suggestedDish`),
   * así que restaurarlo la recupera sin ninguna regla aparte.
   *
   * Si el cambio ya había movido días futuros (`swapCompensated`), se encola
   * el desvío contrario para deshacer también ese movimiento — igual que
   * borrar un picoteo ya compensado devuelve la energía. Si aún estaba en el
   * lote sin mandar, basta con sacarlo de la cola.
   *
   * Devuelve las comidas ya actualizadas, o `null` si no había nada que
   * restaurar (la pantalla se encarga entonces de limpiar el estado a secas).
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
        await changeMeal({ data: { date: today, slot, dish: plannedDish, today, pin: false } });
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
        toast.error(err instanceof Error ? err.message : "No hemos podido deshacer el cambio");
        return null;
      } finally {
        saving.delete(label);
        publish();
      }
    },
    [bindDeps, changeMeal, getLog, getPlan, qc],
  );

  return {
    swap,
    revert,
    /** ¿Se está guardando el cambio de ESTA comida? Bloquea solo su fila. */
    isSaving: (label: string) => state.saving.has(label),
    /** ¿Esta comida espera al ajuste del plan? Pinta su spinner. */
    isAdjusting: (label: string) => state.pending.has(label),
  };
}
