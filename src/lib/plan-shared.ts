import { upcomingMeals } from "./plan/compensation";
import type { MonthlyPlan, PlanCoverage } from "./plan/types";
import { eur, pendingTotal, shoppingTotal } from "./shopping/clean";
import {
  daysInMonth,
  type PantryExtra,
  type ShoppingCadence,
  type ShoppingItem,
  type ShoppingList,
  tripsForCoverage,
} from "./shopping/model";
import { projectTrips, tripLabel } from "./shopping/trips";

export * from "./plan/slots";
export * from "./plan/types";
export * from "./shopping/model";
export * from "./shopping/state";
export * from "./plan/month";
export * from "./shopping/trips";
export * from "./shopping/clean";
export * from "./plan/grid";
export * from "./plan/parse";
export * from "./plan/constraints";
export * from "./plan/habits";
export * from "./plan/merge";
export * from "./plan/compensation";
export * from "./plan/fit-mark";
export * from "./plan/household";

/** Aviso corto para pantalla cuando un plato lleva algo que no se compró. */
export const offListNote = (names: string[] | undefined) =>
  names?.length ? `Fuera de tu compra: ${names.join(", ")}` : null;

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
  const cov = coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const trips = tripsForCoverage(cadence, cov);
  for (const trip of projectTrips(shopping, cadence, cov)) {
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
