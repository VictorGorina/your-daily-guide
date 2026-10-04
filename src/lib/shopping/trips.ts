import type { PlanCoverage } from "../plan/types";
import {
  formatShoppingQty,
  isCanonicalShopping,
  normName,
  type ShoppingCadence,
  type ShoppingItem,
  type ShoppingList,
  tripsForCoverage,
  tripsOfCadence,
  WEEK_COUNT,
} from "./model";
import { shelfLifeDays } from "./shelf-life";

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

/**
 * Mini gráfico del reparto del mes: una barra por compra. `days` es cuántos
 * días cubre (el ancho) y `pct` cuánto cuesta frente a la compra más cara del
 * mes, de 0 a 100 (el alto). Sale de los euros de cada compra, así que la
 * optimizada enseña una primera barra alta y las demás bajas.
 */
export const tripSpendBars = (
  trips: { groups: { items: { price_eur?: number }[] }[] }[],
  coverage: PlanCoverage,
): { days: number; pct: number }[] => {
  const totals = trips.map((t) =>
    t.groups.reduce(
      (sum, g) => sum + g.items.reduce((s, i) => s + (Number(i.price_eur) || 0), 0),
      0,
    ),
  );
  const max = Math.max(0, ...totals);
  return totals.map((total, i) => {
    const { from, to } = tripDayRange(coverage, trips.length, i);
    return { days: to - from + 1, pct: max > 0 ? Math.round((total / max) * 100) : 0 };
  });
};

/** A quién se refiere cada tramo de ingredientes, en palabras, según la cadencia. */
export const cadenceScopeLabel = (cadence: ShoppingCadence) =>
  cadence === "semanal"
    ? "de la semana"
    : cadence === "bisemanal"
      ? "de las dos semanas"
      : cadence === "optimizada"
        ? "de la compra"
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
 * Compra desde la que rige la cadencia optimizada cuando se elige con el mes
 * ya empezado: la que toca hoy (la primera que no ha pasado). Las anteriores
 * se quedan con lo de su semana, que es lo que ya se compró. Se guarda en
 * `MonthlyPlan.cadenceFrom` al cambiar de cadencia y no se mueve con los días.
 */
export const stockUpStart = (
  trips: number,
  todayDayOfMonth: number,
  coverage: PlanCoverage = FULL_MONTH_COVERAGE,
): number => {
  const count = Math.max(1, trips);
  for (let t = 0; t < count; t++) {
    if (tripTiming(count, t, todayDayOfMonth, coverage) !== "past") return t;
  }
  return count - 1;
};

/**
 * Etiqueta legible de cada tramo de ingredientes con los días que comprende
 * (ej. "Ingredientes de la semana 2 de 4 · días 8-14"), calculada a partir de
 * la cobertura real del plan para que un plan creado a media de mes muestre
 * los días correctos. El "de N" deja claro, sobre todo con semanal/bisemanal,
 * que cada tramo es una lista distinta y no un trozo de la misma.
 *
 * Solo la cadencia semanal habla de "semana": una compra bisemanal no lo es, y
 * cuando el plan cubre tan pocos días que la cadencia se resuelve en una sola
 * compra, un "1 de 1" sobra.
 */
export const tripLabel = (
  cadence: ShoppingCadence,
  trip: number,
  coverage: PlanCoverage = FULL_MONTH_COVERAGE,
  trips = tripsForCoverage(cadence, coverage),
) => {
  const { from, to } = tripDayRange(coverage, trips, trip);
  const unit = cadence === "semanal" ? "semana" : "compra";
  const prefix =
    cadence === "mensual"
      ? "Ingredientes del mes"
      : trips <= 1
        ? "Ingredientes"
        : `Ingredientes de la ${unit} ${trip + 1} de ${trips}`;
  return `${prefix} · días ${from}-${to}`;
};

/**
 * Reparte el `trip` de una lista ya hecha según la cadencia, sin volver a llamar
 * a la IA: la despensa (no perecedero) va a la primera compra y los frescos se
 * reparten por igual entre las compras para que nada se eche a perder. Es lo que
 * permite cambiar de cadencia al instante y sin errores.
 *
 * `trips` tiene que ser el MISMO número que luego pinta la pantalla
 * (`tripsForCoverage`): `groupByTrip` solo muestra los tramos 0..trips-1, así
 * que repartir entre más compras de las que se van a enseñar hace desaparecer
 * de la lista los artículos que caigan en las de más.
 */
export const repartitionTrips = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  tripCount?: number,
): ShoppingList => {
  const trips = Math.max(1, tripCount ?? tripsOfCadence(cadence));
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

export type TripGroups = {
  trip: number;
  groups: { category: string; items: ShoppingItem[] }[];
};

/** Semana del plan (0..weekCount-1) en la que cae un día del mes. */
const weekOfDay = (day: number, weekCount: number) =>
  Math.min(Math.max(Math.floor((day - 1) / 7), 0), Math.max(1, weekCount) - 1);

/**
 * Cuántos días cubiertos por el plan caen en cada semana. La última "semana"
 * de un mes de 30-31 días arrastra 9-10 días (no 7), así que repartir la
 * cantidad de esa semana a partes iguales entre SUS días —y no siempre entre
 * 7— es lo que hace que cada compra sume exactamente lo suyo y Σ compras =
 * total del mes.
 */
export const weekDayCounts = (coverage: PlanCoverage, weekCount: number): number[] => {
  const counts = new Array(Math.max(1, weekCount)).fill(0);
  for (let d = coverage.fromDay; d <= coverage.toDay; d++) counts[weekOfDay(d, weekCount)] += 1;
  return counts;
};

type TripAmount = { qty: number; price: number };
type DayRange = { from: number; to: number };

/**
 * Cadencia optimizada: quién compra lo de cada tramo. Cada compra se lleva de
 * un ingrediente lo de los tramos siguientes mientras aguante (comprado el día
 * `from`, dura hasta `from + shelf`); cuando ya no llega, compra el tramo al
 * que le toca. Así lo que no caduca entra entero en la primera compra, un
 * fresco de pocos días se compra cada semana y uno de vida media (huevos,
 * zanahoria) cada dos. Solo mueve cantidades entre compras: Σ no cambia.
 *
 * Un fresco no se compra antes de la primera semana que lo usa; lo que no
 * caduca va siempre a la primera compra, que es la de llenar la despensa.
 */
export const stockUpAmounts = (
  amounts: TripAmount[],
  ranges: DayRange[],
  shelf: number,
): TripAmount[] => {
  const out = amounts.map(() => ({ qty: 0, price: 0 }));
  let buyer = 0;
  for (let t = 0; t < amounts.length; t++) {
    const idle = Number.isFinite(shelf) && out[buyer]!.qty <= 0.0001;
    if (idle || ranges[t]!.to - ranges[buyer]!.from > shelf) buyer = t;
    out[buyer]!.qty += amounts[t]!.qty;
    out[buyer]!.price += amounts[t]!.price;
  }
  return out;
};

/**
 * Proyecta la lista canónica sobre las compras de una cadencia: para cada
 * compra suma, ingrediente a ingrediente, la parte de `weekQty`/`weekPrice` de
 * los días que esa compra cubre (rango de `tripDayRange`). El resultado es la
 * forma que consume la UI — una fila por compra con `qty`/`price_eur` ya
 * recortados y `owned` resuelto para ese `trip`.
 *
 * Con la cadencia optimizada, esas mismas cantidades se adelantan a la compra
 * que puede llevárselas sin que se estropeen (`stockUpAmounts`). Si se eligió
 * a mitad de mes, solo desde la compra `stockUpFrom` (`plan.cadenceFrom`): las
 * anteriores ya pasaron y se quedan con lo de su semana, o la despensa del
 * resto del mes caería en una compra que ya no se va a hacer.
 *
 * Una lista antigua (sin `weekQty`) no se puede recalcular: se cae al reparto
 * de siempre (`groupByTrip`), que respeta el `trip` que ya trae cada fila.
 */
export const projectTrips = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  coverage: PlanCoverage,
  weekCount: number = WEEK_COUNT,
  stockUpFrom = 0,
): TripGroups[] => {
  const trips = tripsForCoverage(cadence, coverage);
  if (!isCanonicalShopping(shopping)) return groupByTrip(shopping, trips);

  const wc = Math.max(1, weekCount);
  const counts = weekDayCounts(coverage, wc);
  const ranges = Array.from({ length: Math.max(1, trips) }, (_, t) =>
    tripDayRange(coverage, trips, t),
  );
  const start = Math.min(Math.max(0, Math.floor(stockUpFrom) || 0), ranges.length - 1);

  // Por ingrediente, lo que lleva cada compra; después se le da la vuelta.
  const rows = (shopping ?? []).map((group) => ({
    category: group.category,
    items: group.items.map((item) => {
      // Fila antigua colada en una lista canónica: se queda en su propia compra.
      if (!Array.isArray(item.weekQty))
        return ranges.map((_, t) => (item.trip === t ? item : null));
      const needs = ranges.map((range) => tripAmount(item, range, wc, counts));
      const amounts =
        cadence === "optimizada"
          ? [
              ...needs.slice(0, start),
              ...stockUpAmounts(
                needs.slice(start),
                ranges.slice(start),
                shelfLifeDays(item.name, group.category, item.perishable),
              ),
            ]
          : needs;
      return amounts.map((amount, t) => projectedRow(item, amount, t));
    }),
  }));

  return ranges.map((_, t) => ({
    trip: t,
    groups: rows
      .map((group) => ({
        category: group.category,
        items: group.items.map((perTrip) => perTrip[t]).filter((i): i is ShoppingItem => !!i),
      }))
      .filter((group) => group.items.length),
  }));
};

/** Lo que piden de un ingrediente los días `from`-`to`, según su `weekQty`. */
const tripAmount = (
  item: ShoppingItem,
  { from, to }: DayRange,
  weekCount: number,
  weekDays: number[],
): TripAmount => {
  const weekQty = item.weekQty ?? [];
  const weekPrice = item.weekPrice ?? [];
  let qty = 0;
  let price = 0;
  for (let d = from; d <= to; d++) {
    const w = weekOfDay(d, weekCount);
    const share = weekDays[w] || 1;
    qty += (weekQty[w] ?? 0) / share;
    price += (weekPrice[w] ?? 0) / share;
  }
  return { qty, price };
};

const projectedRow = (
  item: ShoppingItem,
  { qty, price }: TripAmount,
  trip: number,
): ShoppingItem | null => {
  if (qty <= 0.0001) return null;

  const unit = item.unit ?? "ud";
  const source = item.ownedTrips?.[trip];
  return {
    name: item.name,
    qty: formatShoppingQty(item.name, qty, unit),
    qtyValue: Math.round(qty * 100) / 100,
    price_eur: Math.round(price * 100) / 100,
    trip,
    perishable: item.perishable,
    unit,
    ...(source ? { owned: source } : {}),
  };
};

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

/**
 * Clave para casar el mismo ingrediente entre dos listas cuando la IA ha podido
 * reescribir el nombre en el camino: `normName` + singular aproximado (quita la
 * "s" final, "patatas" → "patata", "tomates" → "tomate"). Se queda corta con
 * plurales en "-es" de consonante ("champiñones"), pero el fallo es benigno —
 * una marca que no se traspasa, nunca una de más — así que no merece un
 * stemmer. Solo la usa `carryOwnedCanonical`.
 */
const ownedMatchKey = (name: string) => normName(name).replace(/s$/, "");

/**
 * Como `carryOwnedByName` pero para la forma canónica: además del `owned`
 * legacy conserva `ownedTrips` (marcas "en casa"/"comprado" por compra). Lo usa
 * el recálculo automático (issue 05): cuando entra o sale alguien de la mesa la
 * lista de la compra se regenera con cantidades (y nombres) nuevos, pero lo que
 * la persona ya había marcado sigue marcado. Casa por `ownedMatchKey`; "fridge"
 * gana a "store" si un mismo ingrediente traía las dos.
 */
export const carryOwnedCanonical = (
  prev: ShoppingList | null | undefined,
  next: ShoppingList,
): ShoppingList => {
  const legacyByName = new Map<string, "fridge" | "store">();
  const tripsByName = new Map<string, Record<number, "fridge" | "store">>();
  for (const group of prev ?? []) {
    for (const item of group.items) {
      const key = ownedMatchKey(item.name);
      if (item.owned && (item.owned === "fridge" || !legacyByName.has(key))) {
        legacyByName.set(key, item.owned);
      }
      for (const [rawTrip, source] of Object.entries(item.ownedTrips ?? {})) {
        const trip = Number(rawTrip);
        if (!Number.isFinite(trip) || (source !== "fridge" && source !== "store")) continue;
        const acc = tripsByName.get(key) ?? {};
        if (source === "fridge" || !acc[trip]) acc[trip] = source;
        tripsByName.set(key, acc);
      }
    }
  }
  if (!legacyByName.size && !tripsByName.size) return next;
  return next.map((group) => ({
    category: group.category,
    items: group.items.map((item) => {
      const key = ownedMatchKey(item.name);
      const legacy = legacyByName.get(key);
      const trips = tripsByName.get(key);
      if (!legacy && !trips) return item;
      const out: ShoppingItem = { ...item };
      if (legacy) out.owned = legacy;
      if (trips) out.ownedTrips = { ...(item.ownedTrips ?? {}), ...trips };
      return out;
    }),
  }));
};
