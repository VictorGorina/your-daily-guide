import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { MealChange } from "@/lib/plan-shared";
import type { SnackOutcome } from "@/lib/snacks";

/**
 * Asentar el picoteo de hoy (feature `picoteo-hoy`): tras apuntar o quitar un
 * picoteo, se espera `DEBOUNCE_MS` de calma y se llama UNA vez a
 * `POST /api/v1/snacks/settle`. Tres picoteos seguidos son una sola llamada.
 *
 * El cliente no manda cifras: el servidor relee el picoteo del día y decide en
 * código si hace falta recolocar días futuros (`settleSnacks`). Por eso
 * reintentar es inocuo.
 *
 * Misma forma que `plan-recalc.ts`: estado a nivel de módulo (sobrevive a salir
 * de Hoy), "pendiente" en `localStorage` por si se cierra la pestaña dentro de
 * la ventana, y envío forzado al ocultarla. Copia en `mobile/lib/snack-settle.ts`.
 */

export type SettleSnacksResult = {
  outcome: SnackOutcome | "nothing";
  kcal: number;
  changes?: MealChange[];
  summary?: string;
};

const DEBOUNCE_MS = 10_000;
const STORAGE_KEY = "snack-settle:pending";

let timer: ReturnType<typeof setTimeout> | null = null;
/** Día con picoteo por asentar, o null. */
let pendingDate: string | null = null;
let running = false;
/** El último intento falló (se reintentará al volver a Hoy o con el siguiente picoteo). */
let failed = false;

type State = { pending: boolean; running: boolean; failed: boolean };
let snapshot: State = { pending: false, running: false, failed: false };
const stateListeners = new Set<() => void>();
const doneListeners = new Set<(result: SettleSnacksResult | null) => void>();

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

async function postSettle(today: string): Promise<SettleSnacksResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sin sesión");
  const res = await fetch("/api/v1/snacks/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ today }),
  });
  if (!res.ok) throw new Error(`snacks/settle ${res.status}`);
  return (await res.json()) as SettleSnacksResult;
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

  let result: SettleSnacksResult | null = null;
  try {
    result = await postSettle(today);
    // Solo se borra si no ha entrado otro picoteo mientras tanto.
    if (!pendingDate) storage.clear();
  } catch (err) {
    // Se queda el "pendiente" guardado: el picoteo ya está apuntado y lo que
    // falta (la compensación) se reintenta al volver a Hoy.
    failed = true;
    console.warn("snack-settle: no se pudo ajustar el plan", err);
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
    if (document.visibilityState === "hidden") flushSnackSettle();
  });
}

/** Programa el asentamiento del picoteo de `today` tras la ventana de calma. */
export function scheduleSnackSettle(today: string): void {
  wireFlushOnHide();
  pendingDate = today;
  storage.set(today);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), DEBOUNCE_MS);
  publish();
}

/** Manda ya lo pendiente. */
export function flushSnackSettle(): void {
  if (pendingDate) void run();
}

/**
 * Red de seguridad al abrir Hoy: si se cerró la pestaña con un picoteo por
 * asentar, se manda. Un pendiente de otro día se descarta: compensar desde
 * ayer tocaría hoy, que está cerrado.
 */
function resumeSnackSettle(today: string): void {
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
export function useSnackSettle(today: string, onDone: (result: SettleSnacksResult | null) => void) {
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
    const cb = (result: SettleSnacksResult | null) => onDoneRef.current(result);
    doneListeners.add(cb);
    return () => {
      doneListeners.delete(cb);
    };
  }, []);

  useEffect(() => {
    resumeSnackSettle(today);
  }, [today]);

  return state;
}
