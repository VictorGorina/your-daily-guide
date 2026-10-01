import {
  formatShoppingQty,
  normalizeUnit,
  type ShoppingItem,
  type ShoppingList,
  WEEK_COUNT,
} from "./model";

/** Array de `len` números ≥ 0 (rellena con 0, recorta lo que sobre). */
const numArray = (raw: unknown, len: number): number[] =>
  Array.from({ length: len }, (_, i) => {
    const n = Number((Array.isArray(raw) ? raw[i] : undefined) ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });

const asOwnedSource = (raw: unknown): "fridge" | "store" | undefined =>
  // Compatible con datos antiguos donde "owned" era un booleano sin origen.
  raw === "store" ? "store" : raw ? "fridge" : undefined;

const asOwnedTrips = (raw: unknown): Record<number, "fridge" | "store"> | undefined => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: Record<number, "fridge" | "store"> = {};
  for (const [key, value] of Object.entries(o)) {
    const t = Number(key);
    const source = asOwnedSource(value);
    if (Number.isFinite(t) && t >= 0 && source) out[Math.round(t)] = source;
  }
  return Object.keys(out).length ? out : undefined;
};

const asItem = (raw: unknown): ShoppingItem | null => {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name) return null;
  const perishable = Boolean(o.perishable);

  // Forma canónica: la IA da `weekQty` (cantidad por semana del plan). El `qty`
  // legible y el `price_eur` del mes se derivan de los arrays, no se guardan a mano.
  if (Array.isArray(o.weekQty)) {
    const { unit, factor } = normalizeUnit(String(o.unit ?? "ud"));
    const weekQty = numArray(o.weekQty, WEEK_COUNT).map((n) => n * factor);
    const rawPrice = numArray(o.weekPrice, WEEK_COUNT);
    const totalQty = weekQty.reduce((s, n) => s + n, 0);
    // Si no vino `weekPrice`, reparte el `price_eur` del mes en proporción a la
    // cantidad de cada semana (y si tampoco hay precio, queda a 0).
    const monthPrice = Number(o.price_eur);
    const weekPrice =
      rawPrice.some((n) => n > 0) || !Number.isFinite(monthPrice) || monthPrice <= 0
        ? rawPrice
        : weekQty.map((q) => (totalQty > 0 ? (monthPrice * q) / totalQty : 0));
    const ownedTrips = asOwnedTrips(o.ownedTrips);
    return {
      name,
      qty: formatShoppingQty(name, totalQty, unit),
      price_eur: Math.round(weekPrice.reduce((s, n) => s + n, 0) * 100) / 100,
      trip: 0,
      perishable,
      unit,
      weekQty,
      weekPrice,
      ...(ownedTrips ? { ownedTrips } : {}),
    };
  }

  // Forma antigua: una fila por `name` + `trip`, con `qty` de texto libre.
  const price = Number(o.price_eur);
  const trip = Number(o.trip);
  const owned = asOwnedSource(o.owned);
  return {
    name,
    qty: String(o.qty ?? "").trim(),
    price_eur: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0,
    trip: Number.isFinite(trip) && trip > 0 ? Math.min(Math.round(trip), 3) : 0,
    perishable,
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

// Precios en la moneda del perfil (ticket 34, I18N-02): el plan los pide a la
// IA en esa moneda, así que pintarlos con € era decir otra cosa. El texto sigue
// en español: el locale solo cambia donde el formato del país lo pide.
const MONEY_LOCALE: Record<string, string> = { MXN: "es-MX", USD: "es-US" };

export const formatMoney = (n: number, currency?: string | null) => {
  const code = (currency || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat(MONEY_LOCALE[code] ?? "es-ES", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).format(n);
  } catch {
    return eur(n);
  }
};
