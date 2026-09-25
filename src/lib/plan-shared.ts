import {
  isSharedSlot,
  MEAL_KEYS,
  type FeedingStage,
  type HomeSchedule,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";

/** Las cuatro comidas que se pueden cambiar una a una desde el chat. */
export const MEAL_SLOTS = ["desayuno", "comida", "cena", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABEL: Record<MealSlot, string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
  // La clave interna sigue siendo "snack" (identificadores en inglés, textos
  // en español) pero en castellano de casa esta comida se llama merienda.
  snack: "Merienda",
};

/**
 * Comidas que se pueden elegir en el onboarding para que el plan las incluya.
 * Todas por defecto: es el comportamiento de siempre (y el de un perfil sin
 * `meal_slots` ni `meals_to_plan` interpretable).
 */
export const DEFAULT_MEAL_SLOTS: readonly MealSlot[] = MEAL_SLOTS;

/** ¿Es una de las cuatro claves válidas de comida? */
const isMealSlot = (v: unknown): v is MealSlot =>
  (MEAL_SLOTS as readonly string[]).includes(v as string);

/**
 * Valida/depura una lista de slots (columna `meal_slots` del perfil, tal cual
 * llega de la base de datos): descarta valores desconocidos y duplicados: si
 * no queda ninguno válido, vuelve a "todas" — nunca un plan vacío por un dato
 * corrupto o una migración a medias.
 */
export function cleanMealSlots(raw: unknown): MealSlot[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MEAL_SLOTS];
  const seen = new Set<MealSlot>();
  for (const v of raw) if (isMealSlot(v)) seen.add(v);
  return seen.size ? MEAL_SLOTS.filter((s) => seen.has(s)) : [...DEFAULT_MEAL_SLOTS];
}

/**
 * Interpreta el texto libre antiguo de `meals_to_plan` ("Comida y cena",
 * "desayuno, comida, cena", una frase escrita a mano...) buscando el nombre de
 * cada comida. Es el respaldo para un perfil sin `meal_slots` todavía —
 * `effectiveMealSlots` la usa en cada lectura, no solo en la migración de
 * backfill, porque `meals_to_plan` se puede seguir editando por chat
 * (`actualizar_perfil`) sin que nadie toque `meal_slots` a la vez.
 *
 * Devuelve `null` si el texto no menciona ninguna comida reconocible (para
 * que quien llama caiga a `DEFAULT_MEAL_SLOTS` en vez de un plan vacío).
 */
export function parseMealSlotsLegacy(text: string | null | undefined): MealSlot[] | null {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!t.trim()) return null;
  const found: MealSlot[] = [];
  if (/desayuno/.test(t)) found.push("desayuno");
  if (/\bcomida\b|almuerzo/.test(t)) found.push("comida");
  if (/\bcena\b/.test(t)) found.push("cena");
  if (/merienda|snack/.test(t)) found.push("snack");
  return found.length ? found : null;
}

/**
 * Slots que de verdad hay que planificar para este perfil: `meal_slots`
 * (estructurado) si lo hay, si no la interpretación del texto libre antiguo,
 * y si tampoco eso, todas. Único punto de lectura — así el generador del plan
 * y las pantallas que lo pintan nunca pueden desincronizarse entre sí.
 */
export function effectiveMealSlots(profile: {
  meal_slots?: unknown;
  meals_to_plan?: string | null;
}): MealSlot[] {
  if (Array.isArray(profile.meal_slots) && profile.meal_slots.length) {
    return cleanMealSlots(profile.meal_slots);
  }
  return parseMealSlotsLegacy(profile.meals_to_plan) ?? [...DEFAULT_MEAL_SLOTS];
}

/** Campo del día donde vive cada comida cuando se cambia a mano. */
export const MEAL_SLOT_FIELD = {
  desayuno: "breakfast",
  comida: "lunch",
  cena: "dinner",
  snack: "snack",
} as const satisfies Record<MealSlot, keyof PlanDay>;

/**
 * Plato aparte de un niño para un día concreto, cuando el plato compartido del
 * hogar no le sirve (su alérgeno, su edad, o no lo come). Lo emite la IA al
 * generar el plan o lo pone el planificador a mano (`setChildMeal`). Vive en la
 * fila del planificador y se espeja a los demás miembros como el resto de
 * comidas compartidas. `off` = ingredientes que pide y no están en la compra.
 */
export type ChildMeal = { childId: string; slot: MealSlot; dish: string; off?: string[] };

/**
 * Un día del plan. `lunch`/`dinner` vienen siempre del plan generado; el plan
 * base deja el desayuno y el snack a nivel de semana (una lista que rota por
 * día), así que `breakfast`/`snack` sólo aparecen cuando se ha pedido un plato
 * concreto para ESE día — un cambio a mano manda sobre la rotación semanal.
 * `extras` guarda, por comida, los ingredientes de ese plato que no salen de la
 * lista de la compra, para poder avisar en pantalla. `kids` guarda los platos
 * aparte de un niño para ESE día (issue 07); el resto de comidas el niño come
 * el plato compartido.
 *
 * `pinned` son las comidas de ese día que la persona eligió a mano
 * (`setPlanMeal`). Ninguna recolocación automática las pisa (`applyPlanChanges`,
 * `mergeFuturePlan`): sin esta marca, una comida o cena cambiada a mano se
 * perdía en el siguiente reajuste, porque se guarda en el mismo campo que
 * escribe la IA. Los días 29-31 comparten celda con los de la semana 3 (el plan
 * tiene 4 filas), así que la marca vale para las dos fechas de esa celda.
 */
export type PlanDay = {
  day: string;
  lunch: string;
  dinner: string;
  breakfast?: string;
  snack?: string;
  extras?: Partial<Record<MealSlot, string[]>>;
  kids?: ChildMeal[];
  pinned?: MealSlot[];
};

/** ¿Esta comida del día la eligió la persona a mano? */
export const isPinned = (day: PlanDay | null | undefined, slot: MealSlot): boolean =>
  !!day?.pinned?.includes(slot);

/**
 * Lo que hace falta saber del hogar para distinguir "lo cambié yo" de "lo
 * cambió el hogar" en un slot concreto — ver `dishChangeIsMine`.
 */
export type HouseholdPinContext = {
  isPlanner: boolean;
  sharedSlots: SharedSlots;
  weekday: number;
};

/**
 * ¿Un cambio de plato en este slot, si lo hay, lo hizo la propia persona que
 * está mirando la pantalla? En un slot compartido de un hogar solo quien
 * planifica puede cambiarlo (`guardSharedSlotWrite` bloquea al resto), así
 * que para cualquier otro miembro un plato distinto al esperado siempre vino
 * de fuera. Sin hogar (`home` null), o en un slot en solitario (merienda, o
 * una comida ese día no compartida), el cambio es siempre propio.
 */
export function dishChangeIsMine(slot: MealSlot, home: HouseholdPinContext | null): boolean {
  if (!home || home.isPlanner || slot === "snack") return true;
  return !isSharedSlot(home.sharedSlots, slot, home.weekday);
}

/**
 * ¿La eligió a mano la propia persona que está mirando la pantalla, y no
 * otra? En un slot compartido del hogar, `pinned` viaja siempre desde la fila
 * del planificador (`mirrorPinned`), así que un no planificador puede verlo
 * fijado sin haber tocado nada él mismo.
 */
export function isPinnedByViewer(
  day: PlanDay | null | undefined,
  slot: MealSlot,
  home: HouseholdPinContext | null,
): boolean {
  return isPinned(day, slot) && dishChangeIsMine(slot, home);
}

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
];

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

/**
 * Mes y año por separado, para pintarlos en dos líneas en la cabecera de Plan
 * (el mes solo se corta con `truncate` en pantallas estrechas: "Septiembre de
 * 2026" no cabe en una línea entre los dos botones de navegación). Cada parte
 * sale de `toLocaleDateString` por su cuenta en vez de partir la cadena de
 * `monthTitle`: ese formato ("agosto de 2026") depende del idioma y no es
 * seguro trocearlo por posición.
 */
export const monthParts = (month: string): { monthName: string; year: string } => {
  const date = new Date(`${month}-01T00:00:00`);
  return {
    monthName: date.toLocaleDateString("es-ES", { month: "long" }),
    year: date.toLocaleDateString("es-ES", { year: "numeric" }),
  };
};

/**
 * Pone en mayúscula solo la primera letra ("agosto de 2026" → "Agosto de 2026").
 * Para títulos: en español el mes y la preposición van en minúscula, así que
 * `text-transform: capitalize` / `textTransform: "capitalize"` (que sube cada
 * palabra) da "Agosto De 2026", que está mal.
 */
export const capitalizeFirst = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

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

/**
 * Proyecta la lista canónica sobre las compras de una cadencia: para cada
 * compra suma, ingrediente a ingrediente, la parte de `weekQty`/`weekPrice` de
 * los días que esa compra cubre (rango de `tripDayRange`). El resultado es la
 * forma que consume la UI — una fila por compra con `qty`/`price_eur` ya
 * recortados y `owned` resuelto para ese `trip`.
 *
 * Una lista antigua (sin `weekQty`) no se puede recalcular: se cae al reparto
 * de siempre (`groupByTrip`), que respeta el `trip` que ya trae cada fila.
 */
export const projectTrips = (
  shopping: ShoppingList | null | undefined,
  cadence: ShoppingCadence,
  coverage: PlanCoverage,
  weekCount: number = WEEK_COUNT,
): TripGroups[] => {
  const trips = tripsForCoverage(cadence, coverage);
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
  // Fila antigua colada en una lista canónica: se queda si es su propia compra.
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

/**
 * Valida la lista de platos de niño de un día: descarta entradas sin `childId`,
 * sin plato o con un `slot` que no sea una de las 3 comidas principales (el
 * snack nunca se comparte ni lleva plato aparte, D5), deduplica por niño+comida
 * (una sola alternativa por niño y momento) y recorta `off` como `extras`.
 */
const cleanKids = (raw: unknown): ChildMeal[] | undefined => {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: ChildMeal[] = [];
  for (const entry of list.slice(0, 12)) {
    const o = (entry ?? {}) as Record<string, unknown>;
    const childId = String(o.childId ?? "").trim();
    const slot = MEAL_KEYS.includes(o.slot as MealKey) ? (o.slot as MealSlot) : null;
    const dish = String(o.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!childId || !slot || !dish) continue;
    const key = `${childId}|${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const off = (Array.isArray(o.off) ? o.off : [])
      .map((n) => String(n).trim())
      .filter(Boolean)
      .slice(0, 6);
    out.push({ childId, slot, dish, ...(off.length ? { off } : {}) });
  }
  return out.length ? out.slice(0, 6) : undefined;
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
  const kids = cleanKids(d.kids);
  const rawPinned: unknown[] = Array.isArray(d.pinned) ? d.pinned : [];
  const pinned = MEAL_SLOTS.filter((s) => rawPinned.includes(s));
  if (breakfast) day.breakfast = breakfast;
  if (snack) day.snack = snack;
  if (extras) day.extras = extras;
  if (kids) day.kids = kids;
  if (pinned.length) day.pinned = pinned;
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
 * Fecha que ocupa una celda `(semana, día)` del plan, o `null` si esa celda no
 * cae en el mes. Es la inversa de `planSlotIndex`.
 *
 * Hace falta porque la rejilla del plan NO va en orden de calendario: la semana
 * la marca el día del mes (`floor((día-1)/7)`) y la posición dentro de ella, el
 * día de la semana. En un mes que empieza en martes, la semana 0 va
 * martes(1)…domingo(6) y luego lunes(7): el lunes es el ÚLTIMO día de esa
 * semana pero el PRIMERO de la fila. Decidir "esto es futuro" comparando
 * posiciones da el resultado contrario al del calendario.
 *
 * Los días 29 en adelante comparten celda con los de la semana 3 (el plan solo
 * tiene 4 filas y `planSlotIndex` los recorta ahí), así que esta función
 * devuelve la PRIMERA fecha de la fila: al usarla para decidir qué se puede
 * reescribir, el empate se resuelve a favor de no tocar nada. Es la limitación
 * del modelo de 4 semanas, no de esta función.
 */
export function dateOfPlanCell(month: string, weekIndex: number, dayIndex: number): string | null {
  const total = daysInMonth(month);
  const from = weekIndex * 7 + 1;
  for (let dom = from; dom <= Math.min(from + 6, total); dom++) {
    const date = `${month}-${String(dom).padStart(2, "0")}`;
    if ((new Date(`${date}T00:00:00`).getDay() + 6) % 7 === dayIndex) return date;
  }
  return null;
}

/**
 * Lo que la persona contó antes de que se genere el plan de un mes: si va a
 * estar fuera de casa un tramo (viaje, etc.) y cualquier otra nota libre.
 * Vive en `month_constraints`, una fila por `(user_id, month)`; su sola
 * existencia es la marca de "ya se le preguntó" (ver `setMonthConstraints`).
 */
export type MonthConstraints = {
  month: string;
  awayStart: string | null;
  awayEnd: string | null;
  notes: string | null;
};

/**
 * Frase para el prompt de `generatePlanBody` cuando la persona avisó de que
 * va a estar fuera de casa, o dejó alguna nota, para el mes que se está
 * generando. Solo afecta a SUS comidas personales (desayuno/merienda siempre,
 * comida/cena si no están marcadas como compartidas en `sharedSlots`): las
 * comidas compartidas del hogar nunca se tocan por esto, así que si quien
 * viaja es el planificador, el resto de la familia sigue comiendo en casa con
 * normalidad.
 */
export function awayPlanLine(input: {
  month: string;
  coverage: PlanCoverage;
  awayStart: string | null;
  awayEnd: string | null;
  notes: string | null;
  sharedSlots: SharedSlots;
  mealSlots: readonly MealSlot[];
}): string {
  const { month, coverage, awayStart, awayEnd, notes, sharedSlots, mealSlots } = input;
  const notesLine = notes
    ? `NOTAS PARA ESTE MES (contexto adicional de la persona, tenlo en cuenta si es relevante): "${notes}"`
    : "";
  if (!awayStart || !awayEnd) return notesLine;

  const awayDays: { date: string; weekIndex: number; dayIndex: number; dayName: string }[] = [];
  for (let dom = coverage.fromDay; dom <= coverage.toDay; dom++) {
    const date = `${month}-${String(dom).padStart(2, "0")}`;
    if (date < awayStart || date > awayEnd) continue;
    awayDays.push({ date, ...planCursor(date) });
  }
  if (!awayDays.length) return notesLine;

  const weekText = [...new Map(awayDays.map((d) => [d.weekIndex, [] as string[]])).entries()]
    .map(([weekIndex]) => {
      const names = awayDays.filter((d) => d.weekIndex === weekIndex).map((d) => d.dayName);
      return `Semana ${weekIndex + 1}: ${names.join(", ")}`;
    })
    .join("; ");

  const wantsBreakfastOrSnack = mealSlots.includes("desayuno") || mealSlots.includes("snack");
  const personalLunchDinner = awayDays.some(
    (d) =>
      (mealSlots.includes("comida") && !isSharedSlot(sharedSlots, "comida", d.dayIndex)) ||
      (mealSlots.includes("cena") && !isSharedSlot(sharedSlots, "cena", d.dayIndex)),
  );
  const sharedLunchDinner = awayDays.some(
    (d) =>
      (mealSlots.includes("comida") && isSharedSlot(sharedSlots, "comida", d.dayIndex)) ||
      (mealSlots.includes("cena") && isSharedSlot(sharedSlots, "cena", d.dayIndex)),
  );

  const parts = [
    `AUSENCIA: vas a estar fuera de casa del ${awayStart} al ${awayEnd} (${weekText}).`,
  ];
  if (wantsBreakfastOrSnack) {
    parts.push(
      'Esos días pon un desayuno y una merienda concretos, rápidos y fáciles de llevar o preparar fuera (añade "breakfast"/"snack" en esos días del JSON, sustituyendo la rotación semanal) — nunca algo genérico.',
    );
  }
  if (personalLunchDinner) {
    parts.push(
      "Tu comida y cena personales esos días también deben ser una idea concreta pensada para estar fuera (bocadillo, tupper, algo fácil de conseguir) — nunca genérico.",
    );
  }
  if (sharedLunchDinner) {
    parts.push(
      "La comida/cena compartida con la casa esos días no cambia: no la toques, sigue igual para el resto de la familia.",
    );
  }
  if (notesLine) parts.push(notesLine);
  return parts.join(" ");
}

/**
 * ¿Es la celda `(semana, día)` del plan de `month` posterior a `today`, y por
 * tanto se puede reescribir? Decide por la fecha real de la celda
 * (`dateOfPlanCell`), nunca por su posición en la fila: un lunes 7 va en la
 * posición 0 pero es la última fecha de la semana 0 de un mes que empieza en
 * martes. Hoy y el pasado no se tocan; una celda que no cae en el mes, tampoco.
 *
 * Un mes íntegramente futuro (p. ej. al preparar el que viene por adelantado)
 * no tiene nada fijado: todas sus celdas cuentan como futuras, también las que
 * no tienen fecha, para que se copie completo.
 */
export function isPlanCellAhead(
  month: string,
  weekIndex: number,
  dayIndex: number,
  today: string,
): boolean {
  if (month > today.slice(0, 7)) return true;
  const date = dateOfPlanCell(month, weekIndex, dayIndex);
  return date != null && date > today;
}

/**
 * ¿Está por venir la semana `weekIndex` entera? Los campos de semana
 * (desayunos y meriendas rotan por semana) solo se reescriben entonces; si no,
 * cambiarían también lo que ya se comió. Mismo criterio que `mergeFuturePlan`:
 * toda celda con fecha tiene que ser posterior a `today`.
 */
export function isPlanWeekAhead(month: string, weekIndex: number, today: string): boolean {
  if (month > today.slice(0, 7)) return true;
  return Array.from({ length: 7 }, (_, di) => dateOfPlanCell(month, weekIndex, di)).every(
    (date) => date == null || date > today,
  );
}

/**
 * Conserva el pasado y el día de hoy del plan actual y sólo adopta del plan
 * nuevo los días POSTERIORES a `today`, mirando la fecha real de cada celda.
 *
 * Antes se decidía por posición en la rejilla (`día > el de hoy dentro de su
 * semana`), y eso no coincide con el calendario: un lunes 7, que es la última
 * fecha de la semana 0 pero la posición 0 de la fila, dejaba las posiciones 1-6
 * —que son los días 1 al 6, ya pasados— del lado "futuro". Resultado: la
 * recolocación reescribía días pasados y no tocaba ninguno de los siguientes,
 * así que el ajuste no se veía por ningún lado y parecía que el coach no había
 * hecho nada.
 */
export const mergeFuturePlan = (
  current: MonthlyPlan,
  next: MonthlyPlan,
  today: string,
): MonthlyPlan => {
  const month = today.slice(0, 7);
  return {
    ...(current.coverage ? { coverage: current.coverage } : {}),
    ...(current.cadence ? { cadence: current.cadence } : {}),
    intro: next.intro || current.intro,
    focus: next.focus.length ? next.focus : current.focus,
    weeks: current.weeks.map((week, wi) => {
      const fresh = next.weeks[wi];
      if (!fresh) return week;
      // Los campos de semana (desayunos y meriendas rotan por semana) solo se
      // adoptan si la semana entera está por venir; si no, cambiarían también
      // lo que ya se comió.
      const weekAhead = week.days.every((_, di) => {
        const date = dateOfPlanCell(month, wi, di);
        return date == null || date > today;
      });
      return {
        label: week.label,
        focus: weekAhead ? fresh.focus || week.focus : week.focus,
        breakfasts: weekAhead && fresh.breakfasts.length ? fresh.breakfasts : week.breakfasts,
        snacks: weekAhead && fresh.snacks.length ? fresh.snacks : week.snacks,
        days: week.days.map((day, di) => {
          const date = dateOfPlanCell(month, wi, di);
          if (date == null || date <= today) return day;
          const freshDay =
            fresh.days.find((d) => normDay(d.day) === normDay(day.day)) ?? fresh.days[di];
          if (!freshDay?.lunch && !freshDay?.dinner) return day;
          // El spread conserva breakfast/snack/extras/kids/pinned: un plato pedido
          // a mano (incluido el plato aparte de un niño) manda sobre la
          // recolocación automática hasta que se cambie a mano otra vez (la IA
          // sólo devuelve lunch/dinner por día). Una comida o cena elegida a mano
          // vive en el mismo campo que escribe la IA, así que la protege `pinned`.
          return {
            ...day,
            lunch: isPinned(day, "comida") ? day.lunch : freshDay.lunch || day.lunch,
            dinner: isPinned(day, "cena") ? day.dinner : freshDay.dinner || day.dinner,
          };
        }),
      };
    }),
  };
};

/** Un día que la recolocación cambia. Solo lo que cambia: lo demás se queda. */
export type PlanChange = { date: string; lunch?: string; dinner?: string };

/**
 * Lee la respuesta de la IA al recolocar el plan, que es una LISTA DE CAMBIOS
 * ({"intro", "cambios": [{"fecha","comida","cena"}]}), no el plan entero.
 *
 * Pedir las cuatro semanas de vuelta para mover dos cenas salía caro y salía
 * mal: el modelo copiaba el plan tal cual la mayoría de las veces. Una lista
 * corta es barata de generar y, sobre todo, se puede validar — aquí se
 * descarta cualquier fecha que no esté entre las editables, así que un despiste
 * del modelo no puede reescribir un día ya cerrado.
 *
 * Devuelve `null` solo si la respuesta no tiene forma de lista de cambios (para
 * que quien llama reintente). Una lista vacía es una respuesta válida: significa
 * "no hace falta cambiar nada".
 */
export function cleanReflowChanges(
  raw: unknown,
  allowedDates: readonly string[],
): { intro: string; changes: PlanChange[] } | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.cambios)) return null;
  const allowed = new Set(allowedDates);
  const changes: PlanChange[] = [];
  for (const item of o.cambios) {
    const c = (item ?? {}) as Record<string, unknown>;
    const date = String(c.fecha ?? "");
    if (!allowed.has(date)) continue;
    const lunch = String(c.comida ?? "")
      .trim()
      .slice(0, 200);
    const dinner = String(c.cena ?? "")
      .trim()
      .slice(0, 200);
    if (!lunch && !dinner) continue;
    changes.push({ date, ...(lunch ? { lunch } : {}), ...(dinner ? { dinner } : {}) });
  }
  return { intro: String(o.intro ?? ""), changes };
}

/**
 * Aplica una lista de cambios sobre el plan, cada uno en la celda que le toca
 * por fecha (`planSlotIndex`, la misma que usa la pantalla). Un cambio con
 * fecha de hoy o anterior se ignora: el pasado no se reescribe nunca. Tampoco
 * se pisa una comida o cena elegida a mano (`pinned`), aunque la IA la devuelva.
 */
export function applyPlanChanges(
  current: MonthlyPlan,
  changes: readonly PlanChange[],
  today: string,
): MonthlyPlan {
  const byCell = new Map<string, PlanChange>();
  for (const c of changes) {
    if (!c.date || c.date <= today) continue;
    const at = planSlotIndex(current, c.date);
    if (at) byCell.set(`${at.weekIndex}:${at.dayIndex}`, c);
  }
  if (!byCell.size) return current;
  return {
    ...current,
    weeks: current.weeks.map((week, wi) => ({
      ...week,
      days: week.days.map((day, di) => {
        const c = byCell.get(`${wi}:${di}`);
        // El spread conserva breakfast/snack/extras/kids/pinned: la recolocación
        // solo toca comida y cena, y nunca la que se eligió a mano.
        if (!c) return day;
        return {
          ...day,
          lunch: c.lunch && !isPinned(day, "comida") ? c.lunch : day.lunch,
          dinner: c.dinner && !isPinned(day, "cena") ? c.dinner : day.dinner,
        };
      }),
    })),
  };
}

/**
 * Segunda pasada tras `mergeFuturePlan`, solo para el recálculo por cambio de
 * mesa (issue 05, `reflowMonthlyPlan` scope "full"). `mergeFuturePlan` conserva
 * el `kids` del plan actual en los días futuros (para no pisar un `setChildMeal`
 * a mano); pero un bebé recién dado de alta necesita su puré y ese `kids` nuevo
 * viene en `fresh`, no en el actual. Aquí:
 *  - se descartan los `kids` de un niño que ya no está en la casa (`keepChildIds`);
 *  - se adopta del plan nuevo cada `(childId, slot)` que el día no tuviera ya
 *    (una entrada existente = plato puesto a mano, se respeta).
 * Solo toca días posteriores a `today`, por fecha real de la celda (mismo
 * criterio que `mergeFuturePlan`); hoy y el pasado no se tocan.
 */
export const mergeFutureKids = (
  merged: MonthlyPlan,
  fresh: MonthlyPlan,
  today: string,
  keepChildIds: string[],
): MonthlyPlan => {
  const keep = new Set(keepChildIds);
  const month = today.slice(0, 7);
  return {
    ...merged,
    weeks: merged.weeks.map((week, wi) => {
      const freshWeek = fresh.weeks[wi];
      if (!freshWeek) return week;
      return {
        ...week,
        days: week.days.map((day, di) => {
          const date = dateOfPlanCell(month, wi, di);
          if (date == null || date <= today) return day;
          const freshDay =
            freshWeek.days.find((d) => normDay(d.day) === normDay(day.day)) ?? freshWeek.days[di];
          const existing = (day.kids ?? []).filter((k) => keep.has(k.childId));
          const taken = new Set(existing.map((k) => `${k.childId}|${k.slot}`));
          const added = (freshDay?.kids ?? []).filter(
            (k) => keep.has(k.childId) && !taken.has(`${k.childId}|${k.slot}`),
          );
          const kids = [...existing, ...added];
          if (kids.length === (day.kids?.length ?? 0) && !added.length) return day;
          const nextDay: PlanDay = { ...day };
          if (kids.length) nextDay.kids = kids;
          else delete nextDay.kids;
          return nextDay;
        }),
      };
    }),
  };
};

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

/**
 * Escribe un plato suelto en la celda de `date`, tal cual lo pidió la persona.
 * Es la única forma de hacerlo: la usa `setPlanMeal` en el servidor y la
 * actualización optimista de la pantalla, así que lo que se ve al instante es
 * exactamente lo que se guarda.
 *
 * - `off`: ingredientes del plato que no están en la compra (aviso en pantalla).
 * - `pin` (por defecto `true`): marca la comida como elegida a mano, para que
 *   ningún reajuste la pise. `false` quita la marca (lo usa "Deshacer" para
 *   dejar el día como estaba).
 *
 * Devuelve `null` si la fecha no tiene celda en el plan.
 */
export function withPlanMeal(
  plan: MonthlyPlan,
  date: string,
  slot: MealSlot,
  dish: string,
  opts: { off?: readonly string[]; pin?: boolean } = {},
): MonthlyPlan | null {
  const at = planSlotIndex(plan, date);
  if (!at) return null;
  const off = opts.off ?? [];
  const pin = opts.pin ?? true;
  return {
    ...plan,
    weeks: plan.weeks.map((week, wi) =>
      wi !== at.weekIndex
        ? week
        : {
            ...week,
            days: week.days.map((day, di) => {
              if (di !== at.dayIndex) return day;
              const updated: PlanDay = { ...day, [MEAL_SLOT_FIELD[slot]]: dish };

              const extras = { ...(day.extras ?? {}) };
              if (off.length) extras[slot] = [...off];
              else delete extras[slot];
              if (Object.keys(extras).length) updated.extras = extras;
              else delete updated.extras;

              const pinned = new Set(day.pinned ?? []);
              if (pin) pinned.add(slot);
              else pinned.delete(slot);
              const pins = MEAL_SLOTS.filter((s) => pinned.has(s));
              if (pins.length) updated.pinned = pins;
              else delete updated.pinned;

              return updated;
            }),
          },
    ),
  };
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
 *
 * Un slot sin plato (idea vacía) no aparece — antes solo pasaba esto con el
 * snack; ahora las cuatro comidas se tratan igual, que es lo que hace que
 * excluir una comida en el onboarding se note de verdad aquí: si
 * `generateMonthlyPlan` la deja en blanco para ese perfil, deja de salir en
 * Hoy y en Plan sin que este componente tenga que saber nada de preferencias.
 *
 * `selectedSlots`, si se pasa, es un cinturón extra sobre lo anterior: aunque
 * el día tenga contenido en un slot (p. ej. porque se espejó desde el plato
 * compartido de otro miembro del hogar — `composeDayForUser` no conoce las
 * preferencias de cada persona), aquí se descarta igual si esa persona no
 * quiere ese slot. Se usa en las pantallas (Hoy, Plan, detalle del día); el
 * resto de usos internos (chat, intercambiar un plato) no lo necesitan.
 */
export function mealsForDate(
  plan: MonthlyPlan | null,
  date: string,
  selectedSlots?: readonly MealSlot[],
): PlanMeal[] {
  const found = planForDate(plan, date);
  const { dayIndex } = planCursor(date);
  const rotate = (options: string[]) => (options.length ? options[dayIndex % options.length]! : "");
  const day = found?.day ?? null;
  const off = (slot: MealSlot) => day?.extras?.[slot] ?? [];
  const allowed = selectedSlots ? new Set(selectedSlots) : null;

  const meal = (slot: MealSlot, idea: string): PlanMeal | null => {
    if (!idea || (allowed && !allowed.has(slot))) return null;
    return { moment: MEAL_SLOT_LABEL[slot], slot, idea, off: off(slot) };
  };

  return [
    meal("desayuno", day?.breakfast || rotate(found?.week.breakfasts ?? [])),
    meal("comida", day?.lunch ?? ""),
    meal("cena", day?.dinner ?? ""),
    meal("snack", day?.snack || rotate(found?.week.snacks ?? [])),
  ].filter((m): m is PlanMeal => m !== null);
}

export type MealStatus = "plan" | "distinto" | "salteo";

/**
 * Una comida dentro del registro del día (`daily_logs.habits`). Vive aquí y no
 * en `daily.ts` porque `reconcileHabits` la necesita y `daily.ts` ya importa
 * este módulo (al revés sería un ciclo).
 */
export type MealHabit = {
  label: string;
  done: boolean;
  status?: MealStatus;
  /**
   * Plato que el PLAN proponía para ese momento, congelado la primera vez que
   * se ve el día y nunca reescrito. Es lo que Hoy tacha bajo el plato real:
   * cambies una vez o veinte, el tachado sigue siendo la sugerencia original.
   * Sustituye a `wasIdea`, que guardaba "lo que había justo antes del último
   * cambio" y por tanto se iba desplazando con cada cambio encadenado.
   */
  plannedIdea?: string;
  /** Antecesor de `plannedIdea`. Solo se lee, para registros ya guardados. */
  wasIdea?: string;
  /**
   * kcal que la guía estimaba para el plato del plan de ese momento, congeladas
   * igual que `plannedIdea`. El desvío que se le pasa a la IA se mide siempre
   * contra el PLAN, no contra el último cambio: si no, cambiar dos veces una
   * cena daba un desvío medido contra el cambio intermedio (y podía salir
   * negativo tras comerse una pizza).
   */
  plannedKcal?: number;
  /** Proteína (g) del plato del plan, congelada igual que `plannedKcal` (ticket 13). */
  plannedProtein?: number;
  /**
   * kcal que la persona apuntó a mano porque su texto no permitía calcular el
   * plato ("comí algo rápido", ticket 13). La cifra es suya, no un promedio.
   */
  manualKcal?: number;
  /** Qué comió realmente cuando status === "distinto". Se escribe desde el
   * DayDetailSheet al corregir un día pasado — el plan no cambia, pero el
   * historial queda correcto. */
  actual?: string;
  /** Días futuros que se recolocaron para compensar este cambio. Lo escribe el
   * lote de `use-meal-swap`, en todas las comidas del mismo lote. */
  adjustmentChanges?: MealChange[];
  /** Explicación en una frase del mismo ajuste. */
  adjustmentSummary?: string;
  /** Desvío estimado en kcal del lote frente a lo que preveía el plan. */
  adjustmentKcal?: number;
  /**
   * Desvío en kcal de ESTA comida frente al plan, capturado al cambiarla
   * (`compensateDishChanges`). Se sobrescribe si se vuelve a cambiar la misma
   * comida. Vive aparte de `adjustmentKcal` (que es el total ya compensado de
   * un lote) porque hace falta poder sumar el desvío de varios cambios
   * repartidos en distintos lotes del mismo día antes de que ninguno cruce el
   * umbral por separado — ver `pendingSwapKcal`.
   */
  swapKcalDelta?: number;
  /**
   * Desvío de proteína (g) de ESTA comida frente al plan, con la misma
   * contabilidad que `swapKcalDelta` (se compensa a la vez, `swapCompensated`, y
   * se devuelve con el signo contrario al deshacer). Ticket 13: una bajada de
   * proteína de 20 g o más se compensa con cualquier objetivo.
   */
  swapProteinDelta?: number;
  /** Si `swapKcalDelta` (y `swapProteinDelta`) ya se mandaron a `reflowMeals`. */
  swapCompensated?: boolean;
  /**
   * Plato que había en el plan cuando se confirmó "comí esto" o "comí otra
   * cosa" — no lo que se comió, sino contra qué momento del plan se confirmó.
   * `reconcileHabits` lo compara con el plato actual del plan para detectar
   * una confirmación obsoleta (un plato compartido que el hogar cambia por
   * detrás, nunca una recolocación automática, que no toca hoy).
   */
  confirmedIdea?: string;
};

/**
 * El plato que hay que tachar bajo el plato real de una comida: la sugerencia
 * original del plan, o `null` si lo que se ve ya es esa sugerencia. Cae a
 * `wasIdea` para registros anteriores a `plannedIdea`.
 */
export function suggestedDish(habit: MealHabit, currentIdea: string): string | null {
  const suggested = habit.plannedIdea || habit.wasIdea;
  return suggested && suggested !== currentIdea ? suggested : null;
}

/**
 * kcal de cambios de plato de hoy que todavía no se han mandado a
 * `reflowMeals` (con signo): la suma de `swapKcalDelta` de las comidas cuyo
 * `swapCompensated` no es `true`. Mismo papel que `pendingSnackKcal` para el
 * picoteo — deja que dos cambios pequeños en lotes distintos se sumen hasta
 * pasar el umbral de `compensationNeed` aunque ninguno lo cruce por separado.
 */
export function pendingSwapKcal(habits: readonly MealHabit[]): number {
  let total = 0;
  for (const h of habits) {
    if (h.swapCompensated || h.swapKcalDelta == null) continue;
    total += h.swapKcalDelta;
  }
  return Math.round(total);
}

/** Igual que `pendingSwapKcal`, para la proteína (g, con signo). */
export function pendingSwapProtein(habits: readonly MealHabit[]): number {
  let total = 0;
  for (const h of habits) {
    if (h.swapCompensated || h.swapProteinDelta == null) continue;
    total += h.swapProteinDelta;
  }
  return Math.round(total);
}

/**
 * Casa el registro del día con las comidas que el plan tiene HOY para esta
 * persona (ya filtradas por `effectiveMealSlots`).
 *
 * Hace falta porque `daily_logs.habits` se escribe UNA vez, al crear el día, y
 * lo crea quien toque el día primero con la lista que tenga a mano: abrir el
 * chat antes que Hoy lo crea vacío, y `logTodayWeight` lo creaba con todas las
 * comidas. A partir de ahí nadie lo reconciliaba, así que una comida
 * descartada en el onboarding seguía apareciendo en Hoy para siempre.
 *
 * Conserva por `label` todo lo que es del registro y no del plan (qué marcaste,
 * qué comiste, el ajuste), descarta las comidas que ya no se planifican, añade
 * las que falten y congela `plannedIdea` la primera vez que ve cada comida.
 *
 * `changed` es `false` cuando no hay nada que guardar — quien llama lo usa para
 * no escribir en bucle en cada render.
 */
export function reconcileHabits(
  habits: readonly MealHabit[] | null | undefined,
  meals: readonly { moment: string; idea: string }[],
): { habits: MealHabit[]; changed: boolean } {
  const previous = habits ?? [];
  const byLabel = new Map(previous.map((h) => [h.label, h]));
  const next = meals.map((m) => {
    const existing = byLabel.get(m.moment);
    if (!existing) return { label: m.moment, done: false, plannedIdea: m.idea || undefined };
    // Una confirmación ("comí esto" / "comí otra cosa") queda obsoleta si el
    // plato que hay AHORA en ese momento ya no es el que se confirmó: pasa
    // cuando el hogar espeja por detrás un cambio del planificador sobre una
    // comida compartida, nunca por una recolocación automática (que no toca
    // hoy). Se trata como una comida nueva — si no, Hoy seguía marcando como
    // "ya comido" un plato distinto al que de verdad se sirvió, y la barra de
    // macros sumaba las kcal congeladas del plato antiguo bajo el nombre del
    // nuevo.
    if (
      existing.status &&
      existing.status !== "salteo" &&
      existing.confirmedIdea &&
      existing.confirmedIdea !== m.idea
    ) {
      return { label: m.moment, done: false, plannedIdea: m.idea || undefined };
    }
    // `plannedIdea` solo se rellena si falta: una vez congelado no se toca ni
    // aunque el plato del plan haya cambiado (que es justo lo que pasa tras un
    // cambio a mano — `setPlanMeal` escribe el plato nuevo en el plan).
    return existing.plannedIdea || !m.idea
      ? existing
      : { ...existing, plannedIdea: existing.wasIdea || m.idea };
  });
  // Comparación por identidad: las comidas que no cambian se devuelven tal
  // cual, así que basta con mirar si alguna posición trae otro objeto. También
  // detecta un reordenado, que se aprovecha para dejar el registro en el mismo
  // orden que el plan (y por tanto no vuelve a dispararse a la siguiente).
  const changed = next.length !== previous.length || next.some((h, i) => h !== previous[i]);
  return { habits: next, changed };
}

/**
 * Igualdad estructural entre dos listas de comidas del registro del día.
 *
 * `daily_logs.habits` es una única columna JSON con dos escritores de
 * estrategias distintas: `patchTodayHabits` (relee la fila justo antes de
 * escribir) y el guardado de la reconciliación de Hoy, que manda la lista
 * entera que tenía en memoria. Antes de reescribir la columna con lo segundo
 * hay que comprobar que la fila sigue siendo la que se reconcilió; si no, un
 * cambio de plato hecho a la vez (que escribe `status`/`done`/`confirmedIdea`)
 * se perdía debajo de una lista construida desde la caché vieja.
 *
 * Compara el JSON tal y como vuelve de Postgres, donde una clave puesta a
 * `undefined` sencillamente no existe: `{done:false}` y
 * `{done:false, status:undefined}` son la misma comida.
 */
export function sameHabits(
  a: readonly MealHabit[] | null | undefined,
  b: readonly MealHabit[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((h, i) => sameJson(h, right[i]));
}

/** Igualdad estructural sobre valores JSON — ver `sameHabits`. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameJson(v, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set(Object.keys(left).concat(Object.keys(right)));
  for (const key of keys) {
    if (!sameJson(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Platos aparte de un niño para una fecha (issue 07): devuelve solo los slots
 * con override propio para ese niño; en el resto de comidas el niño come el
 * plato compartido del día, así que no aparecen aquí.
 */
export function childMealsForDate(
  plan: MonthlyPlan | null,
  date: string,
  childId: string,
): { slot: MealSlot; dish: string; off: string[] }[] {
  const day = planForDate(plan, date)?.day;
  if (!day?.kids?.length) return [];
  return day.kids
    .filter((k) => k.childId === childId && k.dish)
    .map((k) => ({ slot: k.slot, dish: k.dish, off: k.off ?? [] }));
}

export type ChildPureeGap = { date: string; slot: "comida" | "cena" };

/**
 * Días (de `today` a fin de mes) en los que un bebé de triturados come en casa
 * pero el plan todavía no tiene su puré para esa comida — pasa cuando se da de
 * alta o se cambia de etapa a un bebé DESPUÉS de generar el plan del mes, ya
 * que solo la IA de `generateMonthlyPlan` rellena `days[].kids`. Solo mira
 * comida y cena (igual que el prompt de generación): el desayuno y el snack no
 * llevan plato aparte de un niño. Nunca mira hacia atrás: un día pasado no se
 * puede recolocar.
 */
export function childPureeGaps(
  plan: MonthlyPlan | null,
  child: { id: string; stage: FeedingStage; homeSchedule: HomeSchedule },
  today: string,
): ChildPureeGap[] {
  if (!plan || child.stage !== "triturados") return [];
  const month = today.slice(0, 7);
  const gaps: ChildPureeGap[] = [];
  for (let i = 0; ; i++) {
    const date = addDays(today, i);
    if (date.slice(0, 7) !== month) break;
    const day = planForDate(plan, date)?.day;
    if (!day) continue;
    const { dayIndex } = planCursor(date);
    for (const slot of ["comida", "cena"] as const) {
      if (!isSharedSlot(child.homeSchedule, slot, dayIndex)) continue;
      const hasEntry = (day.kids ?? []).some((k) => k.childId === child.id && k.slot === slot);
      if (!hasEntry) gaps.push({ date, slot });
    }
  }
  return gaps;
}

/**
 * Marcas de "elegido a mano" de un día de un miembro del hogar tras espejar las
 * comidas compartidas: igual que el plato de un niño, la marca viaja con su
 * comida. En un slot compartido manda la del planificador (el plato es suyo) y
 * en el resto se conserva la propia. Si no, un miembro que tenía fijada su cena
 * en solitario seguiría protegiendo el plato del planificador cuando esa cena
 * pasa a ser compartida.
 */
export function mirrorPinned(
  own: PlanDay,
  source: PlanDay,
  sharedSlots: ReadonlySet<string>,
): MealSlot[] | undefined {
  const pins = new Set([
    ...(own.pinned ?? []).filter((s) => !sharedSlots.has(s)),
    ...(source.pinned ?? []).filter((s) => sharedSlots.has(s)),
  ]);
  const ordered = MEAL_SLOTS.filter((s) => pins.has(s));
  return ordered.length ? ordered : undefined;
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

  // El plato aparte de un niño (issue 07) lo pone el planificador y va con la
  // comida compartida: se trae el del planificador para un slot compartido y se
  // conserva el propio (raro) para un slot que ese día no se comparte.
  const sharedSet = new Set<string>(shared);
  const kids = [
    ...(mineDay.kids ?? []).filter((k) => !sharedSet.has(k.slot)),
    ...(plannerDay.kids ?? []).filter((k) => sharedSet.has(k.slot)),
  ];
  // Si el resultado son los mismos platos que ya había, se deja el array tal
  // cual: recomponer un día que no cambia (quien planifica congelando sus
  // compartidas) no debe reescribirlo solo por cambiarles el orden.
  const kidsKey = (list: readonly ChildMeal[]) =>
    list
      .map((k) => JSON.stringify(k))
      .sort()
      .join("|");
  if (kids.length) {
    next.kids = mineDay.kids && kidsKey(mineDay.kids) === kidsKey(kids) ? mineDay.kids : kids;
  } else delete next.kids;

  const pinned = mirrorPinned(mineDay, plannerDay, sharedSet);
  if (pinned) next.pinned = pinned;
  else delete next.pinned;
  return next;
}

/**
 * El plan mensual que ve un miembro del hogar: compone cada día con
 * `composeDayForUser` y, cuando el desayuno se comparte, también sustituye la
 * rotación semanal (`week.breakfasts`) por la del planificador — igual que
 * hace `syncSharedMeals`, porque un desayuno sin plato a mano para ESE día
 * rota entre las ideas de la semana, y esas ideas tienen que ser las de la
 * casa, no las propias. Sin plan propio (`mine` null) compone igualmente,
 * sobre un esqueleto en blanco con los mismos rótulos de semana/día que el
 * del planificador, para que las comidas compartidas se vean aunque la
 * persona no haya planificado nada suyo todavía.
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
    } satisfies MonthlyPlan);

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

// ---------------------------------------------------------------------------
// Diff de platos futuros tras un ajuste del plan
// ---------------------------------------------------------------------------

/**
 * Un plato del plan que cambió entre la versión anterior y la posterior de un
 * `adjustMonthlyPlan`. Usado por el badge "i" de Hoy para mostrar qué efecto
 * tuvo el cambio de plato en el plan futuro.
 */
export type MealChange = {
  date: string;
  slot: MealSlot;
  slotLabel: string;
  before: string;
  after: string;
};

/**
 * Compara los platos de los días FUTUROS (posteriores a `today`) entre dos
 * versiones del plan y devuelve los que cambiaron. Ignora el día de hoy y
 * anteriores (están fijados). Compara solo lunch y dinner — desayunos y snacks
 * no los recoloca `adjustMonthlyPlan` (giran por semana, no por día).
 */
export function diffFutureMeals(
  before: MonthlyPlan | null,
  after: MonthlyPlan | null,
  today: string,
): MealChange[] {
  if (!before || !after) return [];
  const month = today.slice(0, 7);
  const changes: MealChange[] = [];
  const totalDays = daysInMonth(month);

  for (let d = 1; d <= totalDays; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    if (date <= today) continue; // solo días futuros

    const mealsBefore = mealsForDate(before, date);
    const mealsAfter = mealsForDate(after, date);

    for (const mb of mealsBefore) {
      // Solo comparar comida y cena — lo que adjustMonthlyPlan recoloca
      if (mb.slot !== "comida" && mb.slot !== "cena") continue;
      const ma = mealsAfter.find((m) => m.slot === mb.slot);
      if (ma && ma.idea && mb.idea && ma.idea !== mb.idea) {
        changes.push({
          date,
          slot: mb.slot,
          slotLabel: MEAL_SLOT_LABEL[mb.slot],
          before: mb.idea,
          after: ma.idea,
        });
      }
    }
  }
  return changes;
}

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Días hacia delante en los que se reparte una compensación. */
export const COMPENSATION_WINDOW_DAYS = 6;

/**
 * Fechas en las que se puede absorber un desvío de HOY (el picoteo, y más
 * adelante cualquier cambio de plato, ticket 08 de `hoy-semanas-editables`):
 * de mañana a hoy + `days`, dentro del mismo mes.
 *
 * Solo quedan las fechas con al menos una comida o cena PROPIA ese día: un
 * desvío personal se corrige en las comidas no compartidas de esa persona,
 * nunca cambiando la mesa de toda la casa. Y solo las que son la fecha real de
 * su celda (`dateOfPlanCell`): los días 29 en adelante comparten celda con la
 * semana 3 y una recolocación sobre ellos se descarta, así que ofrecerlos
 * gastaría una llamada a la IA que no puede cambiar nada.
 *
 * `reason` explica una ventana vacía: `no-meals` (no planifica comidas ni
 * cenas), `no-days` (se acaba el mes) o `shared-only` (quedan días, pero todas
 * sus comidas y cenas son de la casa).
 */
export function compensationWindow(opts: {
  today: string;
  sharedSlots: SharedSlots;
  selectedSlots: readonly MealSlot[];
  /**
   * Sin otro adulto con quien compartir la mesa, "compartido" no protege a
   * nadie más: se tratan como propias igualmente (p. ej. una persona adulta
   * sola con peques a cargo).
   */
  soloAdult?: boolean;
  days?: number;
}): { dates: string[]; reason: "no-meals" | "no-days" | "shared-only" | null } {
  const month = opts.today.slice(0, 7);
  const days = opts.days ?? COMPENSATION_WINDOW_DAYS;
  const movable = (["comida", "cena"] as const).filter((s) => opts.selectedSlots.includes(s));
  if (!movable.length) return { dates: [], reason: "no-meals" };
  const inMonth: string[] = [];
  const dates: string[] = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(opts.today, i);
    if (date.slice(0, 7) !== month) break;
    const { weekIndex, dayIndex } = planCursor(date);
    if (dateOfPlanCell(month, weekIndex, dayIndex) !== date) continue;
    inMonth.push(date);
    if (opts.soloAdult || movable.some((slot) => !isSharedSlot(opts.sharedSlots, slot, dayIndex)))
      dates.push(date);
  }
  if (dates.length) return { dates, reason: null };
  return { dates, reason: inMonth.length ? "shared-only" : "no-days" };
}

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
