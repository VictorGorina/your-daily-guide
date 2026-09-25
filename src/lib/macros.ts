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
/**
 * ¿Esta cifra sale de la receta del plato (o la escribió la persona)? Una
 * comida `calculando` no tiene cifras todavía (D13, ticket 13 de
 * `precision-nutricional`): no se suma, no mide ningún desvío y se enseña como
 * "Calculando…". Una guía guardada antes del campo `status` cuenta como
 * calculada.
 */
export const isMealCalculated = (m: MealMacroEstimate | null | undefined): boolean =>
  !!m && m.status !== "calculando";

/**
 * Comidas que hay que volver a intentar calcular: `calculando` y no vagas (un
 * texto vago no se arregla reintentando, se le pregunta a la persona).
 */
export function mealsToRecalculate(
  mealMacros: readonly MealMacroEstimate[] | null | undefined,
): MealMacroEstimate[] {
  return (mealMacros ?? []).filter((m) => m.status === "calculando" && !m.vague);
}

/**
 * Lo que el cliente le manda a `generateDailyGuide` como `reuse`: las comidas
 * que ya tienen cifra para ese mismo plato, para no volver a descomponerlas.
 * Incluye las kcal que la persona apuntó a mano en "comí distinto" (texto vago,
 * `MealHabit.manualKcal`): esa cifra es suya y manda sobre cualquier cálculo.
 */
/**
 * Las comidas de hoy tal como las pide la guía: el plato, el del plan si se
 * cambió y, si es "comí distinto", que se mida con la ración habitual y el
 * tamaño elegido (ticket 17).
 */
export function guideMeals(
  meals: readonly { moment: string; idea: string }[],
  habits: DailyLog["habits"] | null | undefined,
): { moment: string; idea: string; eaten?: boolean; size?: string | null; planned?: string }[] {
  return meals
    .filter((m) => m.idea)
    .map((m) => {
      const h = (habits ?? []).find((x) => x.label === m.moment);
      // El plato del plan si hoy se cambió: el día se cierra con él (`closeDay`).
      const planned =
        h?.plannedIdea && h.plannedIdea.trim() !== m.idea.trim() ? { planned: h.plannedIdea } : {};
      return h?.status === "distinto"
        ? { moment: m.moment, idea: m.idea, eaten: true, size: h.portionSize ?? null, ...planned }
        : { moment: m.moment, idea: m.idea, ...planned };
    });
}

export function guideReuse(
  mealMacros: readonly MealMacroEstimate[] | null | undefined,
  habits: DailyLog["habits"] | null | undefined,
): MealMacroEstimate[] {
  const manual = (habits ?? [])
    .filter((h) => h.status === "distinto" && h.manualKcal != null && !!h.confirmedIdea)
    .map((h): MealMacroEstimate => ({
      moment: h.label,
      idea: h.confirmedIdea!,
      ...ZERO_MACROS,
      kcal: Math.round(h.manualKcal!),
      status: "calculado",
      manual: true,
    }));
  const manualMoments = new Set(manual.map((m) => m.moment));
  const calculated = (mealMacros ?? []).filter(
    (m) => !!m.idea && isMealCalculated(m) && !manualMoments.has(m.moment),
  );
  return [...manual, ...calculated];
}

/** ¿Qué comidas ya marcadas como comidas siguen por calcular? Para "1 comida por calcular". */
export function donePendingMeals(
  mealMacros: readonly MealMacroEstimate[] | null | undefined,
  habits: DailyLog["habits"],
): string[] {
  const doneLabels = new Set(
    habits.filter((h) => h.status === "plan" || h.status === "distinto").map((h) => h.label),
  );
  return (mealMacros ?? [])
    .filter((m) => doneLabels.has(m.moment) && !isMealCalculated(m))
    .map((m) => m.moment);
}

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
    // Lo que aún no se ha calculado no cuenta: ni un cero ni un promedio.
    if (!doneLabels.has(m.moment) || !isMealCalculated(m)) continue;
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

/** Desvío de una comida cambiada frente al plato del plan. */
export type MealDelta = {
  label: string;
  kcalDelta: number;
  /** `null` cuando no se sabe (cifra manual, que solo trae kcal, o plan sin proteína). */
  proteinDelta: number | null;
};

/**
 * Desvío de cada comida cambiada frente a lo que preveía el plan: lo que estima
 * la guía nueva menos lo que estimaba el plato del plan, UNA cifra por comida
 * (no ya sumadas), en kcal y en proteína.
 *
 * Es lo que convierte "he comido pizza y cerveza" en algo que el servidor
 * puede acumular día a día (`settleDay`, que guarda cada cifra en
 * `MealHabit.swapKcalDelta`/`swapProteinDelta`): dos cambios pequeños por
 * separado deben poder sumar hasta pasar el umbral aunque cada lote solo vea
 * el suyo. La proteína entra en la decisión (ticket 13): cambiar unas lentejas
 * por pasta con tomate apenas mueve las kcal pero quita ~20 g de proteína.
 *
 * Solo se mide con las DOS cifras calculadas (D13). Una comida cuyo plato nuevo
 * aún está "calculando", o cuyo plato del plan no tiene cifra, va a
 * `unresolved`: el cambio se queda en la cola del día hasta que la tenga.
 * Inventarse un cero se leería como "no ha pasado nada".
 */
export function perMealDeltas(
  changes: readonly { label: string; prevKcal: number | null; prevProtein?: number | null }[],
  mealMacros: MealMacroEstimate[] | null | undefined,
): { resolved: MealDelta[]; unresolved: string[] } {
  const resolved: MealDelta[] = [];
  const unresolved: string[] = [];
  for (const change of changes) {
    const now = mealMacros?.find((m) => m.moment === change.label);
    if (change.prevKcal == null || !now || !isMealCalculated(now)) {
      unresolved.push(change.label);
      continue;
    }
    const proteinKnown = !now.manual && change.prevProtein != null;
    resolved.push({
      label: change.label,
      kcalDelta: Math.round(now.kcal - change.prevKcal),
      proteinDelta: proteinKnown ? Math.round(now.protein_g - change.prevProtein!) : null,
    });
  }
  return { resolved, unresolved };
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
  const logged = hasDayRecord(log);
  // Un día con comidas marcadas que aún están "calculando" no se juzga hasta
  // que estén todas (D13): gris, como un día sin cifras.
  if (logged && donePendingMeals(log?.guide?.mealMacros, log?.habits ?? []).length) return "muted";
  // El objetivo es el que tenía ESE día (copia en la guía, ticket 07); los días
  // anteriores a esa copia caen a la suma de lo planificado, como antes.
  const target = log?.guide?.targets?.kcal ?? log?.guide?.macroEstimate?.kcal;
  return daySignal(consumedMacrosOf(log).kcal, target, logged);
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
  // Por comida: una que vuelve "calculando" no borra la cifra que ya tenía el
  // MISMO plato (un reintento que falla no puede dejar el día peor).
  const mealMacros = fresh.mealMacros?.length
    ? fresh.mealMacros.map((m) => {
        if (isMealCalculated(m)) return m;
        const before = prev?.mealMacros?.find(
          (p) => p.moment === m.moment && !!p.idea && p.idea === m.idea && isMealCalculated(p),
        );
        return before ?? m;
      })
    : (prev?.mealMacros ?? null);
  return {
    ...fresh,
    macroEstimate: fresh.macroEstimate ?? prev?.macroEstimate ?? null,
    mealMacros,
  } as T;
}

/**
 * ¿Esta persona quiere ver kcal, macros y objetivos? (ticket 01 de
 * `precision-nutricional`, decisión D3). Es el ÚNICO punto de lectura de
 * `profiles.nutrition_numbers`: ningún componente mira el campo directamente.
 * `true` salvo con "ocultar" — también sin perfil o sin la columna todavía, que
 * es lo que todo el mundo veía hasta ahora. Con "ocultar" los platos se siguen
 * calculando y escalando igual; solo cambia lo que se enseña.
 */
export function showsNutritionNumbers(
  profile: { nutrition_numbers?: string | null } | null | undefined,
): boolean {
  return profile?.nutrition_numbers !== "ocultar";
}
