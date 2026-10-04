import {
  normName,
  type PantryExtra,
  type ShoppingList,
  type TripActuals,
  type TripConfirmations,
} from "./model";

/** Las únicas columnas que `writeShoppingState` puede tocar: el estado de la
 *  compra, que es del hogar. Los platos (`plan`), las cantidades y la cadencia
 *  son solo del planificador (issue 06). */
export const SHOPPING_STATE_COLUMNS: readonly string[] = [
  "shopping",
  "pantry_extras",
  "trip_actuals",
  "trip_receipts",
  "confirmed_trips",
  "confirmed_at",
];

/** Lanza si `patch` toca algo que no sea estado de compra (`SHOPPING_STATE_COLUMNS`). */
export function assertShoppingStateColumns(patch: Record<string, unknown>): void {
  const forbidden = Object.keys(patch).filter((c) => !SHOPPING_STATE_COLUMNS.includes(c));
  if (forbidden.length) {
    throw new Error(`writeShoppingState: columna no permitida (${forbidden.join(", ")})`);
  }
}

/**
 * Pone (`source`) o quita (`null`) la marca de un ingrediente en una compra. La
 * marca es por ingrediente Y compra: en la lista canónica vive en
 * `ownedTrips[trip]`; en una antigua, en el `owned` de la fila de ese `trip`.
 * La lista en sí (cantidades, precio) no cambia.
 */
export function withOwnedMark(
  shopping: ShoppingList,
  itemName: string,
  trip: number,
  source: "fridge" | "store" | null,
): ShoppingList {
  return shopping.map((group) => ({
    category: group.category,
    items: group.items.map((item) => {
      if (item.name !== itemName) return item;
      if (Array.isArray(item.weekQty)) {
        const ownedTrips = { ...(item.ownedTrips ?? {}) };
        if (source) ownedTrips[trip] = source;
        else delete ownedTrips[trip];
        const { ownedTrips: _drop, ...rest } = item;
        return Object.keys(ownedTrips).length ? { ...rest, ownedTrips } : rest;
      }
      if (item.trip !== trip) return item;
      if (!source) {
        const { owned: _owned, ...rest } = item;
        return rest;
      }
      return { ...item, owned: source };
    }),
  }));
}

/**
 * Estado de compra de un tramo, como función de la versión anterior (ticket 21).
 * Las usan igual el servidor (sobre la fila más reciente, con CAS) y la
 * actualización optimista de la pantalla: lo que se ve al instante es lo que se
 * guarda. Ninguna muta la entrada.
 */

/** Gasto real de una compra; `null` lo quita. */
export function withTripActual(
  actuals: TripActuals,
  trip: number,
  amount: number | null,
): TripActuals {
  const next = { ...actuals };
  if (amount == null) delete next[trip];
  else next[trip] = amount;
  return next;
}

/** Tramo fijado en `date`; `null` lo deshace. */
export function withTripConfirmed(
  confirmed: TripConfirmations,
  trip: number,
  date: string | null,
): TripConfirmations {
  const next = { ...confirmed };
  if (date == null) delete next[trip];
  else next[trip] = date;
  return next;
}

/**
 * Añade (o, con `remove`, quita) un ingrediente de la despensa extra. Casa por
 * nombre normalizado (`normName`): añadir uno que ya estaba lo sustituye. Tope
 * de 40, como siempre.
 */
export function withPantryExtra(
  extras: readonly PantryExtra[],
  entry: { name: string; qty?: string; remove?: boolean },
  addedAt: string,
): PantryExtra[] {
  const key = normName(entry.name);
  const withoutIt = extras.filter((e) => normName(e.name) !== key);
  if (entry.remove) return withoutIt;
  return [
    ...withoutIt,
    {
      name: entry.name,
      ...(entry.qty ? { qty: entry.qty } : {}),
      source: "manual" as const,
      addedAt,
    },
  ].slice(0, 40);
}

/**
 * La lista sin las marcas "comprado" ("store"); las de "en casa" se quedan. Al
 * pasar a la cadencia optimizada, o al salir de ella, la misma compra deja de
 * llevar lo mismo (la primera pasa de una semana de arroz a la del mes), así
 * que un "comprado" heredado diría que ya está en casa lo que no se compró.
 *
 * Las compras anteriores a `fromTrip` no cambian de contenido (la optimizada
 * rige desde `plan.cadenceFrom`) y conservan sus marcas.
 */
export function withoutStoreMarks(shopping: ShoppingList, fromTrip = 0): ShoppingList {
  return shopping.map((group) => ({
    category: group.category,
    items: group.items.map((item) => {
      const { owned, ownedTrips, ...rest } = item;
      const kept = Object.fromEntries(
        Object.entries(ownedTrips ?? {}).filter(
          ([trip, source]) => source !== "store" || Number(trip) < fromTrip,
        ),
      );
      return {
        ...rest,
        ...(owned && owned !== "store" ? { owned } : {}),
        ...(Object.keys(kept).length ? { ownedTrips: kept } : {}),
      };
    }),
  }));
}
