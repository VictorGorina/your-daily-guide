import { supabase } from "@/integrations/supabase/client";

/**
 * Recálculo automático y silencioso del plan del mes cuando cambia algo que lo
 * invalida (issue 05): la despensa extra (`"meals"`) o la mesa del hogar
 * (`"full"` — entra/sale alguien, cambia una ración, alergia o etapa).
 *
 * El disparo es SIEMPRE por evento, nunca por tiempo. Para no lanzar una llamada
 * de IA por cada gesto (añadir 4 ingredientes seguidos serían 4), se agrupa con
 * un debounce: cada cambio reinicia una cuenta de ~6 s y solo al parar se hace
 * UNA llamada a `POST /api/v1/plan/reflow`. Además:
 *  - se persiste un "pendiente" en `localStorage`, así que si la persona cierra
 *    la pestaña dentro de esos 6 s, la red de seguridad de la pantalla Plan
 *    (`flushPlanRecalc`) lo lanza la próxima vez que la abra;
 *  - al ocultar la pestaña se fuerza el envío (`visibilitychange`).
 *
 * El servidor se salta a los no planificadores de un hogar, así que llamar de
 * más es inofensivo (no gasta cuota real).
 */
export type RecalcScope = "meals" | "full";

const DEBOUNCE_MS = 6000;
const STORAGE_PREFIX = "plan-recalc:";

type Pending = { month: string; today: string; scope: RecalcScope };

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Pending | null = null;
let running = false;
const listeners = new Set<(month: string) => void>();

/** Notifica cuando un recálculo termina, para que la pantalla refresque `["plan", month]`. */
export function onPlanRecalcDone(cb: (month: string) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function persist(p: Pending) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${p.month}`, JSON.stringify(p));
  } catch {
    /* modo incógnito / storage lleno: seguimos con el debounce en memoria */
  }
}

function readPersisted(month: string): Pending | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${month}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return p?.month === month && (p.scope === "meals" || p.scope === "full") ? p : null;
  } catch {
    return null;
  }
}

function clearPersisted(month: string) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${month}`);
  } catch {
    /* no-op */
  }
}

async function postReflow(p: Pending): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  const res = await fetch("/api/v1/plan/reflow", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ month: p.month, today: p.today, scope: p.scope }),
  });
  if (!res.ok) throw new Error(`plan/reflow ${res.status}`);
  // Un recálculo "full" (entró o salió alguien de la mesa, cambió una ración)
  // rehace también las CANTIDADES de la compra. Eso hay que decirlo: se deja
  // una marca que sobrevive a navegar de Hogar a Plan, que es justo el camino
  // que hace la persona. Un `skipped` (no planificador, mes pasado) no cuenta.
  const result = (await res.json().catch(() => null)) as {
    skipped?: string;
    scope?: string;
  } | null;
  if (result && !result.skipped && result.scope === "full") markPlanUpdated(p.month);
}

const NOTICE_PREFIX = "plan-updated-notice:";

/** Deja constancia de que las cantidades del mes se han rehecho. */
function markPlanUpdated(month: string) {
  try {
    localStorage.setItem(`${NOTICE_PREFIX}${month}`, "1");
  } catch {
    /* sin storage no hay aviso; el plan se ha actualizado igual */
  }
}

/** ¿Hay un aviso de "tus ingredientes se han actualizado" sin leer para este mes? */
export function hasPlanUpdatedNotice(month: string): boolean {
  try {
    return localStorage.getItem(`${NOTICE_PREFIX}${month}`) === "1";
  } catch {
    return false;
  }
}

/** Descarta el aviso (la persona lo ha leído). */
export function clearPlanUpdatedNotice(month: string): void {
  try {
    localStorage.removeItem(`${NOTICE_PREFIX}${month}`);
  } catch {
    /* no-op */
  }
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
    // Un fallo puntual de IA no debe reintentar en bucle: se limpia el
    // pendiente igual y el siguiente cambio real (o abrir Plan) lo reintenta.
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

/**
 * Dispara ya el recálculo pendiente sin esperar al temporizador. La usa la red
 * de seguridad al abrir Plan (con `month`) y el `visibilitychange` (sin `month`).
 */
export function flushPlanRecalc(month?: string): void {
  if (!pending && month) {
    const stored = readPersisted(month);
    if (stored) pending = stored;
  }
  if (!pending) return;
  if (month && pending.month !== month) return;
  void run();
}

let wired = false;
/** Engancha el flush al ocultar la pestaña. Idempotente; llámalo desde Plan. */
export function wirePlanRecalcFlush(): void {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPlanRecalc();
  });
}
