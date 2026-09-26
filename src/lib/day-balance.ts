import { exerciseTotals, pendingExerciseKcal, type DayExercise } from "@/lib/exercise";
import {
  pendingSwapKcal,
  pendingSwapProtein,
  type MealChange,
  type MealHabit,
} from "@/lib/plan-shared";
import { pendingSnackKcal, snackTotals, type DaySnacks } from "@/lib/snacks";

/**
 * Balance de energía del día (feature `balance-del-dia`).
 *
 * Antes cada origen de desvío —cambiar un plato en Hoy, picotear, hacer
 * deporte— tenía su propio libro de cuentas, su propio debounce de 10 s, su
 * propia llamada a `compensationNeed` y su propia llamada a `reflowMeals`. Los
 * tres apuntaban a la MISMA ventana de 6 días, sin hablarse. Eso producía dos
 * fallos:
 *
 * - **Se compensaba lo que se cancelaba solo.** Picotear +250 y quemar −300 es
 *   un día a −50, o sea nada; pero cada camino cruzaba su umbral por separado y
 *   se lanzaban dos recolocaciones en direcciones opuestas sobre los mismos
 *   días, en un orden que dependía de qué timer saltara antes.
 * - **Se ignoraba lo que sí había que compensar.** Un cambio de plato de +120 y
 *   un picoteo de +110 son +230 reales, por encima del umbral; pero ninguno de
 *   los dos llegaba a 200 en su propio libro y no pasaba nada.
 *
 * El átomo correcto es el DÍA: la energía se suma en el cuerpo, no por origen.
 * Este módulo hace esa suma y es lo único que decide. Es puro y está testeado
 * (`day-balance.test.ts`); copia en `mobile/lib/day-balance.ts`.
 *
 * Los tres libros de cuentas siguen donde estaban y no se tocan: son la
 * PROCEDENCIA, y por tanto el desglose que la tarjeta de Hoy enseña
 * ("comidas +120 · picoteo +260 · deporte −200"). Lo único que se guarda a
 * nivel de día es el RESULTADO (`DayAdjustment`, columna `daily_logs.adjustment`),
 * que antes vivía triplicado.
 */

export type DayBalanceSources = {
  /** Desvío de los platos cambiados hoy frente a lo que preveía el plan. */
  meals: number;
  /** kcal de lo picado entre horas. Nunca negativo. */
  snacks: number;
  /** kcal quemadas con deporte. Nunca positivo (convención de `DayExercise`). */
  exercise: number;
};

export type DayBalance = {
  sources: DayBalanceSources;
  /**
   * Lo que la persona ve: suma de los tres orígenes, el desvío del día frente
   * al plan. Es el total del día, no lo que queda por compensar.
   */
  net: number;
  /**
   * Lo que decide: desvío aún no mandado a `reflowMeals`, con signo. Difiere de
   * `net` en cuanto algo ya se ha compensado — igual que `pendingSnackKcal`
   * difiere de `snackTotals`.
   */
  pending: number;
  /** Lo ya absorbido por los días futuros, con signo. */
  compensated: number;
  /**
   * Desvío de proteína (g) aún sin mandar, con signo (ticket 13): lo que las
   * comidas cambiadas quitan o añaden frente al plan. El picoteo, que es comida
   * de verdad, suma su proteína contra esa bajada; el deporte no suma nada.
   * Solo decide cuando baja (`COMPENSATION_PROTEIN_DROP_G`).
   */
  proteinPending: number;
  /** ¿Hay algo que contar? Si no, la tarjeta de Hoy no se pinta. */
  active: boolean;
};

/**
 * Desvío de las comidas que AHORA MISMO están cambiadas, para enseñar.
 *
 * Solo cuenta las marcadas como "comí distinto": al deshacer un cambio,
 * `use-meal-swap` deja en la comida un `swapKcalDelta` con el signo contrario
 * (lo que hay que devolverle a los días futuros) pero le quita el estado. Ese
 * apunte es contabilidad interna, no algo que la persona se haya comido: si
 * contara aquí, deshacer un plato de +300 enseñaría "−300" en la tarjeta en vez
 * de volver a cero. Para decidir sí cuenta, y de eso se encarga
 * `pendingSwapKcal`.
 */
export function changedMealsKcal(habits: readonly MealHabit[]): number {
  let total = 0;
  for (const h of habits) {
    if (h.status !== "distinto" || h.swapKcalDelta == null) continue;
    total += h.swapKcalDelta;
  }
  return Math.round(total);
}

/** Lo ya compensado por cambios de plato, con signo. */
function compensatedMealsKcal(habits: readonly MealHabit[]): number {
  let total = 0;
  for (const h of habits) {
    if (!h.swapCompensated || h.swapKcalDelta == null) continue;
    total += h.swapKcalDelta;
  }
  return Math.round(total);
}

export function dayBalance(
  habits: readonly MealHabit[] | null | undefined,
  snacks: DaySnacks | null | undefined,
  exercise: DayExercise | null | undefined,
): DayBalance {
  const list = habits ?? [];
  const sources: DayBalanceSources = {
    meals: changedMealsKcal(list),
    snacks: Math.round(snackTotals(snacks).kcal),
    exercise: Math.round(exerciseTotals(exercise)),
  };
  const pending = Math.round(
    pendingSwapKcal(list) + pendingSnackKcal(snacks) + pendingExerciseKcal(exercise),
  );
  const compensated = Math.round(
    compensatedMealsKcal(list) + (snacks?.compensatedKcal ?? 0) + (exercise?.compensatedKcal ?? 0),
  );
  const net = sources.meals + sources.snacks + sources.exercise;
  // El picoteo solo cuenta contra una bajada pendiente: su proteína nunca
  // dispara nada por sí sola (subir proteína no se compensa).
  const swapProtein = pendingSwapProtein(list);
  const proteinPending =
    swapProtein < 0 ? Math.min(0, swapProtein + Math.round(snackTotals(snacks).protein_g)) : 0;
  return {
    sources,
    net,
    pending,
    compensated,
    proteinPending,
    // Lo que hace que la tarjeta valga la pena es que haya algo QUE ENSEÑAR: una
    // línea de desglose, o algo por asentar (para poder decir "ajustando…").
    // `compensated` a solas no cuenta: un día que ya compensó algo y luego se
    // deshizo se queda sin orígenes y sin pendiente, y pintaba una tarjeta
    // "Balance de hoy · 0 kcal" sin ninguna línea debajo — un cero mudo que no
    // informa de nada. (El componente la pinta igualmente si hay platos movidos
    // que enseñar, aunque el día haya vuelto a cero.)
    active:
      sources.meals !== 0 ||
      sources.snacks !== 0 ||
      sources.exercise !== 0 ||
      pending !== 0 ||
      proteinPending !== 0,
  };
}

/**
 * ¿Lo pendiente deshace una compensación ya aplicada, en vez de ser un desvío
 * nuevo? Generaliza a todo el día las dos reglas que tenían picoteo y deporte
 * por separado ("ya había compensado y ahora el pendiente va en sentido
 * contrario"), y le da la misma respuesta cuando el origen es otro: si ayer se
 * recortaron cenas por un picoteo y luego se hace deporte, ese déficit es antes
 * que nada la devolución de aquel recorte.
 *
 * Importa porque `compensationNeed` usa el umbral simétrico `above` cuando se
 * está deshaciendo, en vez del margen ancho "a favor del objetivo": ese margen
 * existe para no tocar el plan por un déficit real que conviene dejar estar, no
 * para dejar clavado un ajuste que ya no tiene motivo.
 */
export function dayReversing(balance: DayBalance): boolean {
  if (!balance.compensated || !balance.pending) return false;
  return Math.sign(balance.pending) !== Math.sign(balance.compensated);
}

/** Platos futuros que se movieron por el día, tal y como se guardan. */
export type DayAdjustment = {
  changes: MealChange[];
  summary: string;
  /** Desvío que se absorbió, acumulado en el día. */
  kcal: number;
  /**
   * kcal que los platos cambiados mueven DE VERDAD, medidas con sus recetas
   * (ticket 18), con el signo del desvío que compensan: +300 = han quitado 300
   * kcal a los próximos días para compensar un exceso. Ausente si no se pudo
   * medir (algún plato aún sin calcular) o en un ajuste anterior al ticket.
   */
  absorbedKcal?: number;
  /** Se insistió con los números y aun así se quedó corto: "el resto no lo persigo". */
  partial?: boolean;
};

/** Por debajo de esta parte del desvío, el reajuste se da por corto e insiste una vez. */
export const ABSORB_MIN_SHARE = 0.5;

/**
 * Cuánto compensan de verdad unos cambios de plato (ticket 18): −Σ(después −
 * antes), con las kcal que da `kcalOf` (la receta a la ración del plan). Con el
 * signo del desvío: un exceso se compensa quitando energía, así que
 * compensar +400 es que los platos nuevos sumen 400 menos. `null` si algún plato
 * no tiene cifra: sin medir, no se afirma nada.
 */
export function absorbedKcal(
  changes: readonly Pick<MealChange, "before" | "after">[],
  kcalOf: (dish: string) => number | null,
): number | null {
  let total = 0;
  for (const c of changes) {
    const before = kcalOf(c.before);
    const after = kcalOf(c.after);
    if (before == null || after == null) return null;
    total += after - before;
  }
  return Math.round(-total);
}

/** ¿Se queda corto? Solo con el mismo signo y menos de la mitad del desvío. */
export function absorbsTooLittle(absorbed: number, pendingKcal: number): boolean {
  if (!pendingKcal) return false;
  return absorbed * Math.sign(pendingKcal) < ABSORB_MIN_SHARE * Math.abs(pendingKcal);
}

/**
 * Lo que la tarjeta dice que se ha movido (ticket 18: lo que se enseña es lo que
 * el código midió). `null` si no hay medida.
 */
export function absorbedNote(
  adjustment: Pick<DayAdjustment, "absorbedKcal" | "partial" | "kcal"> | null | undefined,
  showNumbers: boolean,
): string | null {
  const absorbed = adjustment?.absorbedKcal;
  if (absorbed == null) return null;
  if (adjustment?.partial) return "He ajustado una parte; el resto no lo persigo.";
  if (showNumbers) {
    const n = Math.abs(Math.round(absorbed / 10) * 10).toLocaleString("es-ES");
    return `He movido unas ${n} kcal de tus próximos días.`;
  }
  return (adjustment?.kcal ?? absorbed) >= 0
    ? "He aligerado un poco tus próximas comidas."
    : "He reforzado un poco tus próximas comidas.";
}

export type DayOutcome =
  | "adjusted"
  | "below-threshold"
  | "pregnancy"
  | "no-plan"
  | "no-meals"
  | "no-days"
  | "shared-only"
  | "nothing";

export type DayAdjustmentRecord = {
  adjustment: DayAdjustment | null;
  lastOutcome: DayOutcome | null;
};

const OUTCOMES: readonly DayOutcome[] = [
  "adjusted",
  "below-threshold",
  "pregnancy",
  "no-plan",
  "no-meals",
  "no-days",
  "shared-only",
  "nothing",
];

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Lectura defensiva de `daily_logs.adjustment`. `null` si no hay nada útil. */
export function cleanDayAdjustment(raw: unknown): DayAdjustmentRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const adj = o.adjustment as Record<string, unknown> | null | undefined;
  const adjustment =
    adj && typeof adj === "object"
      ? {
          changes: (Array.isArray(adj.changes) ? adj.changes : []) as MealChange[],
          summary: String(adj.summary ?? ""),
          kcal: Math.round(num(adj.kcal)),
          ...(adj.absorbedKcal != null && Number.isFinite(Number(adj.absorbedKcal))
            ? { absorbedKcal: Math.round(Number(adj.absorbedKcal)) }
            : {}),
          ...(adj.partial === true ? { partial: true } : {}),
        }
      : null;
  const lastOutcome = OUTCOMES.includes(o.lastOutcome as DayOutcome)
    ? (o.lastOutcome as DayOutcome)
    : null;
  if (!adjustment && !lastOutcome) return null;
  return { adjustment, lastOutcome };
}

/**
 * Junta el reajuste nuevo con el que ya había ese día, para que la tarjeta
 * enseñe todo lo que el día ha movido y no solo la última pasada: de cada
 * comida se conserva el plato de ANTES del primer reajuste y el de DESPUÉS del
 * último, y se quita la que ha vuelto a quedar como estaba.
 *
 * Es lo que hace tolerable que haya varias pasadas en un día (una por ráfaga de
 * actividad): a las 22:00 se lee como un solo ajuste coherente. Unifica
 * `mergeAdjustment` (picoteo) y `mergeExerciseAdjustment` (deporte), que eran
 * la misma función escrita dos veces.
 */
export function mergeDayAdjustment(
  prev: DayAdjustment | null | undefined,
  next: DayAdjustment,
): DayAdjustment {
  if (!prev) return next;
  const byCell = new Map<string, MealChange>();
  for (const c of prev.changes) byCell.set(`${c.date}:${c.slot}`, c);
  for (const c of next.changes) {
    const key = `${c.date}:${c.slot}`;
    const earlier = byCell.get(key);
    byCell.set(key, earlier ? { ...c, before: earlier.before } : c);
  }
  const changes = [...byCell.values()]
    .filter((c) => c.before !== c.after)
    .sort((a, b) =>
      a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date),
    );
  const absorbed =
    prev.absorbedKcal != null && next.absorbedKcal != null
      ? prev.absorbedKcal + next.absorbedKcal
      : (next.absorbedKcal ?? undefined);
  return {
    changes,
    summary: next.summary || prev.summary,
    kcal: prev.kcal + next.kcal,
    ...(absorbed != null ? { absorbedKcal: absorbed } : {}),
    ...(next.partial ? { partial: true } : {}),
  };
}

/**
 * Lo que se le cuenta a la IA al recolocar: el día entero en una nota, en vez
 * de tres notas parciales que se pisaban. El modelo ve lo que vería un
 * nutricionista mirando el día, no un evento suelto.
 */
export function dayNote(opts: {
  changedMeals: readonly { label: string; dish: string; plannedDish: string }[];
  snackEntries: readonly { text: string; kcal: number }[];
  exerciseEntries: readonly {
    activity: string;
    minutes: number;
    intensity: string;
    kcal: number;
  }[];
  pendingKcal: number;
  reversing: boolean;
  /** Bajada de proteína (g, negativa) que hay que reponer, si es lo que dispara. */
  proteinDrop?: number | null;
}): string {
  const parts: string[] = [];
  if (opts.changedMeals.length) {
    const lines = opts.changedMeals.map(
      (c) => `${c.label}: "${c.dish}" en vez de "${c.plannedDish || "(plato del plan)"}"`,
    );
    parts.push(`ha cambiado platos (${lines.join("; ")})`);
  }
  if (opts.snackEntries.length) {
    const list = opts.snackEntries.map((e) => `${e.text} (~${e.kcal} kcal)`).join("; ");
    parts.push(`ha picado entre horas (${list})`);
  }
  if (opts.exerciseEntries.length) {
    const list = opts.exerciseEntries
      .map(
        (e) =>
          `${e.activity} ${e.minutes} min (${e.intensity.toLowerCase()}, ~${-e.kcal} kcal quemadas)`,
      )
      .join("; ");
    parts.push(`ha hecho deporte (${list})`);
  }

  const what = parts.length ? `Hoy ${parts.join(", y ")}.` : "Hoy se ha desviado del plan.";
  // Hasta el ticket 12 la proteína la repone el modelo: se le dice en la nota.
  const protein =
    opts.proteinDrop != null && opts.proteinDrop < 0
      ? ` Además ha comido unos ${-Math.round(opts.proteinDrop)} g menos de proteína de lo previsto: ` +
        "refuerza la proteína de las comidas de los días siguientes (legumbre, huevo, pescado, carne " +
        "magra o lácteos) sin subir la energía."
      : "";
  if (opts.reversing) {
    return `${what} Se ha deshecho parte de lo que ya se había compensado: ${
      opts.pendingKcal > 0
        ? "retira de los días siguientes la energía de más que se les había puesto."
        : "devuelve a los días siguientes la energía que se les había quitado."
    }${protein}`;
  }
  // Solo la proteína dispara: la energía está dentro del margen.
  if (protein && Math.abs(opts.pendingKcal) < 200) return `${what}${protein}`;
  return opts.pendingKcal >= 0
    ? `${what} Recoloca los días siguientes para compensar el exceso.${protein}`
    : `${what} Repón ese déficit en los días siguientes.${protein}`;
}

/**
 * Frase para la tarjeta cuando el último asentamiento no ha movido el plan por
 * un motivo que conviene explicar. `null` cuando el motivo se cuenta mejor con
 * las cifras a la vista (ver `balanceNote`).
 */
export function dayOutcomeNote(outcome: DayOutcome | null | undefined): string | null {
  switch (outcome) {
    case "no-days":
      return "No quedan días este mes donde compensarlo.";
    case "shared-only":
      return "Tus comidas de estos días son de la casa: no las cambio por esto.";
    case "no-meals":
      return "No planificas comidas ni cenas donde compensarlo.";
    case "no-plan":
      return "Aún no tienes plan este mes: queda apuntado.";
    case "pregnancy":
      return "Queda apuntado. Con embarazo o lactancia no recorto los próximos días.";
    default:
      return null;
  }
}

/**
 * Qué dice la tarjeta cuando el plan NO se ha movido. Un "no he cambiado nada"
 * explicado genera tanta confianza como un cambio: demuestra que el sistema
 * estaba mirando. Por eso el caso de dos orígenes que se anulan tiene frase
 * propia, en vez de caer en el genérico de "desvío pequeño".
 */
export function balanceNote(
  balance: DayBalance,
  outcome: DayOutcome | null | undefined,
  opts: { onlyRoutineExercise?: boolean } = {},
): string | null {
  const explained = dayOutcomeNote(outcome);
  if (explained) return explained;
  if (outcome !== "below-threshold" && outcome !== "nothing") return null;
  // El deporte de hoy fue solo de su rutina: ya iba en el objetivo (D9, ticket 16).
  if (opts.onlyRoutineExercise && balance.sources.exercise === 0) {
    return "Tu rutina ya va en tu plan. Lo demás lo absorbe el plan tal cual.";
  }

  const { meals, snacks, exercise } = balance.sources;
  const positives = (meals > 0 ? meals : 0) + snacks;
  // Dos orígenes de signo contrario que casi se anulan: eso no es "un desvío
  // pequeño", es el día cuadrando solo, y merece decirse.
  if (exercise < 0 && positives > 0 && Math.abs(balance.net) < Math.min(positives, -exercise)) {
    return "El deporte compensa lo que has comido de más. No he tocado tu plan.";
  }
  return "Lo absorbe el plan tal cual. Te aviso si el día se desvía más.";
}

/**
 * Platos que el desvío de un día movió en los días siguientes, para el detalle
 * de un día pasado.
 *
 * Lee primero el registro del día (`daily_logs.adjustment`) y, si no lo hay,
 * cae a los tres sitios donde esto vivía antes de `balance-del-dia`: un día ya
 * cerrado no se reescribe, así que el historial anterior a la feature solo está
 * ahí. Se deduplica por celda porque las copias viejas se solapaban — el mismo
 * reajuste se escribía en el picoteo, en el deporte y en cada comida del lote.
 */
export function dayMovedChanges(log: {
  adjustment?: DayAdjustmentRecord | null;
  habits?: readonly MealHabit[] | null;
  snacks?: { adjustment?: { changes: MealChange[] } | null } | null;
  exercise?: { adjustment?: { changes: MealChange[] } | null } | null;
}): MealChange[] {
  const fromDay = cleanDayAdjustment(log.adjustment)?.adjustment?.changes;
  if (fromDay?.length) return fromDay;

  const byCell = new Map<string, MealChange>();
  for (const c of log.snacks?.adjustment?.changes ?? []) byCell.set(`${c.date}:${c.slot}`, c);
  for (const c of log.exercise?.adjustment?.changes ?? []) byCell.set(`${c.date}:${c.slot}`, c);
  for (const h of log.habits ?? []) {
    for (const c of h.adjustmentChanges ?? []) byCell.set(`${c.date}:${c.slot}`, c);
  }
  return [...byCell.values()].sort((a, b) =>
    a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date),
  );
}

// ---------------------------------------------------------------------------
// Reserva y liberación de los tres libros (`settleDay`)
// ---------------------------------------------------------------------------

/** Lo que `settleDay` marcó como compensado antes de llamar a la IA. */
export type DayReservation = {
  labels: string[];
  snackKcal: number;
  exerciseKcal: number;
  total: number;
  /** Proteína pendiente (g, con signo) que se reservó con las comidas. */
  protein: number;
};

export const EMPTY_RESERVATION: DayReservation = {
  labels: [],
  snackKcal: 0,
  exerciseKcal: 0,
  total: 0,
  protein: 0,
};

/** Los tres libros de cuentas del día, tal como están en `daily_logs`. */
type DayBooks = {
  habits: MealHabit[];
  snacks: DaySnacks | null;
  exercise: DayExercise | null;
};

type DayBooksPatch = Partial<DayBooks>;

/**
 * Reserva: marca los tres libros como compensados (comidas cambiadas con
 * `swapCompensated`, picoteo y deporte sumando a su `compensatedKcal`) sobre la
 * fila recién leída, para que un asentamiento simultáneo no compense lo mismo
 * dos veces. Devuelve el parche y lo reservado, que es lo que `releaseDay`
 * devuelve si la compensación no llega a aplicarse.
 */
export function reserveDay(current: DayBooks): {
  patch: DayBooksPatch;
  reservation: DayReservation;
} {
  const now = dayBalance(current.habits, current.snacks, current.exercise);
  const labels = current.habits
    .filter((h) => (h.swapKcalDelta != null || h.swapProteinDelta != null) && !h.swapCompensated)
    .map((h) => h.label);
  const pendingSnacks = pendingSnackKcal(current.snacks);
  const pendingExercise = pendingExerciseKcal(current.exercise);
  const reservation: DayReservation = {
    labels,
    snackKcal: pendingSnacks,
    exerciseKcal: pendingExercise,
    total: now.pending,
    protein: now.proteinPending,
  };
  const patch: DayBooksPatch = {
    habits: current.habits.map((h) =>
      labels.includes(h.label) ? { ...h, swapCompensated: true } : h,
    ),
    ...(pendingSnacks && current.snacks
      ? {
          snacks: {
            ...current.snacks,
            compensatedKcal: current.snacks.compensatedKcal + pendingSnacks,
          },
        }
      : {}),
    ...(pendingExercise && current.exercise
      ? {
          exercise: {
            ...current.exercise,
            compensatedKcal: current.exercise.compensatedKcal + pendingExercise,
          },
        }
      : {}),
  };
  return { patch, reservation };
}

/** Devuelve una reserva de `reserveDay` sobre la fila actual (releída). */
export function releaseDay(current: DayBooks, reservation: DayReservation): DayBooksPatch {
  return {
    habits: current.habits.map((h) =>
      reservation.labels.includes(h.label) ? { ...h, swapCompensated: false } : h,
    ),
    ...(reservation.snackKcal && current.snacks
      ? {
          snacks: {
            ...current.snacks,
            compensatedKcal: current.snacks.compensatedKcal - reservation.snackKcal,
          },
        }
      : {}),
    ...(reservation.exerciseKcal && current.exercise
      ? {
          exercise: {
            ...current.exercise,
            compensatedKcal: current.exercise.compensatedKcal - reservation.exerciseKcal,
          },
        }
      : {}),
  };
}
