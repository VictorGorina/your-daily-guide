import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import { dishKey } from "./dish-key";
import { MEAL_SLOTS, mealsForDate, type MonthlyPlan } from "./plan-shared";

/**
 * Precalentamiento de las recetas del plan en el cliente (ticket 06 de
 * `precision-nutricional`, D13): todos los platos del mes, de hoy en adelante,
 * se calculan al generar o cambiar el plan, para que ninguno llegue a Hoy
 * "Calculando…".
 *
 * - Trozos de `WARM_CHUNK` platos, `CONCURRENCY` a la vez, contra
 *   `POST /api/v1/recipes/warm` (la función que llama se inyecta: la web usa la
 *   server function y el móvil `apiPost`). Copia de `src/lib/recipe-warm.ts`
 *   de la web, con `AsyncStorage` en vez de `localStorage`.
 * - Se recuerda en `AsyncStorage` qué platos ya están calculados: la próxima
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

/**
 * `pending`: claves (`dishKey`) de los platos de esta pasada que aún no han
 * vuelto del servidor. Con ellas el calendario sabe qué días se están
 * calculando (`warmingDates`).
 */
export type WarmProgress = {
  running: boolean;
  done: number;
  total: number;
  pending: ReadonlySet<string>;
};

const NOTHING_PENDING: ReadonlySet<string> = new Set();
const IDLE: WarmProgress = { running: false, done: 0, total: 0, pending: NOTHING_PENDING };

const monthDates = (month: string): string[] => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};

/**
 * Platos únicos del plan de `today` a fin de mes, en todas las comidas, en
 * orden de fecha (el de su primer día): las tandas salen en ese orden, así el
 * calendario se completa de principio a fin.
 */
export function planDishesToWarm(
  plan: MonthlyPlan | null | undefined,
  month: string,
  today: string,
) {
  if (!plan) return [];
  const seen = new Map<string, string>();
  for (const date of monthDates(month)) {
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

/**
 * Días (de `today` a fin de mes) con algún plato que la pasada en curso aún no
 * ha calculado. Vacío si no hay pasada.
 */
export function warmingDates(
  plan: MonthlyPlan | null | undefined,
  month: string,
  today: string,
  pending: ReadonlySet<string>,
): Set<string> {
  const dates = new Set<string>();
  if (!plan || !pending.size) return dates;
  for (const date of monthDates(month)) {
    if (date < today) continue;
    const meals = mealsForDate(plan, date, MEAL_SLOTS);
    if (meals.some((meal) => pending.has(dishKey(meal.idea?.trim() ?? "")))) dates.add(date);
  }
  return dates;
}

async function readDone(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeDone(done: Set<string>) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...done].slice(-MAX_REMEMBERED))).catch(
    () => {},
  );
}

let progress: WarmProgress = IDLE;
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
  inFlight = run(dishes, warm).finally(() => {
    inFlight = null;
    setProgress(IDLE);
  });
  return inFlight;
}

async function run(dishes: readonly string[], warm: WarmFn): Promise<boolean> {
  const done = await readDone();
  const pending = dishes.filter((d) => !done.has(dishKey(d)));
  if (!pending.length) return true;

  const chunks: string[][] = [];
  for (let i = 0; i < pending.length; i += WARM_CHUNK)
    chunks.push(pending.slice(i, i + WARM_CHUNK));
  let finished = 0;
  const waiting = new Set(pending.map(dishKey));
  setProgress({ running: true, done: 0, total: pending.length, pending: new Set(waiting) });

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
      // Calculado o no, en esta pasada ya no se está calculando.
      for (const dish of chunk) waiting.delete(dishKey(dish));
      finished += chunk.length;
      setProgress({
        running: true,
        done: finished,
        total: pending.length,
        pending: new Set(waiting),
      });
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return pending.every((d) => done.has(dishKey(d)));
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

/** El progreso de ahora, sin suscribirse. */
export const getRecipeWarmProgress = (): WarmProgress => progress;

/** Progreso para pintar "Calculando macros · 24 de 48 platos" y los días del calendario. */
export function useRecipeWarmProgress(): WarmProgress {
  return useSyncExternalStore(subscribe, getRecipeWarmProgress, getRecipeWarmProgress);
}
