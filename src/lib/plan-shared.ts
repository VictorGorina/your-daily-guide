/** Las cuatro comidas que se pueden cambiar una a una desde el chat. */
export const MEAL_SLOTS = ["desayuno", "comida", "cena", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABEL: Record<MealSlot, string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
  snack: "Snack",
};

/** Campo del día donde vive cada comida cuando se cambia a mano. */
export const MEAL_SLOT_FIELD = {
  desayuno: "breakfast",
  comida: "lunch",
  cena: "dinner",
  snack: "snack",
} as const satisfies Record<MealSlot, keyof PlanDay>;

/**
 * Un día del plan. `lunch`/`dinner` vienen siempre del plan generado; el plan
 * base deja el desayuno y el snack a nivel de semana (una lista que rota por
 * día), así que `breakfast`/`snack` sólo aparecen cuando se ha pedido un plato
 * concreto para ESE día — un cambio a mano manda sobre la rotación semanal.
 * `extras` guarda, por comida, los ingredientes de ese plato que no salen de la
 * lista de la compra, para poder avisar en pantalla.
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

export type ShoppingCadence = "semanal" | "bisemanal" | "mensual";

export const CADENCES: { key: ShoppingCadence; label: string; trips: number }[] = [
  { key: "semanal", label: "Semanal", trips: 4 },
  { key: "bisemanal", label: "Cada 2 semanas", trips: 2 },
  { key: "mensual", label: "Mensual", trips: 1 },
];

export type ShoppingItem = {
  name: string;
  qty: string;
  price_eur: number;
  /**
   * Compra a la que pertenece (0 = primera). Si un ingrediente hace falta en
   * platos de más de una compra (el mismo plato se repite en semanas
   * distintas), puede aparecer varias veces con el mismo `name` y distinto
   * `trip` — una fila por compra, cada una solo con la cantidad y el precio
   * de esa compra — en vez de una única fila con el total del mes. El
   * emparejamiento al marcar "comprado" es por `name` + `trip` juntos, nunca
   * solo por `name`.
   */
  trip: number;
  /** Alimento fresco (poca vida útil). */
  perishable: boolean;
  /**
   * Marcado a mano según de dónde ha salido: "fridge" si ya lo tenía en casa,
   * "store" si lo ha comprado en el súper. Los dos significan que ya no hace
   * falta comprarlo — solo cambia el origen, para saber qué icono resaltar.
   * Sin valor: todavía pendiente, sin decidir.
   */
  owned?: "fridge" | "store";
};
export type ShoppingList = { category: string; items: ShoppingItem[] }[];

/** Gasto real por viaje de compra (índice de `trip` → euros), a mano tras comprar. */
export type TripActuals = Record<number, number>;

export const cleanTripActuals = (raw: unknown): TripActuals => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: TripActuals = {};
  for (const [key, value] of Object.entries(o)) {
    const trip = Number(key);
    const amount = Number(value);
    if (Number.isFinite(trip) && trip >= 0 && Number.isFinite(amount) && amount >= 0) {
      out[Math.round(trip)] = Math.round(amount * 100) / 100;
    }
  }
  return out;
};

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

export const cleanTripConfirmations = (raw: unknown): TripConfirmations => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: TripConfirmations = {};
  for (const [key, value] of Object.entries(o)) {
    const trip = Number(key);
    const date = String(value ?? "").trim();
    if (Number.isFinite(trip) && trip >= 0 && date) out[Math.round(trip)] = date;
  }
  return out;
};

/**
 * Ingrediente que la persona ya tiene en casa y NO sale de la lista de la
 * compra del mes: añadido a mano ("manual") o detectado al escanear un tiquet
 * ("receipt"). El planificador lo cuenta como disponible al recolocar los días
 * futuros; la lista de la compra (`shopping`) nunca se toca por esto.
 */
export type PantryExtra = {
  name: string;
  qty?: string;
  source: "manual" | "receipt";
  addedAt: string;
};

/** Resumen del tiquet escaneado por compra (índice de `trip` → total y nº de líneas). */
export type TripReceipts = Record<number, { total: number; itemCount: number; scannedAt: string }>;

/** Normaliza un nombre de ingrediente para comparar (minúsculas, sin acentos, sin espacios sobrantes). */
export const normName = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const cleanPantryExtras = (raw: unknown): PantryExtra[] => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: PantryExtra[] = [];
  for (const entry of list.slice(0, 60)) {
    const o = (entry ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? "")
      .trim()
      .slice(0, 80);
    if (!name) continue;
    const key = normName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const qty = String(o.qty ?? "")
      .trim()
      .slice(0, 40);
    const source = o.source === "receipt" ? "receipt" : "manual";
    const addedAt = String(o.addedAt ?? "").trim() || new Date().toISOString();
    out.push({ name, ...(qty ? { qty } : {}), source, addedAt });
  }
  return out.slice(0, 40);
};

export const cleanTripReceipts = (raw: unknown): TripReceipts => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: TripReceipts = {};
  for (const [key, value] of Object.entries(o)) {
    const trip = Number(key);
    const v = (value ?? {}) as Record<string, unknown>;
    const total = Number(v.total);
    const itemCount = Number(v.itemCount);
    const scannedAt = String(v.scannedAt ?? "").trim();
    if (!Number.isFinite(trip) || trip < 0 || !Number.isFinite(total) || total < 0) continue;
    out[Math.round(trip)] = {
      total: Math.round(total * 100) / 100,
      itemCount: Number.isFinite(itemCount) && itemCount >= 0 ? Math.round(itemCount) : 0,
      scannedAt: scannedAt || new Date().toISOString(),
    };
  }
  return out;
};

export const tripCount = (shopping: ShoppingList | null | undefined) =>
  Math.max(1, ...((shopping ?? []).flatMap((g) => g.items.map((i) => i.trip + 1)) || [1]));

export const cadenceOf = (shopping: ShoppingList | null | undefined): ShoppingCadence => {
  const trips = tripCount(shopping);
  return trips >= 4 ? "semanal" : trips >= 2 ? "bisemanal" : "mensual";
};

export const tripsOfCadence = (cadence: ShoppingCadence) =>
  CADENCES.find((c) => c.key === cadence)?.trips ?? 1;

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
 * Rango de días [from, to] del mes que cubre una compra dentro de la
 * cobertura del plan. Reparte los días lo más igual posible entre tramos (los
 * primeros se llevan el día de más si no divide exacto) en vez de redondear
 * cada tramo hacia arriba: con eso último, un tramo tras otro se iba comiendo
 * más días de los que quedaban y el último acababa con un rango imposible
 * (p. ej. "días 32-31" cubriendo 9 días entre 4 compras). Si aun así no
 * quedan días para un tramo (menos días que compras), se deja en el último
 * día cubierto en vez de desbordar el mes.
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

/** A quién se refiere cada tramo de ingredientes, en palabras, según la cadencia. */
export const cadenceScopeLabel = (cadence: ShoppingCadence) =>
  cadence === "semanal"
    ? "de la semana"
    : cadence === "bisemanal"
      ? "de las dos semanas"
      : "del mes";

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
 * la cobertura real del plan para que un plan creado a media de mes muestre
 * los días correctos. El "de N" deja claro, sobre todo con semanal/bisemanal,
 * que cada tramo es una lista distinta y no un trozo de la misma.
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
 * Reparte el `trip` de una lista ya hecha según la cadencia, sin volver a llamar
 * a la IA: la despensa (no perecedero) va a la primera compra y los frescos se
 * reparten por igual entre las compras para que nada se eche a perder. Es lo que
 * permite cambiar de cadencia al instante y sin errores.
 */
export const repartitionTrips = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
): ShoppingList => {
  const trips = tripsOfCadence(cadence);
  let freshIndex = 0;
  return (shopping ?? []).map((group) => ({
    category: group.category,
    items: group.items.map((item) => {
      if (trips === 1 || !item.perishable) return { ...item, trip: 0 };
      const trip = freshIndex % trips;
      freshIndex += 1;
      return { ...item, trip };
    }),
  }));
};

/**
 * Agrupa la lista por compra, conservando categorías. `trips` debe venir de la
 * cadencia (`tripsOfCadence`), no de escanear los datos: si un tramo se queda
 * sin artículos (p. ej. pocos frescos repartidos entre muchas compras), sigue
 * apareciendo vacío en vez de desaparecer — si no, "semana 4 de 4" podía faltar
 * sin más cuando esa semana no tenía nada asignado.
 */
export const groupByTrip = (shopping: ShoppingList | null | undefined, trips: number) =>
  Array.from({ length: Math.max(1, trips) }, (_, t) => ({
    trip: t,
    groups: (shopping ?? [])
      .map((g) => ({ category: g.category, items: g.items.filter((i) => i.trip === t) }))
      .filter((g) => g.items.length),
  }));

/**
 * Reaplica el estado `owned` de una lista de la compra a otra recién repartida,
 * emparejando por NOMBRE de ingrediente (no por name + trip). Cambiar de
 * cadencia rehace el reparto de `trip` y puede trocear un perecedero en varias
 * filas: si el emparejamiento fuese por trip, se perderían todas las marcas. Un
 * ingrediente marcado "en casa" lo está para todo el mes ("no te lo volveré a
 * pedir mientras te dure") y lo ya comprado sigue comprado, así que si tenía
 * alguna fila `owned` en la lista previa, todas sus filas nuevas quedan `owned`
 * ("fridge" gana a "store").
 */
export const carryOwnedByName = (
  prev: ShoppingList | null | undefined,
  next: ShoppingList,
): ShoppingList => {
  const byName = new Map<string, "fridge" | "store">();
  for (const group of prev ?? []) {
    for (const item of group.items) {
      if (!item.owned) continue;
      const key = normName(item.name);
      if (item.owned === "fridge" || !byName.has(key)) byName.set(key, item.owned);
    }
  }
  if (!byName.size) return next;
  return next.map((group) => ({
    category: group.category,
    items: group.items.map((item) => {
      const carried = byName.get(normName(item.name));
      return carried ? { ...item, owned: carried } : item;
    }),
  }));
};

const asItem = (raw: unknown): ShoppingItem | null => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name) return null;
  const price = Number(o.price_eur);
  const trip = Number(o.trip);
  // Compatible con datos antiguos donde "owned" era un booleano sin origen:
  // se trata como "fridge" para no perder la marca ya guardada.
  const owned = o.owned === "store" ? "store" : o.owned ? "fridge" : undefined;
  return {
    name,
    qty: String(o.qty ?? "").trim(),
    price_eur: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
    trip: Number.isFinite(trip) && trip > 0 ? Math.min(Math.round(trip), 3) : 0,
    perishable: Boolean(o.perishable),
    ...(owned ? { owned } : {}),
  };
};

export const cleanShopping = (raw: unknown): ShoppingList =>
  (Array.isArray(raw) ? raw : [])
    .slice(0, 8)
    .map((g) => {
      const o = (g ?? {}) as Record<string, unknown>;
      return {
        category: String(o.category ?? "").trim(),
        items: (Array.isArray(o.items) ? o.items : [])
          .map(asItem)
          .filter((i): i is ShoppingItem => Boolean(i)),
      };
    })
    .filter((g) => g.category && g.items.length);

const cleanExtras = (raw: unknown): PlanDay["extras"] => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const entries = MEAL_SLOTS.map(
    (slot) =>
      [
        slot,
        (Array.isArray(o[slot]) ? (o[slot] as unknown[]) : [])
          .map((n) => String(n).trim())
          .filter(Boolean)
          .slice(0, 6),
      ] as const,
  ).filter(([, list]) => list.length);
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const cleanDay = (raw: unknown): PlanDay => {
  const d = (raw ?? {}) as Record<string, unknown>;
  const day: PlanDay = {
    day: String(d.day ?? ""),
    lunch: String(d.lunch ?? ""),
    dinner: String(d.dinner ?? ""),
  };
  const breakfast = String(d.breakfast ?? "").trim();
  const snack = String(d.snack ?? "").trim();
  const extras = cleanExtras(d.extras);
  if (breakfast) day.breakfast = breakfast;
  if (snack) day.snack = snack;
  if (extras) day.extras = extras;
  return day;
};

const cleanCoverage = (raw: unknown): PlanCoverage | undefined => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const fromDay = Number(o.fromDay);
  const toDay = Number(o.toDay);
  if (!Number.isFinite(fromDay) || !Number.isFinite(toDay)) return undefined;
  const from = Math.min(Math.max(Math.round(fromDay), 1), 31);
  const to = Math.min(Math.max(Math.round(toDay), from), 31);
  return { fromDay: from, toDay: to };
};

const cleanCadence = (raw: unknown): ShoppingCadence | undefined =>
  raw === "semanal" || raw === "bisemanal" || raw === "mensual" ? raw : undefined;

export const cleanPlan = (raw: unknown): MonthlyPlan | null => {
  const plan = (raw ?? {}) as Partial<MonthlyPlan>;
  if (!plan.weeks?.length) return null;
  const coverage = cleanCoverage(plan.coverage);
  const cadence = cleanCadence(plan.cadence);
  return {
    intro: String(plan.intro ?? ""),
    focus: (plan.focus ?? []).slice(0, 4).map(String),
    weeks: plan.weeks.slice(0, 5).map((w) => ({
      label: String(w?.label ?? ""),
      focus: String(w?.focus ?? ""),
      breakfasts: (w?.breakfasts ?? []).slice(0, 3).map(String),
      snacks: (w?.snacks ?? []).slice(0, 3).map(String),
      days: (w?.days ?? []).slice(0, 7).map(cleanDay),
    })),
    ...(coverage ? { coverage } : {}),
    ...(cadence ? { cadence } : {}),
  };
};

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

export const ingredientNames = (shopping: ShoppingList) =>
  shopping.flatMap((g) => g.items.map((i) => i.name)).join(", ");

export const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/** Extrae el primer objeto JSON de una respuesta, tolerando ```json, texto alrededor y cortes. */
export const parseJsonLoose = (raw: string): unknown => {
  const text = String(raw ?? "")
    .replace(/```json/gi, "")
    .replace(/```/g, "");
  const start = text.indexOf("{");
  if (start < 0) return null;

  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(text.slice(start, text.lastIndexOf("}") + 1));
  if (direct !== undefined) return direct;

  // Recorre equilibrando llaves/corchetes; si la respuesta quedó cortada, la cierra.
  let depth = 0;
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
      depth++;
    } else if (c === "}" || c === "]") {
      stack.pop();
      depth--;
      if (depth === 0) {
        const done = tryParse(text.slice(start, i + 1));
        if (done !== undefined) return done;
      }
    }
  }

  // Cierre de emergencia de un JSON truncado.
  let candidate = text.slice(start).replace(/,\s*$/, "");
  if (inString) candidate += '"';
  for (let i = stack.length - 1; i >= 0; i--) candidate += stack[i];
  const repaired = tryParse(candidate);
  return repaired === undefined ? null : repaired;
};

/** Rellena huecos del plan (semanas y días que falten) reutilizando lo que sí generó la IA. */
export const completePlan = (plan: MonthlyPlan | null): MonthlyPlan | null => {
  if (!plan) return null;
  const sourceDays = plan.weeks.flatMap((w) => w.days).filter((d) => d.lunch || d.dinner);
  if (!sourceDays.length) return null;

  const pick = (i: number) => sourceDays[i % sourceDays.length]!;
  let cursor = 0;

  const weeks = Array.from({ length: 4 }, (_, wi) => {
    const base = plan.weeks[wi] ?? plan.weeks[plan.weeks.length - 1]!;
    const days = DAY_NAMES.map((name, di) => {
      const existing = base.days[di];
      if (existing && existing.lunch && existing.dinner) {
        return { ...existing, day: existing.day || name };
      }
      const fill = pick(cursor++);
      return {
        ...(existing ?? {}),
        day: existing?.day || name,
        lunch: existing?.lunch || fill.lunch || fill.dinner,
        dinner: existing?.dinner || fill.dinner || fill.lunch,
      };
    });
    const fallbackBreakfasts = plan.weeks.flatMap((w) => w.breakfasts).filter(Boolean);
    const fallbackSnacks = plan.weeks.flatMap((w) => w.snacks).filter(Boolean);
    return {
      label: base.label || `Semana ${wi + 1}`,
      focus: base.focus || plan.focus[0] || "",
      breakfasts: base.breakfasts.length ? base.breakfasts : fallbackBreakfasts.slice(0, 2),
      snacks: base.snacks.length ? base.snacks : fallbackSnacks.slice(0, 2),
      days,
    };
  });

  return {
    intro: plan.intro || "Este mes vamos paso a paso, con comidas sencillas y sin presiones.",
    focus: plan.focus.length
      ? plan.focus
      : ["Comidas sencillas", "Verdura a diario", "Moverte cada día"],
    weeks,
    ...(plan.coverage ? { coverage: plan.coverage } : {}),
    ...(plan.cadence ? { cadence: plan.cadence } : {}),
  };
};

const normDay = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/** Posición de una fecha dentro del plan (semana 0-3, día 0-6 lunes→domingo). */
export const planCursor = (date: string) => {
  const dayOfMonth = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.max(Math.floor((dayOfMonth - 1) / 7), 0), 3);
  const jsDay = new Date(`${date}T00:00:00`).getDay();
  const dayIndex = (jsDay + 6) % 7;
  return { weekIndex, dayIndex, dayName: DAY_NAMES[dayIndex] ?? "Lunes" };
};

/**
 * Conserva el pasado y el día de hoy del plan actual y sólo adopta del plan nuevo
 * los días posteriores al cursor: el día en curso ya está fijado.
 */
export const mergeFuturePlan = (
  current: MonthlyPlan,
  next: MonthlyPlan,
  cursor: { weekIndex: number; dayIndex: number },
): MonthlyPlan => ({
  ...(current.coverage ? { coverage: current.coverage } : {}),
  ...(current.cadence ? { cadence: current.cadence } : {}),
  intro: next.intro || current.intro,
  focus: next.focus.length ? next.focus : current.focus,
  weeks: current.weeks.map((week, wi) => {
    const fresh = next.weeks[wi];
    if (!fresh || wi < cursor.weekIndex) return week;
    const future = wi > cursor.weekIndex;
    return {
      label: week.label,
      focus: future ? fresh.focus || week.focus : week.focus,
      breakfasts: future && fresh.breakfasts.length ? fresh.breakfasts : week.breakfasts,
      snacks: future && fresh.snacks.length ? fresh.snacks : week.snacks,
      days: week.days.map((day, di) => {
        if (!future && di <= cursor.dayIndex) return day;
        const freshDay =
          fresh.days.find((d) => normDay(d.day) === normDay(day.day)) ?? fresh.days[di];
        if (!freshDay?.lunch && !freshDay?.dinner) return day;
        // El spread conserva breakfast/snack/extras: un plato pedido a mano
        // manda sobre la recolocación automática hasta que se cambie a mano
        // otra vez (la IA sólo devuelve lunch/dinner por día).
        return {
          ...day,
          lunch: freshDay.lunch || day.lunch,
          dinner: freshDay.dinner || day.dinner,
        };
      }),
    };
  }),
});

const DIA_NOMBRES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

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

/** Aviso corto para pantalla cuando un plato lleva algo que no se compró. */
export const offListNote = (names: string[] | undefined) =>
  names?.length ? `Fuera de tu compra: ${names.join(", ")}` : null;

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
 * Lo que el coach necesita saber del plan en cada mensaje: qué hay comprado
 * (para proponer platos con eso) y qué menú tienen los próximos días (para
 * saber qué está sustituyendo cuando le piden cambiar un plato).
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

/** Texto plano de los ingredientes del mes, listo para compartir o descargar. */
export const shoppingToText = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  month: string,
  coverage?: PlanCoverage,
) => {
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const lines = [`Ingredientes del mes · ${monthLabel}`, `Frecuencia: ${cadence}`, ""];
  const trips = tripsOfCadence(cadence);
  for (const trip of groupByTrip(shopping, trips)) {
    lines.push(
      `${tripLabel(cadence, trip.trip, coverage, trips)} — ${eur(pendingTotal(trip.groups))}`,
    );
    for (const group of trip.groups) {
      lines.push(`  ${group.category}`);
      for (const item of group.items) {
        const qty = item.qty ? ` (${item.qty})` : "";
        lines.push(`   - ${item.name}${qty} — ${eur(item.price_eur)}`);
      }
    }
    lines.push("");
  }
  lines.push(`Total del mes: ${eur(shoppingTotal(shopping))}`);
  return lines.join("\n");
};

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
