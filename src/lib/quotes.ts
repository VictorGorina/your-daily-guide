/** Cuántas frases hay en el catálogo (`quotes`); un test lo comprueba en los dos idiomas. */
export const QUOTE_COUNT = 31;

/**
 * Índice de la frase del día en el catálogo (`quotes.<n>.text` / `.author`):
 * la misma durante todo el día, distinta cada día.
 */
export function quoteIndexOfTheDay(date: Date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return dayOfYear % QUOTE_COUNT;
}
