import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { apiPost } from "./api";
import type { ExerciseOutcome } from "./exercise";
import type { MealChange } from "./plan-shared";

/**
 * Asentar el deporte de hoy: tras apuntar o quitar una actividad, se espera
 * `DEBOUNCE_MS` de calma y se llama UNA vez a `POST /api/v1/exercise/settle`.
 * Varias actividades seguidas son una sola llamada.
 *
 * El cliente no manda cifras: el servidor relee el deporte del día y decide
 * en código si hace falta reponer energía en días futuros. Por eso reintentar
 * es inocuo.
 *
 * Misma forma que `snack-settle.ts`: estado a nivel de módulo (sobrevive a
 * salir de Hoy), "pendiente" en AsyncStorage por si se cierra la app dentro
 * de la ventana, y envío forzado al pasar a segundo plano. Copia de
 * `src/lib/exercise-settle.ts` de la web.
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
    result = await apiPost<SettleExerciseResult>("exercise/settle", { today });
    // Solo se borra si no ha entrado otra actividad mientras tanto.
    if (!pendingDate) void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
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
function wireFlushOnBackground() {
  if (wired) return;
  wired = true;
  AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") flushExerciseSettle();
  });
}

/** Programa el asentamiento del deporte de `today` tras la ventana de calma. */
export function scheduleExerciseSettle(today: string): void {
  wireFlushOnBackground();
  pendingDate = today;
  void AsyncStorage.setItem(STORAGE_KEY, today).catch(() => {});
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), DEBOUNCE_MS);
  publish();
}

/** Manda ya lo pendiente. */
export function flushExerciseSettle(): void {
  if (pendingDate) void run();
}

/**
 * Red de seguridad al abrir Hoy: si la app se cerró con deporte por asentar,
 * se manda. Un pendiente de otro día se descarta: compensar desde ayer
 * tocaría hoy, que está cerrado.
 */
async function resumeExerciseSettle(today: string): Promise<void> {
  wireFlushOnBackground();
  if (pendingDate || running) return;
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!stored) return;
  if (stored !== today) {
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
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
    void resumeExerciseSettle(today);
  }, [today]);

  return state;
}
