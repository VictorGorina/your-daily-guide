import type { PlanDay } from "../plan-shared";

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
