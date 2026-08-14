export type MonthlyPlan = {
  intro: string;
  focus: string[];
  weeks: {
    label: string;
    focus: string;
    breakfasts: string[];
    snacks: string[];
    days: { day: string; lunch: string; dinner: string }[];
  }[];
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
  /** Compra a la que pertenece (0 = primera). */
  trip: number;
  /** Alimento fresco (poca vida útil). */
  perishable: boolean;
};
export type ShoppingList = { category: string; items: ShoppingItem[] }[];

export const tripCount = (shopping: ShoppingList | null | undefined) =>
  Math.max(1, ...((shopping ?? []).flatMap((g) => g.items.map((i) => i.trip + 1)) || [1]));

export const cadenceOf = (shopping: ShoppingList | null | undefined): ShoppingCadence => {
  const trips = tripCount(shopping);
  return trips >= 4 ? "semanal" : trips >= 2 ? "bisemanal" : "mensual";
};

export const tripsOfCadence = (cadence: ShoppingCadence) =>
  CADENCES.find((c) => c.key === cadence)?.trips ?? 1;

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

const asItem = (raw: unknown): ShoppingItem | null => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name) return null;
  const price = Number(o.price_eur);
  const trip = Number(o.trip);
  return {
    name,
    qty: String(o.qty ?? "").trim(),
    price_eur: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
    trip: Number.isFinite(trip) && trip > 0 ? Math.min(Math.round(trip), 3) : 0,
    perishable: Boolean(o.perishable),
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

export const cleanPlan = (raw: unknown): MonthlyPlan | null => {
  const plan = (raw ?? {}) as Partial<MonthlyPlan>;
  if (!plan.weeks?.length) return null;
  return {
    intro: String(plan.intro ?? ""),
    focus: (plan.focus ?? []).slice(0, 4).map(String),
    weeks: plan.weeks.slice(0, 5).map((w) => ({
      label: String(w?.label ?? ""),
      focus: String(w?.focus ?? ""),
      breakfasts: (w?.breakfasts ?? []).slice(0, 3).map(String),
      snacks: (w?.snacks ?? []).slice(0, 3).map(String),
      days: (w?.days ?? []).slice(0, 7).map((d) => ({
        day: String(d?.day ?? ""),
        lunch: String(d?.lunch ?? ""),
        dinner: String(d?.dinner ?? ""),
      })),
    })),
  };
};

export const shoppingTotal = (shopping: ShoppingList | null | undefined) =>
  Math.round(
    (shopping ?? []).reduce(
      (sum, g) => sum + g.items.reduce((s, i) => s + (Number(i.price_eur) || 0), 0),
      0,
    ) * 100,
  ) / 100;

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
        return { day: existing.day || name, lunch: existing.lunch, dinner: existing.dinner };
      }
      const fill = pick(cursor++);
      return {
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
        return {
          day: day.day,
          lunch: freshDay.lunch || day.lunch,
          dinner: freshDay.dinner || day.dinner,
        };
      }),
    };
  }),
});

const DIA_NOMBRES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Platos del plan mensual para una fecha concreta (YYYY-MM-DD). */
export function planForDate(plan: MonthlyPlan | null, date: string) {
  if (!plan?.weeks?.length) return null;
  const day = Number(date.slice(8, 10));
  const weekIndex = Math.min(Math.floor((day - 1) / 7), plan.weeks.length - 1);
  const week = plan.weeks[weekIndex];
  if (!week) return null;
  const jsDay = new Date(`${date}T00:00:00`).getDay();
  const weekdayName = normDay(DIA_NOMBRES[jsDay] ?? "");
  const match =
    week.days.find((d) => normDay(d.day).includes(weekdayName)) ??
    week.days[(jsDay + 6) % 7] ??
    null;
  return { week, day: match };
}

/** Texto plano de la lista de la compra, listo para compartir o descargar. */
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
