import type { PlanCoverage } from "../plan/types";
import {
  formatShoppingQty,
  type QtyUnit,
  type ShoppingItem,
  type ShoppingList,
  WEEK_COUNT,
} from "./model";

/**
 * La compra tiene que dejar cocinar cada plato del plan (decisión del usuario,
 * 2026-10-27: "no puedo cocinar un plato si no tengo los ingredientes"). La IA
 * escribe los platos y la lista en la misma respuesta y nada comprobaba que
 * casaran: en octubre de 2026 la pera salía en cinco comidas sin estar en la
 * lista, y la crema de calabacín de los días 18 y 21 caía en una semana con 0 g.
 *
 * Aquí, puro, con lo que piden los platos de cada día (de sus recetas, ver
 * `coverage.server.ts`):
 *
 * 1. Se repara la lista UNA vez al hacer el plan: se añade lo que falta y se sube
 *    la semana que se queda corta. Solo en días cuya compra aún no se ha hecho
 *    (`editable`): lo ya comprado es un hecho.
 * 2. Se reparte cada semana entre los días que de verdad la usan (`dayQty`), así
 *    cada compra lleva lo de sus días. Sin esto, el calabacín del día 27 dejaba
 *    un tercio en la compra de los días 17-24.
 *
 * Σ por semana no cambia en el paso 2, y en el 1 solo crece.
 */

/** Lo que pide un plato un día del mes: gramos de un ingrediente, por familia. */
export type DishNeed = { day: number; family: string; grams: number };

/** Lo que el servidor sabe de cada artículo y de cada familia (tabla de alimentos). */
export type CoverageReader = {
  /** Familia de un artículo de la lista por su nombre; `null` si no se reconoce. */
  familyOfItem: (name: string) => string | null;
  /** Gramos que son `qty` en la unidad del artículo; `null` si no se sabe convertir. */
  gramsOf: (name: string, unit: QtyUnit, qty: number) => number | null;
  /** Artículo nuevo para una familia que falta; `null` si no se sabe cuál comprar. */
  newItem: (
    family: string,
  ) => { name: string; category: string; eurPerGram: number; perishable: boolean } | null;
};

export type CoverageResult = {
  shopping: ShoppingList;
  /** Ingredientes que no estaban en la lista y se han añadido. */
  added: string[];
  /** Ingredientes que estaban y se han subido en alguna semana. */
  raised: string[];
  /** Faltan en días cuya compra ya se hizo: no se pueden arreglar. */
  late: string[];
};

/** Por debajo de esto (g por semana) un ingrediente es un pellizco, no una compra. */
export const MIN_WEEK_GRAMS = 10;
/** La lista se queda corta si tiene menos de esta parte de lo que piden los platos. */
export const SHORT_SHARE = 0.6;

const weekIndexOf = (day: number) =>
  Math.min(Math.max(Math.floor((day - 1) / 7), 0), WEEK_COUNT - 1);

const sum = (list: readonly number[]) => list.reduce((acc, n) => acc + n, 0);

export function checkShopping(opts: {
  shopping: ShoppingList;
  needs: readonly DishNeed[];
  coverage: PlanCoverage;
  daysInMonth: number;
  /**
   * ¿Se puede tocar lo que compra este día? Su compra no ha empezado ni tiene
   * marcas. `stocks`: el artículo se compra de una vez (cadencia optimizada), y
   * entonces cuenta la compra que llena la despensa, no la de ese día.
   */
  editable: (day: number, stocks: boolean) => boolean;
  /** ¿Se compra de una vez? (`stocksUp`), para `editable`. */
  stocksUp: (item: Pick<ShoppingItem, "name" | "perishable">, category: string) => boolean;
  /** Familias que la persona ya tiene en casa (despensa extra): no se compran. */
  pantry: ReadonlySet<string>;
  reader: CoverageReader;
}): CoverageResult {
  const { coverage, daysInMonth: last, reader } = opts;
  const groups = opts.shopping.map((g) => ({ category: g.category, items: [...g.items] }));
  const none: CoverageResult = { shopping: opts.shopping, added: [], raised: [], late: [] };
  if (!groups.some((g) => g.items.some((i) => Array.isArray(i.weekQty)))) return none;

  const covered = (day: number) => day >= coverage.fromDay && day <= Math.min(coverage.toDay, last);
  const daysOfWeek = (w: number) =>
    Array.from({ length: last }, (_, i) => i + 1).filter((d) => weekIndexOf(d) === w && covered(d));
  // Lo que enseñaba cada día antes de tocar nada: un día que ya no se puede
  // tocar lo conserva tal cual (su `dayQty`, o su parte de la semana).
  const shownBefore = new Map<string, (day: number) => number>();
  for (const group of groups) {
    for (const item of group.items) {
      if (!Array.isArray(item.weekQty) || shownBefore.has(item.name)) continue;
      const { weekQty, dayQty } = item;
      shownBefore.set(item.name, (day) =>
        dayQty
          ? (dayQty[day - 1] ?? 0)
          : (weekQty[weekIndexOf(day)] ?? 0) / Math.max(1, daysOfWeek(weekIndexOf(day)).length),
      );
    }
  }

  // Lo que pide cada familia, día a día (índice = día − 1).
  const needOf = new Map<string, number[]>();
  for (const need of opts.needs) {
    if (!covered(need.day) || !(need.grams > 0)) continue;
    const days = needOf.get(need.family) ?? Array.from({ length: last }, () => 0);
    days[need.day - 1]! += need.grams;
    needOf.set(need.family, days);
  }

  // El primer artículo canónico de cada familia es el que se sube.
  const itemAt = new Map<string, { g: number; i: number }>();
  groups.forEach((group, g) =>
    group.items.forEach((item, i) => {
      if (!Array.isArray(item.weekQty)) return;
      const family = reader.familyOfItem(item.name);
      if (family && !itemAt.has(family)) itemAt.set(family, { g, i });
    }),
  );

  const added: string[] = [];
  const raised: string[] = [];
  const late: string[] = [];

  for (const [family, need] of needOf) {
    if (opts.pantry.has(family)) continue;
    const at = itemAt.get(family);
    const current = at ? groups[at.g]!.items[at.i]! : null;
    // Lo que se compraría si falta: hace falta antes para saber qué compra lo lleva.
    const fresh = current ? null : reader.newItem(family);
    const stocks = current
      ? opts.stocksUp(current, groups[at!.g]!.category)
      : !!fresh && opts.stocksUp(fresh, fresh.category);
    const perGram = current ? reader.gramsOf(current.name, current.unit ?? "ud", 1) : 1;

    // Gramos que faltan en cada semana, solo en días que aún se pueden comprar.
    const addWeek = Array.from({ length: WEEK_COUNT }, () => 0);
    let missedLate = false;
    for (let w = 0; w < WEEK_COUNT; w++) {
      const days = daysOfWeek(w);
      const wanted = sum(days.map((d) => need[d - 1]!));
      if (wanted < MIN_WEEK_GRAMS) continue;
      const weekQty = current?.weekQty?.[w] ?? 0;
      // Sin conversión a gramos solo se sabe si está o no.
      const have = perGram == null ? (weekQty > 0 ? wanted : 0) : weekQty * perGram;
      if (have >= wanted * SHORT_SHARE) continue;
      const open = days.filter((d) => need[d - 1]! > 0 && opts.editable(d, stocks));
      if (!open.length) {
        missedLate = true;
        continue;
      }
      addWeek[w] = Math.min(wanted - have, sum(open.map((d) => need[d - 1]!)));
    }
    if (missedLate && !sum(addWeek)) late.push(current?.name ?? family);
    if (!sum(addWeek)) continue;
    // Falta y no se sabe qué comprar (la familia no tiene alimento en la tabla).
    if (!current && !fresh) {
      late.push(family);
      continue;
    }

    if (current) {
      // Sin conversión, lo que ya pide una semana de las otras.
      const fallback = Math.max(1, ...(current.weekQty ?? []));
      const qtyOfGrams = (grams: number) => (perGram == null ? fallback : grams / perGram);
      const unitPrice = sum(current.weekPrice ?? []) / Math.max(1e-9, sum(current.weekQty ?? []));
      const weekQty = (current.weekQty ?? []).map((q, w) =>
        addWeek[w]! > 0 ? q + qtyOfGrams(addWeek[w]!) : q,
      );
      const weekPrice = (current.weekPrice ?? weekQty.map(() => 0)).map((p, w) =>
        addWeek[w]! > 0 ? p + qtyOfGrams(addWeek[w]!) * unitPrice : p,
      );
      groups[at!.g]!.items[at!.i] = withWeeks(current, weekQty, weekPrice);
      raised.push(current.name);
      continue;
    }

    const { name, category, eurPerGram, perishable } = fresh!;
    const item = withWeeks(
      { name, qty: "", price_eur: 0, trip: 0, perishable, unit: "g" },
      addWeek,
      addWeek.map((grams) => grams * eurPerGram),
    );
    const group = groups.find((g) => g.category === category);
    if (group) group.items.push(item);
    else groups.push({ category, items: [item] });
    added.push(name);
  }

  // Reparto por días de cada semana, entre los días que la usan. Los que ya no
  // se pueden tocar conservan lo que enseñaban: lo de una compra hecha no se mueve.
  for (const group of groups) {
    group.items = group.items.map((item) => {
      if (!Array.isArray(item.weekQty)) return item;
      const family = reader.familyOfItem(item.name);
      const need = family ? needOf.get(family) : undefined;
      if (!need) return item;
      const stocks = opts.stocksUp(item, group.category);
      const before = shownBefore.get(item.name) ?? (() => 0);
      const dayQty = Array.from({ length: last }, () => 0);
      item.weekQty.forEach((total, w) => {
        const days = daysOfWeek(w);
        if (!days.length || !(total > 0)) return;
        const fixed = days.filter((d) => !opts.editable(d, stocks));
        const free = days.filter((d) => opts.editable(d, stocks));
        for (const d of fixed) dayQty[d - 1] = before(d);
        const remainder = Math.max(0, total - sum(fixed.map(before)));
        const weight = sum(free.map((d) => need[d - 1]!));
        for (const d of free) {
          dayQty[d - 1] =
            weight > 0 ? (remainder * need[d - 1]!) / weight : remainder / free.length;
        }
      });
      return { ...item, dayQty };
    });
  }

  return { shopping: groups, added, raised, late };
}

/** El artículo con sus semanas nuevas y el total del mes recalculado. */
function withWeeks(item: ShoppingItem, weekQty: number[], weekPrice: number[]): ShoppingItem {
  const unit = item.unit ?? "ud";
  return {
    ...item,
    unit,
    weekQty,
    weekPrice,
    qty: formatShoppingQty(item.name, sum(weekQty), unit),
    price_eur: Math.round(sum(weekPrice) * 100) / 100,
  };
}
