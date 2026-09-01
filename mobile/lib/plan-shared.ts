/**
 * Subconjunto de `src/lib/plan-shared.ts` de la web que necesitan las pantallas
 * Hoy y Plan: leer el plan mensual, cadencias y proyección de la compra por
 * compra (`projectTrips`). Es una copia, no código compartido (ver AGENTS.md):
 * si cambia allí, hay que replicarlo aquí. Lo que NO está portado es el saneado
 * de datos de la IA (`cleanShopping`/`cleanPlan`) ni el merge de planes — la app
 * nativa recibe datos ya saneados de `/api/v1/*`.
 */

import { isSharedSlot, MEAL_KEYS, type SharedSlots } from "./household-shared";

/** Las cuatro comidas que se pueden cambiar una a una desde el chat. */
export const MEAL_SLOTS = ["desayuno", "comida", "cena", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABEL: Record<MealSlot, string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
  snack: "Snack",
};

/**
 * Un día del plan. `lunch`/`dinner` vienen siempre del plan generado; el plan
 * base deja el desayuno y el snack a nivel de semana (una lista que rota por
 * día), así que `breakfast`/`snack` sólo aparecen cuando se ha pedido un plato
 * concreto para ESE día. `extras` guarda, por comida, los ingredientes de ese
 * plato que no salen de la lista de la compra, para poder avisar en pantalla.
 */
export type PlanDay = {
  day: string;
  lunch: string;
  dinner: string;
  breakfast?: string;
  snack?: string;
  extras?: Partial<Record<MealSlot, string[]>>;
};

/**
 * Días del mes que cubre el plan. Un plan creado a media de mes solo cubre de
 * hoy a fin de mes (ver `monthCoverage`), y de ahí salen tanto la prorrata del
 * presupuesto como los rangos de días de cada compra.
 */
export type PlanCoverage = { fromDay: number; toDay: number };

export type MonthlyPlan = {
  intro: string;
  focus: string[];
  weeks: {
    label: string;
    focus: string;
    breakfasts: string[];
    snacks: string[];
    days: PlanDay[];
  }[];
  /** Rango de días del mes que cubre este plan (ausente en planes antiguos = mes completo). */
  coverage?: PlanCoverage;
  /** Cada cuánto se compra. Fuente de verdad de la cadencia; el reparto de `trip` la refleja. */
  cadence?: ShoppingCadence;
};

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DIA_NOMBRES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const normDay = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Posición de una fecha dentro del plan (semana 0-3, día 0-6 lunes→domingo). */
export const planCursor = (date: string) => {
  const dayOfMonth = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.max(Math.floor((dayOfMonth - 1) / 7), 0), 3);
  const jsDay = new Date(`${date}T00:00:00`).getDay();
  const dayIndex = (jsDay + 6) % 7;
  return { weekIndex, dayIndex, dayName: DAY_NAMES[dayIndex] ?? "Lunes" };
};

/** Nombre del día de la semana de una fecha, sin depender del locale del entorno. */
export const weekdayName = (date: string) =>
  DIA_NOMBRES[new Date(`${date}T00:00:00`).getDay()] ?? "";

/**
 * Posición exacta (semana, día) que ocupa una fecha dentro del plan. Es la que
 * usan tanto la lectura (`planForDate`) como la escritura de un plato suelto,
 * para que lo que se cambia sea siempre lo que se ve en pantalla.
 */
export function planSlotIndex(
  plan: MonthlyPlan | null,
  date: string,
): { weekIndex: number; dayIndex: number } | null {
  if (!plan?.weeks?.length) return null;
  const dayOfMonth = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.floor((dayOfMonth - 1) / 7), plan.weeks.length - 1);
  const week = plan.weeks[weekIndex];
  if (!week) return null;
  const target = normDay(weekdayName(date));
  const byName = week.days.findIndex((d) => normDay(d.day).includes(target));
  const dayIndex = byName >= 0 ? byName : (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
  return week.days[dayIndex] ? { weekIndex, dayIndex } : null;
}

/** Platos del plan mensual para una fecha concreta (YYYY-MM-DD). */
export function planForDate(plan: MonthlyPlan | null, date: string) {
  const at = planSlotIndex(plan, date);
  const week = at ? plan!.weeks[at.weekIndex] : null;
  if (!at || !week) return null;
  return { week, day: week.days[at.dayIndex] ?? null };
}

export type PlanMeal = {
  moment: string;
  slot: MealSlot;
  idea: string;
  /** Ingredientes de ese plato que no están en la lista de la compra. */
  off: string[];
};

/**
 * Comidas de una fecha concreta, listas para tarjetas de seguimiento diario.
 * Comida y cena salen del día exacto del plan; desayuno y snack usan el plato
 * pedido para ese día si lo hay y, si no, rotan entre las opciones de la semana
 * según el día para dar variedad sin depender de más IA.
 */
export function mealsForDate(plan: MonthlyPlan | null, date: string): PlanMeal[] {
  const found = planForDate(plan, date);
  const { dayIndex } = planCursor(date);
  const rotate = (options: string[]) => (options.length ? options[dayIndex % options.length]! : "");
  const day = found?.day ?? null;
  const off = (slot: MealSlot) => day?.extras?.[slot] ?? [];

  const moments: PlanMeal[] = [
    {
      moment: MEAL_SLOT_LABEL.desayuno,
      slot: "desayuno",
      idea: day?.breakfast || rotate(found?.week.breakfasts ?? []),
      off: off("desayuno"),
    },
    { moment: MEAL_SLOT_LABEL.comida, slot: "comida", idea: day?.lunch ?? "", off: off("comida") },
    { moment: MEAL_SLOT_LABEL.cena, slot: "cena", idea: day?.dinner ?? "", off: off("cena") },
  ];
  const snack = day?.snack || rotate(found?.week.snacks ?? []);
  if (snack) {
    moments.push({ moment: MEAL_SLOT_LABEL.snack, slot: "snack", idea: snack, off: off("snack") });
  }
  return moments;
}

/**
 * El día que ve un miembro del hogar (issue 05, D1): las comidas compartidas
 * ese día de la semana muestran el plato del planificador; las demás, el
 * suyo propio. `weekday` es el índice de día dentro de la semana del plan
 * (0=lunes…6=domingo, igual que `SharedSlots`), no un índice de calendario.
 * Lectura en vivo, válida para cualquier día — a diferencia del espejo de
 * `syncSharedMeals` (que solo escribe hacia adelante), esto no muta nada.
 */
export function composeDayForUser(
  mineDay: PlanDay,
  plannerDay: PlanDay | undefined,
  sharedSlots: SharedSlots,
  weekday: number,
): PlanDay {
  if (!plannerDay) return mineDay;
  const shared = MEAL_KEYS.filter((m) => isSharedSlot(sharedSlots, m, weekday));
  if (!shared.length) return mineDay;

  const extras = { ...(mineDay.extras ?? {}) };
  for (const meal of shared) {
    const mark = plannerDay.extras?.[meal];
    if (mark?.length) extras[meal] = mark;
    else delete extras[meal];
  }

  const next: PlanDay = {
    ...mineDay,
    lunch: shared.includes("comida") ? plannerDay.lunch || mineDay.lunch : mineDay.lunch,
    dinner: shared.includes("cena") ? plannerDay.dinner || mineDay.dinner : mineDay.dinner,
    ...(shared.includes("desayuno") && plannerDay.breakfast
      ? { breakfast: plannerDay.breakfast }
      : {}),
  };
  if (Object.keys(extras).length) next.extras = extras;
  else delete next.extras;
  return next;
}

/**
 * El plan mensual que ve un miembro del hogar: compone cada día con
 * `composeDayForUser` y, cuando el desayuno se comparte, también sustituye la
 * rotación semanal (`week.breakfasts`) por la del planificador. Sin plan
 * propio (`mine` null) compone igualmente, sobre un esqueleto en blanco con
 * los mismos rótulos de semana/día que el del planificador, para que las
 * comidas compartidas se vean aunque la persona no haya planificado nada
 * suyo todavía.
 */
export function composeMonthlyPlanForMember(
  mine: MonthlyPlan | null,
  planner: MonthlyPlan | null,
  sharedSlots: SharedSlots,
): MonthlyPlan | null {
  if (!planner || !MEAL_KEYS.some((m) => sharedSlots[m].length)) return mine;

  const base: MonthlyPlan =
    mine ??
    ({
      intro: "",
      focus: [],
      weeks: planner.weeks.map((w) => ({
        label: w.label,
        focus: "",
        breakfasts: [],
        snacks: [],
        days: w.days.map((d) => ({ day: d.day, lunch: "", dinner: "" })),
      })),
      coverage: planner.coverage,
      cadence: planner.cadence,
    } as MonthlyPlan);

  return {
    ...base,
    weeks: base.weeks.map((week, wi) => {
      const plannerWeek = planner.weeks[wi];
      if (!plannerWeek) return week;
      return {
        ...week,
        breakfasts:
          sharedSlots.desayuno.length && plannerWeek.breakfasts.length
            ? plannerWeek.breakfasts
            : week.breakfasts,
        days: week.days.map((day, di) =>
          composeDayForUser(day, plannerWeek.days[di], sharedSlots, di),
        ),
      };
    }),
  };
}

/** Aviso corto para pantalla cuando un plato lleva algo que no se compró. */
export const offListNote = (names: string[] | undefined) =>
  names?.length ? `Fuera de tu compra: ${names.join(", ")}` : null;

/** Suma días a una fecha YYYY-MM-DD y devuelve otra fecha YYYY-MM-DD. */
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// --- Lista de la compra y cadencias (pantalla Plan) ---

export type ShoppingCadence = "semanal" | "bisemanal" | "mensual";

export const CADENCES: { key: ShoppingCadence; label: string; trips: number }[] = [
  { key: "semanal", label: "Semanal", trips: 4 },
  { key: "bisemanal", label: "Cada 2 semanas", trips: 2 },
  { key: "mensual", label: "Mensual", trips: 1 },
];

/** Unidad canónica de una cantidad de compra. Todo se normaliza a estas tres. */
export type QtyUnit = "g" | "ml" | "ud";

/** Nº de semanas que tiene siempre un plan mensual. */
export const WEEK_COUNT = 4;

/**
 * Un artículo de la lista de la compra. Tiene dos formas (copia de la web, ver
 * AGENTS.md de la raíz):
 *
 * - **Canónica** (lo que guarda el backend): una fila por ingrediente con `unit`
 *   (`g`/`ml`/`ud`) + `weekQty` (cuánto piden los platos de cada semana del plan)
 *   + `weekPrice`. `trip` es 0; las marcas de "comprado" viven en `ownedTrips`.
 *   `qty`/`price_eur` son el total del mes, derivados. Es canónica si trae `weekQty`.
 * - **Proyectada** (lo que consume la UI, vía `projectTrips`): una fila por
 *   compra, con `qty`/`qtyValue`/`price_eur` recortados a los días de esa compra
 *   y `owned` resuelto para ese `trip`.
 *
 * Las listas antiguas (sin `weekQty`) siguen valiendo con la forma proyectada de
 * siempre: una fila por `name` + `trip`.
 */
export type ShoppingItem = {
  name: string;
  qty: string;
  price_eur: number;
  trip: number;
  /** Alimento fresco (poca vida útil). */
  perishable: boolean;
  /**
   * "fridge" si ya lo tenía en casa, "store" si lo compró. Los dos = ya no hace
   * falta comprarlo. En la forma canónica no se usa (ver `ownedTrips`); lo pone
   * `projectTrips` en cada fila proyectada.
   */
  owned?: "fridge" | "store";
  /** Unidad de `weekQty`/`qtyValue`. */
  unit?: QtyUnit;
  /** Cantidad numérica en `unit` de la fila proyectada (para sumar sin re-parsear `qty`). */
  qtyValue?: number;
  /** Cantidad en `unit` que piden los platos de cada semana del plan (longitud `WEEK_COUNT`). */
  weekQty?: number[];
  /** € por semana, array paralelo a `weekQty` (forma canónica). */
  weekPrice?: number[];
  /** Por compra: de dónde salió lo de ese `trip` (forma canónica). */
  ownedTrips?: Record<number, "fridge" | "store">;
};

/** Lista de la compra tal como la guarda el plan mensual. */
export type ShoppingList = { category: string; items: ShoppingItem[] }[];

/** Normaliza un nombre para comparar (minúsculas, sin acentos, sin espacios sobrantes). */
export const normName = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Una lista es canónica si sus artículos traen el desglose por semana (`weekQty`). */
export const isCanonicalShopping = (shopping: ShoppingList | null | undefined): boolean =>
  !!shopping && shopping.some((g) => g.items.some((i) => Array.isArray(i.weekQty)));

/** Cantidad legible en español a partir del valor canónico y su unidad. */
export const formatQty = (value: number, unit: QtyUnit): string => {
  const v = Math.max(0, Number(value) || 0);
  const num = (n: number, digits: number) =>
    n.toLocaleString("es-ES", { maximumFractionDigits: digits });
  if (unit === "g") return v >= 1000 ? `${num(v / 1000, 2)} kg` : `${num(Math.round(v), 0)} g`;
  if (unit === "ml") return v >= 1000 ? `${num(v / 1000, 2)} l` : `${num(Math.round(v), 0)} ml`;
  return `${num(Math.round(v), 0)} ud`;
};

/** Gasto real por viaje de compra (índice de `trip` → euros), a mano tras comprar. */
export type TripActuals = Record<number, number>;

/** Suma de lo realmente gastado en todos los viajes con importe registrado. */
export const tripActualsTotal = (actuals: TripActuals | null | undefined) =>
  Math.round(Object.values(actuals ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0) * 100) /
  100;

/**
 * Fecha (ISO) en la que se han "fijado" los ingredientes de cada tramo de
 * compra (índice de `trip` → fecha), a mano cuando la persona confirma que ya
 * están resueltos (comprados o en casa). Un tramo fijado deja de pedir más
 * marcas: es el equivalente a cerrar esa semana/quincena/mes.
 */
export type TripConfirmations = Record<number, string>;

/**
 * Ingrediente que la persona ya tiene en casa y NO sale de la lista de la
 * compra del mes: añadido a mano ("manual") o detectado al escanear un tiquet
 * ("receipt"). El planificador lo cuenta como disponible al recolocar; la lista
 * de la compra nunca se toca por esto. Copia de `src/lib/plan-shared.ts`.
 */
export type PantryExtra = {
  name: string;
  qty?: string;
  source: "manual" | "receipt";
  addedAt: string;
};

/** Resumen del tiquet escaneado por compra (índice de `trip` → total y nº de líneas). */
export type TripReceipts = Record<number, { total: number; itemCount: number; scannedAt: string }>;

export const tripCount = (shopping: ShoppingList | null | undefined) =>
  Math.max(1, ...((shopping ?? []).flatMap((g) => g.items.map((i) => i.trip + 1)) || [1]));

export const cadenceOf = (shopping: ShoppingList | null | undefined): ShoppingCadence => {
  const trips = tripCount(shopping);
  return trips >= 4 ? "semanal" : trips >= 2 ? "bisemanal" : "mensual";
};

/** Número "oficial" de tramos de una cadencia (4 semanal, 2 bisemanal, 1 mensual). */
export const tripsOfCadence = (cadence: ShoppingCadence) =>
  CADENCES.find((c) => c.key === cadence)?.trips ?? 1;

/** A quién se refiere cada tramo de ingredientes, en palabras, según la cadencia. */
export const cadenceScopeLabel = (cadence: ShoppingCadence) =>
  cadence === "semanal"
    ? "de la semana"
    : cadence === "bisemanal"
      ? "de las dos semanas"
      : "del mes";

/** Número de días de un mes "YYYY-MM". */
export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y ?? 1970, m ?? 1, 0).getDate();
};

/**
 * Días del mes que cubre un plan según cuándo se crea: de hoy a fin de mes si
 * es el mes en curso, y el mes entero si es un mes futuro.
 */
export const monthCoverage = (month: string, today: string): PlanCoverage => {
  const toDay = daysInMonth(month);
  const fromDay =
    today.slice(0, 7) === month ? Math.min(Math.max(Number(today.slice(8, 10)) || 1, 1), toDay) : 1;
  return { fromDay, toDay };
};

/** Proporción del mes que cubre el plan (para prorratear el presupuesto). */
export const coverageRatio = (coverage: PlanCoverage, month: string) => {
  const covered = Math.max(1, coverage.toDay - coverage.fromDay + 1);
  return Math.min(1, covered / daysInMonth(month));
};

// ---------------------------------------------------------------------------
// Navegación de meses de la pantalla Plan
// ---------------------------------------------------------------------------

/** "YYYY-MM" desplazado `delta` meses (cruza de año sin problema). */
export const addMonths = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** "2026-08" → "agosto de 2026". */
export const monthTitle = (month: string): string =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });

/** Días que quedan del mes de `dateISO`, contando hoy (1 = hoy es el último día). */
export const daysLeftInMonth = (dateISO: string): number =>
  daysInMonth(dateISO.slice(0, 7)) - Number(dateISO.slice(8, 10)) + 1;

/** Mes "YYYY-MM" siguiente al de `dateISO`. */
export const nextMonthISO = (dateISO: string): string => addMonths(dateISO.slice(0, 7), 1);

/**
 * Cuántos días naturales antes del día 1 del mes que viene se puede preparar ya
 * su plan (para ir a la compra antes de que empiece). Un único valor para el
 * desbloqueo del navegador y para el aviso push de renovación del plan.
 */
export const NEXT_MONTH_UNLOCK_DAYS = 7;

export const isNextMonthUnlocked = (today: string): boolean =>
  daysLeftInMonth(today) <= NEXT_MONTH_UNLOCK_DAYS;

export type PlanMonthStatus = "past" | "current" | "next-locked" | "next-unlocked" | "far-future";

/** En qué situación está `month` respecto a hoy, para saber qué se puede hacer con él. */
export const planMonthStatus = (month: string, today: string): PlanMonthStatus => {
  const currentMonth = today.slice(0, 7);
  if (month < currentMonth) return "past";
  if (month === currentMonth) return "current";
  if (month === nextMonthISO(today)) {
    return isNextMonthUnlocked(today) ? "next-unlocked" : "next-locked";
  }
  return "far-future";
};

/** Un mes donde se puede generar/editar el plan y accionar la compra: el actual o el siguiente ya desbloqueado. */
export const isMonthActionable = (month: string, today: string): boolean => {
  const status = planMonthStatus(month, today);
  return status === "current" || status === "next-unlocked";
};

/** ¿`dateISO` es anterior a la fecha de alta? (días que la app no podía cubrir). */
export const isBeforeAppStart = (
  dateISO: string,
  appStartedOn: string | null | undefined,
): boolean => !!appStartedOn && dateISO < appStartedOn;

/**
 * Límites del navegador de meses de la pantalla Plan: no se baja del mes de la
 * fecha de alta (antes no hay nada que ver), ni se sube más allá del mes que
 * viene, y solo cuando está desbloqueado.
 */
export const planNavBounds = (
  today: string,
  appStartedOn: string | null | undefined,
): { earliest: string; latest: string } => {
  const currentMonth = today.slice(0, 7);
  const startMonth = (appStartedOn ?? today).slice(0, 7);
  return {
    earliest: startMonth < currentMonth ? startMonth : currentMonth,
    latest: isNextMonthUnlocked(today) ? nextMonthISO(today) : currentMonth,
  };
};

const FULL_MONTH_COVERAGE: PlanCoverage = { fromDay: 1, toDay: 31 };

/**
 * Rango de días [from, to] del mes que cubre una compra dentro de la cobertura
 * del plan. Reparte los días lo más igual posible entre tramos (los primeros se
 * llevan el día de más si no divide exacto) para que un plan creado a media de
 * mes muestre rangos coherentes y el último tramo no desborde el mes.
 */
export const tripDayRange = (coverage: PlanCoverage, trips: number, trip: number) => {
  const total = Math.max(1, coverage.toDay - coverage.fromDay + 1);
  const t = Math.max(1, trips);
  const base = Math.floor(total / t);
  const extra = total % t;
  const start = trip * base + Math.min(trip, extra);
  const size = base + (trip < extra ? 1 : 0);
  const from = Math.min(coverage.toDay, coverage.fromDay + start);
  const to = Math.max(from, Math.min(coverage.toDay, from + size - 1));
  return { from, to };
};

/**
 * Cuándo cae un tramo respecto a hoy: "past" si sus días ya han pasado (ya no
 * toca, se muestra en gris), "current" si hoy cae dentro de su rango (es el
 * que toca ahora, va abierto), o "future" si todavía no le toca (se muestra
 * comprimido). Se apoya en `tripDayRange`, así que respeta la cobertura real
 * del plan igual que las etiquetas.
 */
export type TripTiming = "past" | "current" | "future";

export const tripTiming = (
  trips: number,
  trip: number,
  todayDayOfMonth: number,
  coverage: PlanCoverage = FULL_MONTH_COVERAGE,
): TripTiming => {
  const { from, to } = tripDayRange(coverage, trips, trip);
  if (todayDayOfMonth > to) return "past";
  if (todayDayOfMonth < from) return "future";
  return "current";
};

/**
 * Etiqueta legible de cada tramo de ingredientes con los días que comprende
 * (ej. "Ingredientes de la semana 2 de 4 · días 8-14"), calculada a partir de
 * la cobertura real del plan para que un plan creado a media de mes muestre los
 * días correctos. El "de N" deja claro, sobre todo con semanal/bisemanal, que
 * cada tramo es una lista distinta y no un trozo de la misma.
 */
export const tripLabel = (
  cadence: ShoppingCadence,
  trip: number,
  coverage: PlanCoverage = FULL_MONTH_COVERAGE,
  trips = tripsOfCadence(cadence),
) => {
  const { from, to } = tripDayRange(coverage, trips, trip);
  const prefix =
    cadence === "mensual"
      ? "Ingredientes del mes"
      : `Ingredientes de la semana ${trip + 1} de ${trips}`;
  return `${prefix} · días ${from}-${to}`;
};

/**
 * Agrupa la lista por compra, conservando categorías. `trips` debe venir de la
 * cadencia (`tripsOfCadence`), no de escanear los datos: si un tramo se queda
 * sin artículos (p. ej. pocos frescos repartidos entre muchas compras), sigue
 * apareciendo vacío en vez de desaparecer — si no, "semana 4 de 4" podía
 * faltar sin más cuando esa semana no tenía nada asignado.
 */
export const groupByTrip = (shopping: ShoppingList | null | undefined, trips: number) =>
  Array.from({ length: Math.max(1, trips) }, (_, t) => ({
    trip: t,
    groups: (shopping ?? [])
      .map((g) => ({ category: g.category, items: g.items.filter((i) => i.trip === t) }))
      .filter((g) => g.items.length),
  }));

export type TripGroups = {
  trip: number;
  groups: { category: string; items: ShoppingItem[] }[];
};

const weekOfDay = (day: number, weekCount: number) =>
  Math.min(Math.max(Math.floor((day - 1) / 7), 0), Math.max(1, weekCount) - 1);

/**
 * Cuántos días cubiertos por el plan caen en cada semana. La última "semana" de
 * un mes de 30-31 días arrastra 9-10 días (no 7), así que repartir la cantidad
 * de esa semana entre SUS días —y no siempre entre 7— es lo que hace que cada
 * compra sume exactamente lo suyo y Σ compras = total del mes.
 */
export const weekDayCounts = (coverage: PlanCoverage, weekCount: number): number[] => {
  const counts = new Array(Math.max(1, weekCount)).fill(0);
  for (let d = coverage.fromDay; d <= coverage.toDay; d++) counts[weekOfDay(d, weekCount)] += 1;
  return counts;
};

/**
 * Proyecta la lista canónica sobre las compras de una cadencia: cada compra suma
 * la parte de `weekQty`/`weekPrice` de los días que cubre (rango de
 * `tripDayRange`). Una lista antigua (sin `weekQty`) cae en `groupByTrip`.
 */
export const projectTrips = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  coverage: PlanCoverage,
  weekCount: number = WEEK_COUNT,
): TripGroups[] => {
  const trips = tripsOfCadence(cadence);
  if (!isCanonicalShopping(shopping)) return groupByTrip(shopping, trips);

  const wc = Math.max(1, weekCount);
  const counts = weekDayCounts(coverage, wc);

  return Array.from({ length: Math.max(1, trips) }, (_, t) => {
    const { from, to } = tripDayRange(coverage, trips, t);
    const groups = (shopping ?? [])
      .map((group) => ({
        category: group.category,
        items: group.items
          .map((item) => projectItemForTrip(item, from, to, wc, counts, t))
          .filter((i): i is ShoppingItem => i !== null),
      }))
      .filter((group) => group.items.length);
    return { trip: t, groups };
  });
};

const projectItemForTrip = (
  item: ShoppingItem,
  from: number,
  to: number,
  weekCount: number,
  weekDays: number[],
  trip: number,
): ShoppingItem | null => {
  if (!Array.isArray(item.weekQty)) return item.trip === trip ? item : null;

  const weekPrice = item.weekPrice ?? [];
  let qty = 0;
  let price = 0;
  for (let d = from; d <= to; d++) {
    const w = weekOfDay(d, weekCount);
    const share = weekDays[w] || 1;
    qty += (item.weekQty[w] ?? 0) / share;
    price += (weekPrice[w] ?? 0) / share;
  }
  if (qty <= 0.0001) return null;

  const unit = item.unit ?? "ud";
  const source = item.ownedTrips?.[trip];
  return {
    name: item.name,
    qty: formatQty(qty, unit),
    qtyValue: Math.round(qty * 100) / 100,
    price_eur: Math.round(price * 100) / 100,
    trip,
    perishable: item.perishable,
    unit,
    ...(source ? { owned: source } : {}),
  };
};

/**
 * Color del punto de categoría en la lista de la compra. Las categorías las
 * asigna la IA como texto libre ("Verdura y fruta", "Proteína"...), así que
 * esto es un mapeo por palabra clave, no un enum cerrado — reutiliza los tonos
 * de food-categories.ts para que la paleta de comida sea consistente en toda
 * la app.
 */
export function shoppingCategoryColor(category: string): string {
  const c = category.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (c.includes("verdura") || c.includes("fruta")) return "#6dbe7b";
  if (c.includes("carne") || c.includes("pescado") || c.includes("proteina") || c.includes("ave"))
    return "#e57373";
  if (c.includes("lacte")) return "#f5e6c8";
  if (c.includes("despensa") || c.includes("cereal") || c.includes("legumbre")) return "#d7b58a";
  return "#83796c";
}

export const shoppingTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round(
    (shopping ?? []).reduce(
      (sum, g) => sum + g.items.reduce((s, i) => s + (Number(i.price_eur) || 0), 0),
      0,
    ) * 100,
  ) / 100;

/** Suma de lo marcado como "ya lo tengo en casa" o "comprado": lo que no hace falta comprar. */
export const ownedTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round(
    (shopping ?? []).reduce(
      (sum, g) => sum + g.items.reduce((s, i) => s + (i.owned ? Number(i.price_eur) || 0 : 0), 0),
      0,
    ) * 100,
  ) / 100;

/** Suma de lo marcado como "ya lo tenía en casa" (nevera): dinero que te ahorras, no gasto. */
export const homeTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round(
    (shopping ?? []).reduce(
      (sum, g) =>
        sum +
        g.items.reduce((s, i) => s + (i.owned === "fridge" ? Number(i.price_eur) || 0 : 0), 0),
      0,
    ) * 100,
  ) / 100;

/**
 * Suma de lo marcado como "comprado en el súper": el coste real de la compra
 * ya hecha, sin contar lo que ya se tenía en casa (eso no es gasto nuevo).
 */
export const boughtTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round(
    (shopping ?? []).reduce(
      (sum, g) =>
        sum + g.items.reduce((s, i) => s + (i.owned === "store" ? Number(i.price_eur) || 0 : 0), 0),
      0,
    ) * 100,
  ) / 100;

/**
 * Lo que de verdad queda por comprar: el total menos lo ya marcado (nevera o
 * súper). Es el importe que se muestra junto a cada tramo para que se vea
 * bajar según marcas ingredientes — tenerlo en la nevera ahorra ese dinero.
 */
export const pendingTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round((shoppingTotal(shopping) - ownedTotal(shopping)) * 100) / 100;

/**
 * Ordena los artículos con los pendientes primero: los ya marcados (nevera o
 * comprados) bajan al final del grupo, así al auditar la nevera solo destacan
 * arriba los que de verdad faltan por comprar.
 */
export const sortByPending = (items: ShoppingItem[]): ShoppingItem[] =>
  [...items].sort((a, b) => Number(Boolean(a.owned)) - Number(Boolean(b.owned)));

/**
 * Separa los grupos de un tramo en tres zonas según su estado: pendientes
 * (agrupados por categoría, como en el súper), en casa (nevera) y comprados
 * (súper) — estos dos últimos en listas planas, porque ya no hace falta
 * comprarlos y lo relevante ahí es de dónde salieron, no la categoría. Marcar
 * un ingrediente lo mueve de la primera zona a una de las otras dos.
 */
export const splitTripByStatus = (
  groups: { category: string; items: ShoppingItem[] }[],
): {
  pending: { category: string; items: ShoppingItem[] }[];
  home: ShoppingItem[];
  bought: ShoppingItem[];
} => {
  const pending: { category: string; items: ShoppingItem[] }[] = [];
  const home: ShoppingItem[] = [];
  const bought: ShoppingItem[] = [];
  for (const g of groups) {
    const stillPending = g.items.filter((i) => !i.owned);
    if (stillPending.length) pending.push({ category: g.category, items: stillPending });
    for (const i of g.items) {
      if (i.owned === "fridge") home.push(i);
      else if (i.owned === "store") bought.push(i);
    }
  }
  return { pending, home, bought };
};

export const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/**
 * Texto plano de un solo tramo de ingredientes, listo para compartir aparte —
 * cada tramo es una lista distinta, así que compartirlo no manda todo el mes.
 */
export const tripToText = (
  trip: { groups: { category: string; items: ShoppingItem[] }[] },
  label: string,
) => {
  const lines = [`${label} — ${eur(pendingTotal(trip.groups))}`, ""];
  for (const group of trip.groups) {
    lines.push(group.category);
    for (const item of group.items) {
      const qty = item.qty ? ` (${item.qty})` : "";
      lines.push(`  - ${item.name}${qty} — ${eur(item.price_eur)}`);
    }
  }
  return lines.join("\n");
};

/** Menú de los próximos días, para que el coach sepa qué está cambiando. */
export function upcomingMeals(plan: MonthlyPlan | null, today: string, days = 7) {
  if (!plan) return [];
  const month = today.slice(0, 7);
  const out: Record<string, string>[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (date.slice(0, 7) !== month) break;
    out.push({
      fecha: date,
      dia: weekdayName(date),
      ...Object.fromEntries(mealsForDate(plan, date).map((m) => [m.slot, m.idea])),
    });
  }
  return out;
}

/**
 * Contexto del plan que se manda al coach en cada mensaje: qué hay comprado y
 * los próximos días de menú, para que sus respuestas y cambios encajen con el
 * plan real. Copia de `src/lib/plan-shared.ts` de la web.
 */
export function coachPlanContext(
  row:
    | {
        plan: MonthlyPlan | null;
        shopping: ShoppingList | null;
        confirmed_at: string | null;
        pantry_extras?: PantryExtra[] | null;
      }
    | null
    | undefined,
  today: string,
) {
  if (!row?.plan) return { compra: null, proximos: [], despensa_extra: [] };
  return {
    compra: {
      confirmada: Boolean(row.confirmed_at),
      ingredientes: (row.shopping ?? []).flatMap((g) => g.items.map((i) => i.name)),
    },
    // Ingredientes que la persona dice tener en casa fuera de la lista de la
    // compra: el coach puede proponer platos con ellos, pero no cuentan como
    // "comprados" ni entran en la lista.
    despensa_extra: (row.pantry_extras ?? []).map((e) => e.name),
    proximos: upcomingMeals(row.plan, today),
  };
}
