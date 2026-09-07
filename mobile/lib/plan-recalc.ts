import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { apiPost } from "./api";

/**
 * Recálculo automático y silencioso del plan del mes cuando cambia la despensa
 * extra (`"meals"`) o la mesa del hogar (`"full"`). Copia de `src/lib/plan-recalc.ts`
 * de la web (este repo no es un monorepo). El disparo es por evento, nunca por
 * tiempo; el debounce de ~6 s agrupa varios cambios seguidos en una sola llamada
 * a `POST /api/v1/plan/reflow`. Si la app pasa a segundo plano se fuerza el
 * envío, y el "pendiente" en AsyncStorage deja que la pantalla Plan lo reintente
 * al volver a abrirse.
 */
export type RecalcScope = "meals" | "full";

const DEBOUNCE_MS = 6000;
const STORAGE_PREFIX = "plan-recalc:";

type Pending = { month: string; today: string; scope: RecalcScope };

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Pending | null = null;
let running = false;
const listeners = new Set<(month: string) => void>();

export function onPlanRecalcDone(cb: (month: string) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function persist(p: Pending) {
  void AsyncStorage.setItem(`${STORAGE_PREFIX}${p.month}`, JSON.stringify(p)).catch(() => {});
}

async function readPersisted(month: string): Promise<Pending | null> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}${month}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return p?.month === month && (p.scope === "meals" || p.scope === "full") ? p : null;
  } catch {
    return null;
  }
}

function clearPersisted(month: string) {
  void AsyncStorage.removeItem(`${STORAGE_PREFIX}${month}`).catch(() => {});
}

async function run(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const job = pending;
  if (!job || running) return;
  running = true;
  pending = null;
  try {
    await apiPost("plan/reflow", { month: job.month, today: job.today, scope: job.scope });
  } catch (err) {
    console.warn("plan-recalc: no se pudo actualizar el plan", err);
  } finally {
    clearPersisted(job.month);
    running = false;
    for (const cb of listeners) {
      try {
        cb(job.month);
      } catch {
        /* no-op */
      }
    }
  }
}

/** Programa un recálculo tras ~6 s de calma. `"full"` gana sobre `"meals"`. */
export function schedulePlanRecalc(month: string, today: string, scope: RecalcScope): void {
  const nextScope: RecalcScope =
    pending?.month === month && (pending.scope === "full" || scope === "full") ? "full" : scope;
  pending = { month, today, scope: nextScope };
  persist(pending);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), DEBOUNCE_MS);
}

/** Dispara ya el recálculo pendiente. Red de seguridad al abrir Plan / al ir a segundo plano. */
export async function flushPlanRecalc(month?: string): Promise<void> {
  if (!pending && month) {
    const stored = await readPersisted(month);
    if (stored) pending = stored;
  }
  if (!pending) return;
  if (month && pending.month !== month) return;
  await run();
}

let wired = false;
/** Engancha el flush al pasar la app a segundo plano. Idempotente; llámalo desde Plan. */
export function wirePlanRecalcFlush(): void {
  if (wired) return;
  wired = true;
  AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") void flushPlanRecalc();
  });
}
