import type { PlanCoverage } from "../plan/types";
import { daysInMonth } from "@/lib/dates";

export type ShoppingCadence = "semanal" | "bisemanal" | "mensual" | "optimizada";

export const CADENCES: {
  key: ShoppingCadence;
  label: string;
  /** Nº de compras de un mes completo. Es el techo, no una cifra fija: lo que
   *  manda es `periodDays` sobre los días que el plan cubre de verdad
   *  (`tripsForCoverage`). */
  trips: number;
  /** Cada cuántos días se va a comprar. Es lo que da sentido a la cadencia:
   *  "semanal" son compras de ~7 días, no "un cuarto de lo que quede de mes". */
  periodDays: number;
}[] = [
  { key: "semanal", label: "Semanal", trips: 4, periodDays: 7 },
  { key: "bisemanal", label: "Cada 2 semanas", trips: 2, periodDays: 14 },
  { key: "mensual", label: "Mensual", trips: 1, periodDays: 31 },
  // Mismas salidas que la semanal, pero cada compra se lleva de cada ingrediente
  // todo lo que aguanta: ver `stockUpAmounts` en trips.ts.
  { key: "optimizada", label: "Optimizada", trips: 4, periodDays: 7 },
];

/** La cadencia si `raw` es una de las que existen; si no, `undefined`. */
export const asCadence = (raw: unknown): ShoppingCadence | undefined =>
  CADENCES.find((c) => c.key === raw)?.key;

/** Unidad canónica de una cantidad de compra. Todo se normaliza a estas tres. */
export type QtyUnit = "g" | "ml" | "ud";

/** Nº de semanas que tiene siempre un plan mensual tras `completePlan`. */
export const WEEK_COUNT = 4;

/**
 * Un artículo de la lista de la compra. Tiene dos formas:
 *
 * - **Canónica** (lo que se guarda hoy): una sola fila por ingrediente, con
 *   `unit` + `weekQty` (cuánto piden los platos de cada semana del plan) +
 *   `weekPrice`. `trip` es 0 y se ignora; las marcas de "comprado" viven en
 *   `ownedTrips`. `qty`/`price_eur` son el total del mes, derivados de los
 *   arrays. Es "canónica" si trae `weekQty`.
 * - **Proyectada** (lo que consume la UI, vía `projectTrips`): una fila por
 *   compra en la que el ingrediente hace falta, con `qty`/`qtyValue`/`price_eur`
 *   ya recortados a los días de esa compra y `owned` resuelto para ese `trip`.
 *
 * Las listas antiguas (sin `weekQty`) siguen siendo válidas con la forma
 * proyectada de siempre: una fila por `name` + `trip`.
 */
export type ShoppingItem = {
  name: string;
  /** Total legible ("1,5 kg", "300 g", "2 ud"). Derivado en la forma canónica. */
  qty: string;
  price_eur: number;
  /**
   * Compra a la que pertenece la fila proyectada (0 = primera). En la forma
   * canónica siempre es 0. El emparejamiento al marcar "comprado" en una lista
   * antigua es por `name` + `trip` juntos, nunca solo por `name`.
   */
  trip: number;
  /** Alimento fresco (poca vida útil). */
  perishable: boolean;
  /**
   * Marcado a mano según de dónde ha salido: "fridge" si ya lo tenía en casa,
   * "store" si lo ha comprado en el súper. Los dos significan que ya no hace
   * falta comprarlo — solo cambia el origen, para saber qué icono resaltar.
   * Sin valor: todavía pendiente, sin decidir. En la forma canónica no se usa
   * (ver `ownedTrips`); lo pone `projectTrips` en cada fila proyectada.
   */
  owned?: "fridge" | "store";
  /** Unidad de `weekQty`/`qtyValue` (formas canónica y proyectada). */
  unit?: QtyUnit;
  /** Cantidad numérica en `unit` de la fila proyectada (para sumar sin re-parsear `qty`). */
  qtyValue?: number;
  /**
   * Cantidad en `unit` que piden los platos de cada semana del plan (longitud
   * `WEEK_COUNT`; 0 si esa semana no se usa). Fuente de verdad de las
   * cantidades: cada compra suma lo de las semanas que cubre, así Σ entre
   * compras = lo que necesita el mes y cambiar de cadencia solo re-trocea.
   */
  weekQty?: number[];
  /** € por semana, array paralelo a `weekQty` (forma canónica). */
  weekPrice?: number[];
  /** Por compra: de dónde salió lo de ese `trip` (forma canónica). */
  ownedTrips?: Record<number, "fridge" | "store">;
};
export type ShoppingList = { category: string; items: ShoppingItem[] }[];

/** Una lista es canónica si sus artículos traen el desglose por semana (`weekQty`). */
export const isCanonicalShopping = (shopping: ShoppingList | null | undefined): boolean =>
  !!shopping && shopping.some((g) => g.items.some((i) => Array.isArray(i.weekQty)));

/**
 * Lleva una unidad escrita por la IA (o de una lista antigua) a la canónica
 * `g`/`ml`/`ud` con el factor para convertir la cantidad. "1 kg" → factor 1000
 * y unidad `g`; "medio litro" no se entiende y cae en `ud`. Manojos, latas y
 * botes se cuentan como unidades.
 */
export const normalizeUnit = (raw: string): { unit: QtyUnit; factor: number } => {
  const u = String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f.]/g, "")
    .trim();
  if (/^(kg|kilo|kilos|kilogramo|kilogramos)$/.test(u)) return { unit: "g", factor: 1000 };
  if (/^(g|gr|grs|gramo|gramos)$/.test(u)) return { unit: "g", factor: 1 };
  if (/^(l|lt|litro|litros)$/.test(u)) return { unit: "ml", factor: 1000 };
  if (/^(ml|mililitro|mililitros|cl)$/.test(u)) return { unit: "ml", factor: u === "cl" ? 10 : 1 };
  return { unit: "ud", factor: 1 };
};

/**
 * Redondea un peso/volumen a un paso que escale con la magnitud, "a ojo de
 * comprador": por debajo de 10 no se toca (nada compra en pasos de 10 la
 * cúrcuma o el curry — bajar de "7 g" a "0 g" perdería el ingrediente por
 * completo), de 10 a 100 sube a la decena, de 100 a 1000 a la media centena, y
 * de ahí para arriba al medio kilo. Antes `formatQty` redondeaba a la unidad
 * exacta (`Math.round`), y una lista semanal salía con "214 g", "143 g", "7 g":
 * cantidades que nadie compra tal cual. Solo toca el texto que se enseña — el
 * dato guardado (`weekQty`/`qtyValue`) no pasa por aquí, así que la invariante
 * "Σ entre compras = lo que pide el mes" no se mueve un gramo.
 */
const roundForBuying = (v: number): number => {
  if (v < 10) return v;
  if (v < 100) return Math.round(v / 10) * 10;
  if (v < 1000) return Math.round(v / 50) * 50;
  return Math.round(v / 500) * 500;
};

/** Cantidad legible en español a partir del valor canónico y su unidad. */
export const formatQty = (value: number, unit: QtyUnit): string => {
  const raw = Math.max(0, Number(value) || 0);
  const num = (n: number, digits: number) =>
    n.toLocaleString("es-ES", { maximumFractionDigits: digits });
  // Las unidades sueltas (huevos, latas, manojos...) ya se compran de una en
  // una: redondear al alza no ayuda ahí, se queda con el redondeo simple de
  // siempre.
  if (unit === "g" || unit === "ml") {
    const v = roundForBuying(raw);
    const big = unit === "g" ? "kg" : "l";
    return v >= 1000 ? `${num(v / 1000, 2)} ${big}` : `${num(v, 0)} ${unit}`;
  }
  // Nunca "0 ud": el reparto por compra (`projectItemForTrip`) puede dejar una
  // fracción de pieza cuando el tramo de esa compra no cubre la semana entera
  // (`tripDayRange` no se alinea con `weekOfDay`). Una cantidad positiva, por
  // pequeña que sea, redondea como mínimo a 1 pieza.
  return `${num(raw > 0 ? Math.max(1, Math.round(raw)) : 0, 0)} ud`;
};

/**
 * Peso medio de una pieza para las frutas/verduras que la IA cuenta por "ud"
 * en la compra (ver el prompt de `generateMonthlyPlan`: "ud para
 * piezas/manojos/latas"). Solo sirve para MOSTRAR el total en gramos junto al
 * nº de piezas aproximado — no toca `weekQty`/`unit`, que siguen en piezas
 * para no romper la invariante "Σ entre compras = lo que pide el mes". Pesos
 * de una pieza mediana, a ojo de supermercado español; deliberadamente
 * incompleta (solo lo que de verdad se compra por pieza, no verduras de hoja
 * o bayas que siempre se compran a peso/bolsa).
 */
const PRODUCE_UNIT_GRAMS: { key: string; aliases?: string[]; grams: number }[] = [
  { key: "tomate", aliases: ["tomates", "tomate rama", "tomate pera"], grams: 120 },
  { key: "cebolla", aliases: ["cebollas", "cebolleta", "cebolla morada", "chalota"], grams: 150 },
  { key: "ajo", aliases: ["diente de ajo", "dientes de ajo", "ajos"], grams: 5 },
  {
    key: "pimiento",
    aliases: ["pimientos", "pimiento rojo", "pimiento verde", "pimiento amarillo"],
    grams: 150,
  },
  { key: "calabacin", aliases: ["calabacines", "zucchini"], grams: 250 },
  { key: "berenjena", aliases: ["berenjenas"], grams: 250 },
  { key: "zanahoria", aliases: ["zanahorias"], grams: 80 },
  { key: "pepino", aliases: ["pepinos"], grams: 250 },
  { key: "patata", aliases: ["patatas"], grams: 150 },
  { key: "puerro", aliases: ["puerros"], grams: 150 },
  { key: "aguacate", aliases: ["aguacates"], grams: 200 },
  { key: "manzana", aliases: ["manzanas"], grams: 180 },
  { key: "platano", aliases: ["platanos", "plátano", "plátanos", "banana", "bananas"], grams: 120 },
  { key: "naranja", aliases: ["naranjas"], grams: 200 },
  { key: "pera", aliases: ["peras"], grams: 180 },
  { key: "limon", aliases: ["limones", "lima", "limón"], grams: 100 },
  { key: "kiwi", aliases: ["kiwis"], grams: 80 },
  { key: "mango", aliases: ["mangos"], grams: 300 },
  { key: "mandarina", aliases: ["mandarinas", "clementina", "clementinas"], grams: 80 },
  {
    key: "melocoton",
    aliases: ["melocotón", "melocotones", "nectarina", "nectarinas", "paraguayo"],
    grams: 150,
  },
  { key: "ciruela", aliases: ["ciruelas"], grams: 70 },
  { key: "granada", aliases: ["granadas"], grams: 300 },
  { key: "pina", aliases: ["piña", "piñas"], grams: 1200 },
  { key: "melon", aliases: ["melón"], grams: 1300 },
  { key: "sandia", aliases: ["sandía"], grams: 3000 },
  { key: "albaricoque", aliases: ["albaricoques", "damasco"], grams: 60 },
];

const normalizeForMatch = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Gramos aproximados de una pieza de este ingrediente, o `null` si no lo reconoce. */
export const approxUnitGrams = (name: string): number | null => {
  const n = normalizeForMatch(name);
  if (!n) return null;
  const matches = (entry: (typeof PRODUCE_UNIT_GRAMS)[number]) =>
    n === normalizeForMatch(entry.key) ||
    (entry.aliases ?? []).some((a) => n === normalizeForMatch(a));
  const contains = (entry: (typeof PRODUCE_UNIT_GRAMS)[number]) =>
    n.includes(normalizeForMatch(entry.key)) ||
    (entry.aliases ?? []).some((a) => n.includes(normalizeForMatch(a)));
  return (
    PRODUCE_UNIT_GRAMS.find(matches)?.grams ?? PRODUCE_UNIT_GRAMS.find(contains)?.grams ?? null
  );
};

/**
 * Cantidad legible de un artículo de la compra: para "g"/"ml", igual que
 * `formatQty`. Para "ud" de una fruta o verdura reconocida, muestra los
 * gramos (redondeados como el resto de la compra) con el nº de piezas
 * aproximado entre paréntesis — así "0 ud" (ver `formatQty`) nunca llega a
 * pantalla y el peso, no la pieza, es el dato accionable al comprar. El resto
 * de "ud" (huevos, latas, manojos...) se queda como antes.
 */
export const formatShoppingQty = (name: string, value: number, unit: QtyUnit): string => {
  const raw = Math.max(0, Number(value) || 0);
  if (unit !== "ud" || raw <= 0) return formatQty(value, unit);
  const grams = approxUnitGrams(name);
  if (grams == null) return formatQty(value, unit);
  const pieces = Math.max(1, Math.round(raw));
  return `${formatQty(raw * grams, "g")} (≈${pieces} ud)`;
};

/**
 * Interpreta el `qty` de texto libre de una lista antigua ("2 kg", "500 g",
 * "1,5 l", "3 unidades") como valor canónico. Devuelve `null` si no hay un
 * número reconocible.
 */
export const parseQtyLegacy = (qty: string): { value: number; unit: QtyUnit } | null => {
  const m = String(qty ?? "")
    .trim()
    .match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Záéíóúñ]+)?/);
  if (!m) return null;
  const value = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const { unit, factor } = normalizeUnit(m[2] ?? "ud");
  return { value: value * factor, unit };
};

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

/**
 * Nº de compras de una cadencia en un mes COMPLETO. Solo para los caminos que
 * no saben qué días cubre el plan (listas antiguas sin `coverage`, y el reparto
 * heredado de `repartitionTrips`). Todo lo que se enseña en pantalla debe usar
 * `tripsForCoverage`, que sí mira la cobertura real.
 */
export const tripsOfCadence = (cadence: ShoppingCadence) =>
  CADENCES.find((c) => c.key === cadence)?.trips ?? 1;

/**
 * Nº de compras de una cadencia sobre los días que el plan cubre DE VERDAD.
 *
 * Antes era una constante (4 / 2 / 1) y `tripDayRange` partía la cobertura en
 * ese número de trozos iguales, así que un plan creado el día 20 (12 días de
 * cobertura) con cadencia semanal salían "4 compras" de 3 días cada una,
 * rotuladas "semana 1 de 4 · días 20-22". Una compra semanal es una compra de
 * ~7 días: si solo quedan 12, son dos; si quedan 5, es una.
 *
 * Se redondea al entero más cercano (no hacia arriba) para que el resto corto
 * del final se absorba en la última compra en vez de generar un tramo de
 * relleno: un mes completo de 31 días sigue dando 4 compras semanales y 2
 * bisemanales, exactamente como antes de este cambio, así que ningún plan ya
 * generado cambia de forma.
 */
export const tripsForCoverage = (
  cadence: ShoppingCadence,
  coverage: PlanCoverage | null | undefined,
): number => {
  if (cadence === "mensual") return 1;
  if (!coverage) return tripsOfCadence(cadence);
  const period = CADENCES.find((c) => c.key === cadence)?.periodDays ?? 31;
  const days = Math.max(1, coverage.toDay - coverage.fromDay + 1);
  return Math.max(1, Math.round(days / period));
};

export { daysInMonth };

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
