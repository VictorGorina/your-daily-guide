import type { DailyLog } from "@/lib/daily";
import type { MacroEstimate, MealMacroEstimate } from "@/lib/guide.functions";
import { cleanDaySnacks, snackTotals } from "@/lib/snacks";

/**
 * Punto de partida de la barra de macros mientras no hay nada que sumar todavía
 * (guía sin cargar o ninguna comida marcada): la barra se muestra igual, en 0,
 * en vez de esperar a la primera comida confirmada.
 */
export const ZERO_MACROS: MacroEstimate = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
};

/**
 * Suma las estimaciones por plato (`mealMacros`) de las comidas que ya están
 * marcadas como comidas ("comí esto" / "comí distinto"), para que la barra
 * refleje solo lo confirmado — no el menú del día entero de golpe. Deshacer una
 * comida la resta de la suma, igual que el contador "x de y". `null` cuando la
 * guía todavía no trae `mealMacros` — el caller cae entonces a `ZERO_MACROS`
 * para seguir mostrando la barra (en 0) en vez de ocultarla.
 *
 * La usan tanto la pestaña Hoy como el detalle de un día pasado en Plan.
 */
export function sumDoneMacros(
  mealMacros: MealMacroEstimate[] | null | undefined,
  habits: DailyLog["habits"],
): MacroEstimate | null {
  if (!mealMacros?.length) return null;
  const doneLabels = new Set(
    habits.filter((h) => h.status === "plan" || h.status === "distinto").map((h) => h.label),
  );
  const totals: MacroEstimate = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const m of mealMacros) {
    if (!doneLabels.has(m.moment)) continue;
    totals.kcal += m.kcal;
    totals.protein_g += m.protein_g;
    totals.carbs_g += m.carbs_g;
    totals.fat_g += m.fat_g;
    totals.fiber_g += m.fiber_g;
  }
  return totals;
}

/** Suma de dos estimaciones (p. ej. comidas marcadas + picoteo del día). */
export function addMacros(a: MacroEstimate, b: MacroEstimate): MacroEstimate {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
    fiber_g: a.fiber_g + b.fiber_g,
  };
}

/**
 * Desvío en kcal de cada comida cambiada frente a lo que preveía el plan: lo
 * que estima la guía nueva menos lo que estimaba la guía de antes de tocarla,
 * UNA cifra por comida (no ya sumadas).
 *
 * Es lo que convierte "he comido pizza y cerveza" en algo que el servidor
 * puede acumular día a día (`compensateDishChanges`, que guarda cada cifra en
 * `MealHabit.swapKcalDelta` y decide con `pendingSwapKcal` si hace falta
 * recolocar el plan): dos cambios pequeños por separado deben poder sumar
 * hasta pasar el umbral aunque cada lote solo vea el suyo.
 *
 * Omite las comidas sin las dos cifras — sin dato es mejor no inventarse un
 * cero, que se leería como "no ha pasado nada".
 */
export function perMealKcalDeltas(
  changes: readonly { label: string; prevKcal: number | null }[],
  mealMacros: MealMacroEstimate[] | null | undefined,
): { label: string; kcalDelta: number }[] {
  const out: { label: string; kcalDelta: number }[] = [];
  for (const change of changes) {
    if (change.prevKcal == null) continue;
    const now = mealMacros?.find((m) => m.moment === change.label)?.kcal;
    if (typeof now !== "number") continue;
    out.push({ label: change.label, kcalDelta: Math.round(now - change.prevKcal) });
  }
  return out;
}

/**
 * Referencia genérica (no personalizada por profesional alguno) de respaldo,
 * solo para cuando todavía no hay `macroEstimate` del día (guía sin generar o
 * sin plan). La proteína se ajusta al peso (~1,2 g/kg, cifra habitual para
 * población general); carbohidratos, grasa y fibra usan un valor fijo. En
 * cuanto hay guía, el objetivo real es el total estimado para los platos reales
 * de ese día (`macroEstimate`). Todo el bloque es orientativo.
 */
export function macroTargets(weightKg: number | null) {
  const proteinTarget = Math.round(Math.min(200, Math.max(45, (weightKg ?? 70) * 1.2)));
  return { protein_g: proteinTarget, carbs_g: 250, fat_g: 70, fiber_g: 30 };
}

/**
 * Semáforo de un día, por CIFRAS y no por cumplimiento.
 *
 * Hasta 2026-09-20 el color de un día en el calendario salía de `ratioSignal`:
 * cuántas de sus comidas se habían marcado. Eso decía si la persona había usado
 * la app ese día, no cómo le había ido. Ahora compara lo que comió (comidas
 * confirmadas + picoteo) con el objetivo del día, que es lo que la barra de
 * macros ya enseña como `target`: la suma de lo que el plan proponía
 * (`guide.macroEstimate`).
 *
 * El rojo se reserva para pasarse de largo (decisión del usuario, 2026-09-20,
 * que revisa el "sin rojo" del roadmap UX): quedarse corto NUNCA es rojo, y un
 * día sin registro sigue siendo neutro.
 */
export type DaySignal = "success" | "warning" | "over" | "muted" | "none";

/** Margen alrededor del objetivo que se considera "en su sitio" (±10 %). */
export const ON_TARGET_RATIO = 0.1;
/** A partir de aquí el día no se desvió: se pasó de largo (+25 %). */
export const OVER_TARGET_RATIO = 0.25;

export function daySignal(
  consumedKcal: number,
  targetKcal: number | null | undefined,
  /** ¿Hay algo registrado ese día? Sin registro el día es neutro, no "por debajo". */
  logged: boolean,
): DaySignal {
  if (!logged) return "none";
  // Un día registrado pero sin estimación de macros (guía que falló, día
  // anterior a que existiera la barra) no se puede juzgar: gris, no verde.
  if (!targetKcal || targetKcal <= 0) return "muted";
  const ratio = consumedKcal / targetKcal;
  if (ratio > 1 + OVER_TARGET_RATIO) return "over";
  if (ratio > 1 + ON_TARGET_RATIO) return "warning";
  if (ratio >= 1 - ON_TARGET_RATIO) return "success";
  return "warning";
}

/**
 * Lo que una persona comió de verdad en un día: las comidas que marcó (con las
 * macros por plato de la guía) más el picoteo apuntado. Es la misma cifra que
 * el detalle del día pone bajo "Macros del día" y la que alimenta el semáforo
 * del calendario, para que el color y el número nunca se contradigan.
 */
export function consumedMacrosOf(log: DailyLog | null | undefined): MacroEstimate {
  return addMacros(
    sumDoneMacros(log?.guide?.mealMacros, log?.habits ?? []) ?? ZERO_MACROS,
    snackTotals(cleanDaySnacks(log?.snacks)),
  );
}

/** ¿Hay algo registrado de ese día? Una comida resuelta o un picoteo apuntado. */
export function hasDayRecord(log: DailyLog | null | undefined): boolean {
  const habits = log?.habits ?? [];
  return habits.some((h) => h.status != null) || !!cleanDaySnacks(log?.snacks)?.entries.length;
}

/** Semáforo de un día a partir de su registro completo (ver `daySignal`). */
export function daySignalOf(log: DailyLog | null | undefined): DaySignal {
  return daySignal(consumedMacrosOf(log).kcal, log?.guide?.macroEstimate?.kcal, hasDayRecord(log));
}

/** Lo único que a esta capa le importa de una guía: sus cifras. */
type GuideNumbers = {
  macroEstimate?: MacroEstimate | null;
  mealMacros?: MealMacroEstimate[] | null;
};

/**
 * Funde una guía recién generada con la que ya estaba guardada, de forma que
 * **regenerar nunca pueda dejar el día con menos cifras de las que tenía**.
 *
 * Hace falta porque `generateDailyGuide` puede devolver su texto de respaldo
 * sin macros (el modelo falló, se agotó el tope de gasto, se cortó por tiempo),
 * y guardarlo tal cual borraba unas macros que sí eran buenas. A partir de ahí
 * el reintento automático las daba por perdidas y solo el botón manual las
 * recuperaba.
 *
 * Si la nueva trae cifras, mandan ellas: son las del plato que hay AHORA.
 */
export function mergeGuide<T extends GuideNumbers>(
  prev: GuideNumbers | null | undefined,
  fresh: T,
): T {
  return {
    ...fresh,
    macroEstimate: fresh.macroEstimate ?? prev?.macroEstimate ?? null,
    mealMacros: fresh.mealMacros?.length ? fresh.mealMacros : (prev?.mealMacros ?? null),
  } as T;
}
