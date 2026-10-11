import { cleanGuide } from "@/lib/day-row";
import { isMealCalculated } from "@/lib/macros";

/**
 * Lo que `/api/chat` manda al modelo de más en cada turno, recortado (ticket 32
 * de la auditoría, SEC-S-02 y PERF-15). Puro: lo usa la ruta y lo prueban los
 * tests.
 *
 * Cada turno llevaba el historial entero del día y la guía tal cual se guarda,
 * así que el coste de un turno crecía con la conversación.
 */

/**
 * Cuántos mensajes del historial llegan al modelo, leído de
 * `CHAT_HISTORY_MAX`. Sin definir, vacía o que no sea un entero ≥ 1: sin
 * límite (es el rollback del ticket).
 */
export function chatHistoryMax(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : Infinity;
}

/**
 * Los últimos `max` mensajes, con dos cuidados:
 *
 * - El último mensaje de la persona se conserva siempre, aunque quede antes
 *   del corte (tras varios pasos de herramienta seguidos).
 * - La ventana empieza por un mensaje de la persona: si el corte cae en uno
 *   del coach (una respuesta, o una herramienta con su resultado, que en un
 *   `UIMessage` van en el mismo mensaje), se recorta también. Un historial que
 *   arranca con el coach contestando a algo que ya no está confunde al modelo,
 *   y algunos proveedores lo rechazan.
 *
 * Devuelve el mismo array si no hay nada que recortar.
 */
export function trimHistory<T extends { role: string }>(messages: T[], max: number): T[] {
  if (!(max >= 1) || messages.length <= max) return messages;
  let start = messages.length - max;
  let lastUser = messages.length - 1;
  while (lastUser >= 0 && messages[lastUser]!.role !== "user") lastUser--;
  if (lastUser < 0) return messages.slice(start);
  if (lastUser < start) start = lastUser;
  while (messages[start]!.role !== "user") start++;
  return messages.slice(start);
}

export type CompactGuide = {
  /** El texto de calorías de la guía; solo si la persona ve cifras. */
  calorias?: string;
  comidas: { momento: string; plato: string; kcal?: number }[];
};

/**
 * La guía del día reducida a lo que el coach usa: las comidas (momento, plato
 * y sus kcal) y el texto de calorías. El objetivo ya va en `coachSystemPrompt`
 * y el resto (introducción, consejos, macros por plato) es texto que el coach
 * no necesita releer en cada turno.
 *
 * Con `numbers: false` (`showsNutritionNumbers`) no sale ninguna cifra. Un
 * plato que se está calculando va sin kcal: sus cifras a 0 no son un dato
 * (D13). `null` si no hay guía o no queda nada que contar.
 */
export function compactGuide(raw: unknown, numbers: boolean): CompactGuide | null {
  const guide = cleanGuide(raw);
  if (!guide) return null;

  const macros = guide.mealMacros ?? [];
  const kcalOf = (moment: string, idea: string): number | undefined => {
    const macro =
      macros.find((m) => m.moment === moment && m.idea === idea) ??
      macros.find((m) => m.moment === moment && !m.idea);
    return macro && isMealCalculated(macro) && macro.kcal > 0 ? Math.round(macro.kcal) : undefined;
  };
  // Una guía sin `meals` (anterior a ese campo) cuenta con lo que digan sus macros.
  const meals = guide.meals?.length
    ? guide.meals
    : macros.map((m) => ({ moment: m.moment, idea: m.idea ?? "" }));

  const comidas = meals
    .filter((m) => m.idea)
    .map((m) => {
      const kcal = numbers ? kcalOf(m.moment, m.idea) : undefined;
      return { momento: m.moment, plato: m.idea, ...(kcal === undefined ? {} : { kcal }) };
    });
  const calorias = numbers && guide.calories ? guide.calories : undefined;

  if (!comidas.length && !calorias) return null;
  return { ...(calorias ? { calorias } : {}), comidas };
}
