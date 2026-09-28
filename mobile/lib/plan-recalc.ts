import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

import { apiPost } from "./api";

/**
 * Recálculo del plan del mes. Copia de `src/lib/plan-recalc.ts` de la web (este
 * repo no es un monorepo). La despensa extra (`"meals"`) lo dispara sola, por
 * evento y nunca por tiempo: el debounce de ~6 s agrupa varios cambios seguidos
 * en una sola llamada a `POST /api/v1/plan/reflow`. Si la app pasa a segundo
 * plano se fuerza el envío, y el "pendiente" en AsyncStorage deja que la
 * pantalla Plan lo reintente al volver a abrirse. La mesa del hogar (`"full"`)
 * ya no lo dispara sola: lo pide quien planifica con "Rehacer plan con la
 * familia" (`rebuildPlanWithHousehold`).
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
    await postReflow(job);
  } catch (err) {
    console.warn("plan-recalc: no se pudo actualizar el plan", err);
  } finally {
    clearPersisted(job.month);
    running = false;
    notifyDone(job.month);
  }
}

/** Lo que devuelve `POST /api/v1/plan/reflow` y le importa al cliente. */
export type ReflowOutcome = { skipped?: string; scope?: string; synced?: number } | null;

async function postReflow(p: Pending): Promise<ReflowOutcome> {
  const result = await apiPost<ReflowOutcome>("plan/reflow", {
    month: p.month,
    today: p.today,
    scope: p.scope,
  });
  // Un recálculo "full" (entró o salió alguien de la mesa, cambió una ración)
  // rehace también las CANTIDADES de la compra. Eso hay que decirlo: se deja
  // una marca que sobrevive a navegar de Familia a Plan, que es justo el
  // camino que hace la persona. Un `skipped` no cuenta.
  if (result && !result.skipped && result.scope === "full") await markPlanUpdated(p.month);
  return result;
}

function notifyDone(month: string) {
  for (const cb of listeners) {
    try {
      cb(month);
    } catch {
      /* no-op */
    }
  }
}

/**
 * "Rehacer plan con la familia": regenera ya el plan y las cantidades del mes
 * con la mesa actual y copia las comidas compartidas a quien tiene la app
 * (`reflowMonthlyPlan` con `scope: "full"`). Un `"full"` que quedara pendiente de
 * antes queda cubierto por este y se descarta; un `"meals"` (despensa) no, porque
 * el recálculo completo no mira la despensa extra. Lanza si falla, para que la
 * pantalla lo diga.
 */
export async function rebuildPlanWithHousehold(
  month: string,
  today: string,
): Promise<ReflowOutcome> {
  if (pending?.month === month && pending.scope === "full") {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }
  if ((await readPersisted(month))?.scope === "full") clearPersisted(month);
  try {
    return await postReflow({ month, today, scope: "full" });
  } finally {
    notifyDone(month);
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

const NOTICE_PREFIX = "plan-updated-notice:";

/** Deja constancia de que las cantidades del mes se han rehecho. */
async function markPlanUpdated(month: string) {
  await AsyncStorage.setItem(`${NOTICE_PREFIX}${month}`, "1").catch(() => {});
}

/** ¿Hay un aviso de "tus ingredientes se han actualizado" sin leer para este mes? */
export async function hasPlanUpdatedNotice(month: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(`${NOTICE_PREFIX}${month}`)) === "1";
  } catch {
    return false;
  }
}

/** Descarta el aviso (la persona lo ha leído). */
export function clearPlanUpdatedNotice(month: string): void {
  void AsyncStorage.removeItem(`${NOTICE_PREFIX}${month}`).catch(() => {});
}
