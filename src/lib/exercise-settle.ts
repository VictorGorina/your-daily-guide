import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { ExerciseOutcome } from "@/lib/exercise";
import type { MealChange } from "@/lib/plan-shared";

/**
 * Asentar el deporte de hoy: tras apuntar o quitar una actividad, se espera
 * `DEBOUNCE_MS` de calma y se llama UNA vez a `POST /api/v1/exercise/settle`.
 * Varias actividades seguidas son una sola llamada.
 *
 * El cliente no manda cifras: el servidor relee el deporte del día y decide
 * en código si hace falta reponer energía en días futuros (`settleExercise`).
 * Por eso reintentar es inocuo.
 *
 * Misma forma que `snack-settle.ts` (y `plan-recalc.ts`): estado a nivel de
 * módulo (sobrevive a salir de Hoy), "pendiente" en `localStorage` por si se
 * cierra la pestaña dentro de la ventana, y envío forzado al ocultarla.
 */

export type SettleExerciseResult = {
  outcome: ExerciseOutcome | "nothing";
  kcal: number;
  changes?: MealChange[];
  summary?: string;
};

const DEBOUNCE_MS = 10_000;
const STORAGE_KEY = "exercise-settle:pending";

let timer: ReturnType<typeof setTimeout> | null = null;
/** Día con deporte por asentar, o null. */
let pendingDate: string | null = null;
let running = false;
/** El último intento falló (se reintentará al volver a Hoy o con la siguiente actividad). */
let failed = false;

type State = { pending: boolean; running: boolean; failed: boolean };
let snapshot: State = { pending: false, running: false, failed: false };
const stateListeners = new Set<() => void>();
const doneListeners = new Set<(result: SettleExerciseResult | null) => void>();

function publish() {
  snapshot = { pending: !!pendingDate, running, failed };
  for (const cb of stateListeners) cb();
}

const storage = {
  get(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set(value: string) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* modo incógnito / storage lleno: el debounce sigue en memoria */
    }
  },
  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
    }
  },
};

async function postSettle(today: string): Promise<SettleExerciseResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sin sesión");
  const res = await fetch("/api/v1/exercise/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ today }),
  });
  if (!res.ok) throw new Error(`exercise/settle ${res.status}`);
  return (await res.json()) as SettleExerciseResult;
}

async function run(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pendingDate) return;
  // Uno en vuelo: se reintenta después en vez de lanzar dos a la vez.
  if (running) {
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
    return;
  }
  const today = pendingDate;
  pendingDate = null;
  running = true;
  failed = false;
  publish();

  let result: SettleExerciseResult | null = null;
  try {
    result = await postSettle(today);
    // Solo se borra si no ha entrado otra actividad mientras tanto.
    if (!pendingDate) storage.clear();
  } catch (err) {
    // Se queda el "pendiente" guardado: el deporte ya está apuntado y lo que
    // falta (la compensación) se reintenta al volver a Hoy.
    failed = true;
    console.warn("exercise-settle: no se pudo ajustar el plan", err);
  } finally {
    running = false;
    publish();
    for (const cb of doneListeners) {
      try {
        cb(result);
      } catch {
        /* no-op */
      }
    }
  }
}

let wired = false;
function wireFlushOnHide() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushExerciseSettle();
  });
}

/** Programa el asentamiento del deporte de `today` tras la ventana de calma. */
export function scheduleExerciseSettle(today: string): void {
  wireFlushOnHide();
  pendingDate = today;
  storage.set(today);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), DEBOUNCE_MS);
  publish();
}

/** Manda ya lo pendiente. */
export function flushExerciseSettle(): void {
  if (pendingDate) void run();
}

/**
 * Red de seguridad al abrir Hoy: si se cerró la pestaña con deporte por
 * asentar, se manda. Un pendiente de otro día se descarta: compensar desde
 * ayer tocaría hoy, que está cerrado.
 */
function resumeExerciseSettle(today: string): void {
  wireFlushOnHide();
  if (pendingDate || running) return;
  const stored = storage.get();
  if (!stored) return;
  if (stored !== today) {
    storage.clear();
    return;
  }
  pendingDate = today;
  publish();
  void run();
}

/**
 * Estado del asentamiento para pintar el aviso de Hoy. `onDone` se llama al
 * terminar cada intento (con `null` si falló), para refrescar los datos.
 */
export function useExerciseSettle(
  today: string,
  onDone: (result: SettleExerciseResult | null) => void,
) {
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
    const cb = (result: SettleExerciseResult | null) => onDoneRef.current(result);
    doneListeners.add(cb);
    return () => {
      doneListeners.delete(cb);
    };
  }, []);

  useEffect(() => {
    resumeExerciseSettle(today);
  }, [today]);

  return state;
}
