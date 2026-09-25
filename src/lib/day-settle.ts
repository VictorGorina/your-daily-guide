import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { SettleDayResult } from "@/lib/day-settle.functions";
import type { MealSlot } from "@/lib/plan-shared";

/**
 * Un solo asentamiento por ráfaga de actividad (feature `balance-del-dia`).
 *
 * Antes había TRES de estos módulos, idénticos salvo por la columna que
 * miraban: `snack-settle.ts`, `exercise-settle.ts` y el lote interno de
 * `use-meal-swap.ts`. Tres timers de 10 s, tres claves de `localStorage`, tres
 * `visibilitychange` y tres llamadas a la IA que se peleaban por los mismos
 * días futuros (ver `day-balance.ts`). Aquí hay uno.
 *
 * Cualquier cosa que desvíe el día —cambiar un plato, picotear, hacer deporte—
 * reinicia la misma ventana de calma y acaba en UNA llamada a `settleDay`, que
 * suma el día entero y decide una vez.
 *
 * La ventana es corta (10 s) a propósito, no un cierre nocturno: la persona
 * tiene que VER el efecto de lo que acaba de hacer mientras sigue en la app.
 * Que haya varias pasadas en un día no rompe nada porque `mergeDayAdjustment`
 * las acumula: a las 22:00 la tarjeta enseña el día entero movido.
 *
 * Mismo esqueleto que `plan-recalc.ts`: estado a nivel de módulo (sobrevive a
 * salir de Hoy), "pendiente" en `localStorage` por si se cierra la pestaña
 * dentro de la ventana, y envío forzado al ocultarla. Copia en
 * `mobile/lib/day-settle.ts`.
 */

/** Ventana de calma antes de mandar el lote. */
const DEBOUNCE_MS = 10_000;
/**
 * Espera antes de reintentar un lote que falló. Más larga que la ventana de
 * calma: si falla es por la red o por la IA, y machacar no ayuda. Sin este
 * reintento, un fallo dejaba el desvío pendiente hasta que la persona volviera
 * a tocar algo — y la tarjeta, con el "Ajustando…" puesto para siempre.
 */
const RETRY_MS = 60_000;
const STORAGE_PREFIX = "day-settle:";

/** Un plato cambiado en Hoy, a la espera de que se calcule su desvío. */
export type PendingDish = {
  /** Momento del día ("Cena"), que es como se identifica la comida en el registro. */
  label: string;
  slot: MealSlot;
  /** Lo que ha comido de verdad. */
  dish: string;
  /** Lo que el plan proponía para ese momento. */
  plannedDish: string;
  /** kcal que la guía estimaba para ese momento ANTES del cambio. */
  prevKcal: number | null;
  /** Proteína (g) del plato del plan, igual que `prevKcal` (ticket 13). */
  prevProtein?: number | null;
  /**
   * Desvío ya decidido, en vez de deducirlo de las macros de antes y de
   * después. Lo usa "Deshacer": al volver al plato del plan hay que DEVOLVER la
   * energía que el cambio movió en los días futuros, y esa cifra es la del
   * cambio original con el signo cambiado, no una resta de macros (que daría
   * cero y dejaría el plan movido para siempre).
   */
  kcalDeltaOverride?: number;
  /** Lo mismo para la proteína que el cambio original movió (g, con signo). */
  proteinDeltaOverride?: number | null;
};

/** Lo que se le manda al servidor por cada plato cambiado. */
export type DishDelta = {
  label: string;
  slot: MealSlot;
  dish: string;
  plannedDish: string;
  kcalDelta: number;
  /** `null` si no se sabe (cifra manual). */
  proteinDelta: number | null;
};

/**
 * Resultado de convertir la cola en desvíos. Un plato cuya cifra aún está
 * "calculando" (D13) no se puede medir: vuelve a la cola (`unresolved`) y se
 * asienta cuando la tenga, en vez de perderse o medirse contra un cero.
 */
export type ResolvedDishes = { deltas: DishDelta[]; unresolved: PendingDish[] };

export type DaySettleDeps = {
  /**
   * Convierte los platos encolados en su desvío en kcal. Regenera las macros
   * del día una sola vez, así que vive en `use-meal-swap.ts` (que es quien sabe
   * de guías y de planes) y no aquí: este módulo solo sabe de cuándo disparar.
   * Solo se llama si de verdad hay platos encolados.
   */
  resolveDishDeltas: (dishes: PendingDish[]) => Promise<ResolvedDishes>;
  settle: (opts: { data: { today: string; changes: DishDelta[] } }) => Promise<SettleDayResult>;
  onDone: (result: SettleDayResult | null) => void;
};

let pendingDate = "";
/** Platos cambiados a la espera, por momento del día. */
let pendingDishes = new Map<string, PendingDish>();
/** Hay algo que asentar aunque no haya platos (picoteo, deporte). */
let pendingPlain = false;
let deps: DaySettleDeps | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let failed = false;
/**
 * El lote en vuelo, para poder esperarlo. "Deshacer" lo necesita: si pulsa
 * mientras el lote está compensando ESA comida, el `swapKcalDelta` guardado
 * todavía no es el definitivo y se devolvería la energía equivocada.
 */
let runningPromise: Promise<void> | null = null;

type State = {
  /** Comidas encoladas, para pintar su spinner. */
  dishes: Set<string>;
  pending: boolean;
  running: boolean;
  failed: boolean;
};
let snapshot: State = { dishes: new Set(), pending: false, running: false, failed: false };
const stateListeners = new Set<() => void>();
const doneListeners = new Set<(result: SettleDayResult | null) => void>();

function publish() {
  snapshot = {
    dishes: new Set(pendingDishes.keys()),
    pending: pendingDishes.size > 0 || pendingPlain,
    running,
    failed,
  };
  for (const cb of stateListeners) cb();
}

type Persisted = { dishes: PendingDish[]; plain: boolean };

function persist() {
  const key = `${STORAGE_PREFIX}${pendingDate}`;
  try {
    if (!pendingDishes.size && !pendingPlain) localStorage.removeItem(key);
    else {
      const value: Persisted = { dishes: [...pendingDishes.values()], plain: pendingPlain };
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* modo incógnito / storage lleno: el debounce sigue en memoria */
  }
}

function readPersisted(date: string): Persisted | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${date}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const dishes = (Array.isArray(parsed?.dishes) ? parsed.dishes : []).filter(
      (c): c is PendingDish => !!c?.label && !!c?.slot && !!c?.dish,
    );
    return { dishes, plain: !!parsed?.plain };
  } catch {
    return null;
  }
}

/**
 * Manda el lote. Nunca lanza: un fallo de IA no debe dejar la pantalla rota, y
 * lo que la persona hizo (el plato, el picoteo, el deporte) ya está guardado.
 * El "pendiente" se conserva para reintentar al volver a Hoy.
 */
async function run(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pendingDishes.size && !pendingPlain) return;
  // Todavía sin `deps`: la recuperación al abrir Hoy puede correr antes de que
  // `use-meal-swap` los registre. Se reintenta en vez de quedarse parado.
  if (!deps) {
    timer = setTimeout(startRun, 1_000);
    return;
  }
  // Uno en vuelo: se reintenta después en vez de descartar este, que dejaría un
  // desvío sin compensar hasta el siguiente.
  if (running) {
    timer = setTimeout(startRun, DEBOUNCE_MS);
    return;
  }

  const today = pendingDate;
  const dishes = [...pendingDishes.values()];
  const pendingPlainBefore = pendingPlain;
  const { resolveDishDeltas, settle, onDone } = deps;
  running = true;
  failed = false;
  pendingDishes = new Map();
  pendingPlain = false;
  persist();
  publish();

  let result: SettleDayResult | null = null;
  try {
    const { deltas: changes, unresolved } = dishes.length
      ? await resolveDishDeltas(dishes)
      : { deltas: [], unresolved: [] };
    // Lo que aún no tiene cifra vuelve a la cola y se reintenta más tarde; lo
    // demás se asienta ya. Un cambio nuevo de la misma comida manda.
    if (unresolved.length) {
      for (const d of unresolved) if (!pendingDishes.has(d.label)) pendingDishes.set(d.label, d);
      persist();
      if (timer) clearTimeout(timer);
      timer = setTimeout(startRun, RETRY_MS);
    }
    if (changes.length || !unresolved.length || pendingPlainBefore)
      result = await settle({ data: { today, changes } });
  } catch (err) {
    // Lo que no se pudo mandar vuelve a la cola. Los platos también: su desvío
    // lo escribe el servidor al asentar, así que si la llamada falló ese apunte
    // no existe en ninguna parte y perderlo aquí dejaría el cambio sin
    // compensar para siempre. Un cambio nuevo de la misma comida, entrado
    // mientras esto volaba, manda sobre el viejo.
    failed = true;
    for (const d of dishes) if (!pendingDishes.has(d.label)) pendingDishes.set(d.label, d);
    pendingPlain = true;
    persist();
    if (timer) clearTimeout(timer);
    timer = setTimeout(startRun, RETRY_MS);
    console.warn("day-settle: no se pudo ajustar el plan", err);
  } finally {
    running = false;
    publish();
    onDone(result);
    for (const cb of doneListeners) {
      try {
        cb(result);
      } catch {
        /* no-op */
      }
    }
  }
}

function startRun(): void {
  runningPromise = run().finally(() => {
    runningPromise = null;
  });
}

let wired = false;
function wireFlushOnHide() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDaySettle();
  });
}

function arm(today: string) {
  wireFlushOnHide();
  if (pendingDate !== today) {
    pendingDate = today;
    pendingDishes = new Map();
    pendingPlain = false;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(startRun, DEBOUNCE_MS);
}

/** Algo ha desviado el día sin cambiar un plato (picoteo, deporte). */
export function scheduleDaySettle(today: string): void {
  arm(today);
  pendingPlain = true;
  persist();
  publish();
}

/** Un plato cambiado en Hoy entra en el lote del día. */
export function queueDishChange(today: string, change: PendingDish): void {
  const before = pendingDishes.get(change.label);
  arm(today);
  pendingDishes.set(change.label, {
    ...change,
    // `plannedDish` y `prevKcal` se conservan del primer cambio del día: si se
    // cambia la misma comida dos veces, lo que se compara sigue siendo el plan.
    plannedDish: before?.plannedDish || change.plannedDish,
    prevKcal: before ? before.prevKcal : change.prevKcal,
  });
  persist();
  publish();
}

/** Saca un plato del lote (se ha deshecho antes de mandarlo). */
export function unqueueDishChange(label: string): boolean {
  if (!pendingDishes.has(label)) return false;
  pendingDishes.delete(label);
  persist();
  publish();
  return true;
}

/** Manda ya lo pendiente, sin esperar a la ventana de calma. */
export function flushDaySettle(): void {
  if (pendingDishes.size || pendingPlain) startRun();
}

/** El lote en vuelo, para que "Deshacer" pueda esperarlo. */
export function daySettleInFlight(): Promise<void> | null {
  return runningPromise;
}

export function bindDaySettleDeps(next: DaySettleDeps): void {
  deps = next;
}

/**
 * Red de seguridad al abrir Hoy: si se cerró la app con algo por asentar, se
 * manda. Un pendiente de otro día se descarta — compensar desde ayer tocaría
 * hoy, que ya está cerrado.
 */
function resume(today: string): void {
  wireFlushOnHide();
  if (pendingDishes.size || pendingPlain || running) return;
  const stored = readPersisted(today);
  // Un pendiente de otro día se tira: compensar desde ayer tocaría hoy, que ya
  // está cerrado.
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_PREFIX) && key !== `${STORAGE_PREFIX}${today}`) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* modo incógnito: no hay nada que limpiar */
  }
  if (!stored || (!stored.dishes.length && !stored.plain)) return;
  pendingDate = today;
  pendingDishes = new Map(stored.dishes.map((c) => [c.label, c]));
  pendingPlain = stored.plain;
  publish();
  startRun();
}

/**
 * Estado del asentamiento para pintar la tarjeta de Hoy. `onDone` se llama al
 * terminar cada intento (con `null` si falló), para refrescar los datos.
 */
export function useDaySettle(today: string, onDone: (result: SettleDayResult | null) => void) {
  const state = useSyncExternalStore(
    useCallback((cb: () => void) => {
      stateListeners.add(cb);
      return () => {
        stateListeners.delete(cb);
      };
    }, []),
    () => snapshot,
    () => snapshot,
  );

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    const cb = (result: SettleDayResult | null) => onDoneRef.current(result);
    doneListeners.add(cb);
    return () => {
      doneListeners.delete(cb);
    };
  }, []);

  const resumedRef = useRef("");
  useEffect(() => {
    if (resumedRef.current === today) return;
    resumedRef.current = today;
    resume(today);
  }, [today]);

  return state;
}
