import { useSyncExternalStore } from "react";

import { dishKey } from "@/lib/nutrition/dish-key";
import { MEAL_SLOTS, mealsForDate, type MonthlyPlan } from "@/lib/plan-shared";

/**
 * Precalentamiento de las recetas del plan en el cliente (ticket 06 de
 * `precision-nutricional`, D13): todos los platos del mes, de hoy en adelante,
 * se calculan al generar o cambiar el plan, para que ninguno llegue a Hoy
 * "Calculando…".
 *
 * - Trozos de `WARM_CHUNK` platos, `CONCURRENCY` a la vez, contra
 *   `POST /api/v1/recipes/warm` (la función que llama se inyecta: la web usa la
 *   server function y el móvil `apiPost`; copia en `mobile/lib/recipe-warm.ts`).
 * - Se recuerda en `localStorage` qué platos ya están calculados: la próxima
 *   vez solo se mandan los que faltan.
 * - Nada queda corriendo en el servidor (serverless). Si la app se cierra a
 *   medias, lo que falta sigue sin recordarse y la pantalla Plan lo retoma al
 *   abrirse, igual que `flushPlanRecalc`.
 */

export const WARM_CHUNK = 8;
const CONCURRENCY = 3;
const STORAGE_KEY = "recipe-warm:done";
/** Tope de claves recordadas: suficiente para varios meses de platos. */
const MAX_REMEMBERED = 600;

export type WarmResult = { results: { dish: string; status: string }[] };
export type WarmFn = (dishes: string[]) => Promise<WarmResult>;

export type WarmProgress = { running: boolean; done: number; total: number };

/** Platos únicos del plan de `today` a fin de mes, en todas las comidas. */
export function planDishesToWarm(
  plan: MonthlyPlan | null | undefined,
  month: string,
  today: string,
) {
  if (!plan) return [];
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const seen = new Map<string, string>();
  for (let day = 1; day <= last; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date < today) continue;
    for (const meal of mealsForDate(plan, date, MEAL_SLOTS)) {
      const idea = meal.idea?.trim();
      if (!idea) continue;
      const key = dishKey(idea);
      if (key && !seen.has(key)) seen.set(key, idea);
    }
  }
  return [...seen.values()];
}

function readDone(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeDone(done: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done].slice(-MAX_REMEMBERED)));
  } catch {
    /* modo incógnito: se vuelve a preguntar, y lo ya calculado no cuesta nada */
  }
}

let progress: WarmProgress = { running: false, done: 0, total: 0 };
const listeners = new Set<() => void>();
let inFlight: Promise<boolean> | null = null;

function setProgress(next: WarmProgress) {
  progress = next;
  for (const cb of listeners) cb();
}

/**
 * Calcula los platos que falten. Si ya hay una pasada en marcha, espera a esa
 * (la siguiente llamada, con el plan nuevo, recoge lo que quede). Nunca lanza:
 * un fallo deja esos platos para la próxima vez. Resuelve `true` si no queda
 * ningún plato por calcular (lo que espera la comprobación del plan).
 */
export function warmPlanRecipes(dishes: readonly string[], warm: WarmFn): Promise<boolean> {
  if (inFlight) return inFlight;
  const done = readDone();
  const pending = dishes.filter((d) => !done.has(dishKey(d)));
  if (!pending.length) return Promise.resolve(true);

  const chunks: string[][] = [];
  for (let i = 0; i < pending.length; i += WARM_CHUNK)
    chunks.push(pending.slice(i, i + WARM_CHUNK));
  let finished = 0;
  setProgress({ running: true, done: 0, total: pending.length });

  const worker = async () => {
    for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
      try {
        const { results } = await warm(chunk);
        for (const r of results) {
          // "sin-receta" (vago o no es comida) tampoco se vuelve a preguntar.
          if (r.status !== "calculando") done.add(dishKey(r.dish));
        }
        writeDone(done);
      } catch {
        // Cuota, tope de gasto o red: lo que falta se retoma al volver a Plan.
      }
      finished += chunk.length;
      setProgress({ running: true, done: finished, total: pending.length });
    }
  };

  inFlight = Promise.all(Array.from({ length: CONCURRENCY }, worker))
    .then(() => pending.every((d) => done.has(dishKey(d))))
    .finally(() => {
      inFlight = null;
      setProgress({ running: false, done: 0, total: 0 });
    });
  return inFlight;
}

const fitting = new Map<string, Promise<unknown>>();

/**
 * La comprobación del plan contra el objetivo (`fitMonthlyPlan`, ticket 10 de
 * `precision-nutricional`), una a la vez por mes: la lanza la pantalla Plan
 * cuando el precalentado deja todos los platos calculados. Nunca lanza: un
 * fallo (cuota, red) se retoma la próxima vez que se abra Plan, porque el plan
 * sigue sin su marca `fit`.
 */
export function fitPlanOnce<T>(month: string, fit: () => Promise<T>): Promise<T | null> {
  const running = fitting.get(month);
  if (running) return running as Promise<T | null>;
  const next = fit()
    .catch(() => null)
    .finally(() => fitting.delete(month));
  fitting.set(month, next);
  return next;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Progreso para pintar "Calculando tus platos 24/48". */
export function useRecipeWarmProgress(): WarmProgress {
  return useSyncExternalStore(
    subscribe,
    () => progress,
    () => progress,
  );
}

/** Para los tests: olvida lo recordado y el estado. */
export function _resetRecipeWarm() {
  inFlight = null;
  fitting.clear();
  progress = { running: false, done: 0, total: 0 };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
