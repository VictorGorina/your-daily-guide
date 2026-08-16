/**
 * Subconjunto de `src/lib/plan-shared.ts` de la web que necesita la pantalla
 * Hoy: leer del plan mensual las comidas de una fecha. Es una copia, no código
 * compartido (ver AGENTS.md). Cuando se porte la pantalla Plan se traerá el
 * resto (lista de la compra, cadencias, merge de planes...).
 */

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

export type ShoppingItem = {
  name: string;
  qty: string;
  price_eur: number;
  /** Compra a la que pertenece (0 = primera). */
  trip: number;
  /** Alimento fresco (poca vida útil). */
  perishable: boolean;
};

/** Lista de la compra tal como la guarda el plan mensual. */
export type ShoppingList = { category: string; items: ShoppingItem[] }[];

export const tripCount = (shopping: ShoppingList | null | undefined) =>
  Math.max(1, ...((shopping ?? []).flatMap((g) => g.items.map((i) => i.trip + 1)) || [1]));

export const cadenceOf = (shopping: ShoppingList | null | undefined): ShoppingCadence => {
  const trips = tripCount(shopping);
  return trips >= 4 ? "semanal" : trips >= 2 ? "bisemanal" : "mensual";
};

/** Etiqueta legible de cada compra según la cadencia (ej. "Compra 2 · días 8-14"). */
export const tripLabel = (cadence: ShoppingCadence, trip: number) => {
  if (cadence === "mensual") return "Compra del mes";
  const span = cadence === "semanal" ? 7 : 14;
  const from = trip * span + 1;
  const to = trip * span + span;
  return `Compra ${trip + 1} · días ${from}-${to}`;
};

/** Agrupa la lista por compra, conservando categorías. */
export const groupByTrip = (shopping: ShoppingList | null | undefined) => {
  const trips = tripCount(shopping);
  return Array.from({ length: trips }, (_, t) => ({
    trip: t,
    groups: (shopping ?? [])
      .map((g) => ({ category: g.category, items: g.items.filter((i) => i.trip === t) }))
      .filter((g) => g.items.length),
  })).filter((t) => t.groups.length);
};

export const shoppingTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round(
    (shopping ?? []).reduce(
      (sum, g) => sum + g.items.reduce((s, i) => s + (Number(i.price_eur) || 0), 0),
      0,
    ) * 100,
  ) / 100;

export const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** La lista de la compra como texto plano, para compartir/copiar/exportar. */
export const shoppingToText = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  month: string,
) => {
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const lines = [`Lista de la compra · ${monthLabel}`, `Frecuencia: ${cadence}`, ""];
  for (const trip of groupByTrip(shopping)) {
    lines.push(`${tripLabel(cadence, trip.trip)} — ${eur(shoppingTotal(trip.groups))}`);
    for (const group of trip.groups) {
      lines.push(`  ${group.category}`);
      for (const item of group.items) {
        const qty = item.qty ? ` (${item.qty})` : "";
        const fresh = item.perishable ? " · fresco" : "";
        lines.push(`   - ${item.name}${qty}${fresh} — ${eur(item.price_eur)}`);
      }
    }
    lines.push("");
  }
  lines.push(`Total del mes: ${eur(shoppingTotal(shopping))}`);
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
    | { plan: MonthlyPlan | null; shopping: ShoppingList | null; confirmed_at: string | null }
    | null
    | undefined,
  today: string,
) {
  if (!row?.plan) return { compra: null, proximos: [] };
  return {
    compra: {
      confirmada: Boolean(row.confirmed_at),
      ingredientes: (row.shopping ?? []).flatMap((g) => g.items.map((i) => i.name)),
    },
    proximos: upcomingMeals(row.plan, today),
  };
}
