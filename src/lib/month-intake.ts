/**
 * La conversación con el coach antes de generar el plan de un mes: cinco
 * preguntas guiadas, cada una con respuestas rápidas (chips) y texto libre.
 * Un mes se genera UNA sola vez (no hay "regenerar"), así que lo que la
 * persona tenga que contar de su mes se pregunta aquí, antes, y no después.
 *
 * Aquí vive solo lo que llega al prompt, en español canónico: la etiqueta de
 * cada pregunta y sus chips. Lo que ve la persona (pregunta, chips, ejemplo)
 * sale del catálogo (`monthIntake.*`), con los chips en el mismo orden; el chip
 * elegido se guarda siempre con el texto de aquí, en cualquier idioma.
 *
 * Puro y compartido: las preguntas las pintan `MonthIntakeChat` (web y móvil,
 * copia en `mobile/lib/month-intake.ts`) y el texto que llega al prompt lo
 * arma `monthIntakeNotes` en el servidor (`setMonthConstraints`), que lo
 * guarda en `month_constraints.notes`. La ausencia (fechas) va aparte, en
 * `away_start`/`away_end`, porque el prompt la trata día a día (`awayPlanLine`).
 */

export type AwayPreset = "no" | "few" | "week";

/** Las cuatro preguntas de texto; la de ausencia tiene su propia forma. */
export type IntakeTextKey = "events" | "routine" | "ingredients" | "notes";

export type IntakeTextQuestion = {
  key: IntakeTextKey;
  /** Etiqueta con la que la respuesta entra al prompt. */
  label: string;
  /** Respuestas rápidas. La primera es siempre "nada que contar". */
  chips: readonly string[];
};

/** Las respuestas de la pregunta de ausencia, en el orden en que se pintan. */
export const AWAY_PRESETS: readonly AwayPreset[] = ["no", "few", "week"];

export const INTAKE_TEXT_QUESTIONS: readonly IntakeTextQuestion[] = [
  {
    key: "events",
    label: "Eventos o comidas fuera",
    chips: ["Nada especial", "Alguna comida fuera", "Una celebración", "Varias comidas fuera"],
  },
  {
    key: "routine",
    label: "Horario o rutina",
    chips: ["Igual que siempre", "Menos tiempo para cocinar", "Vacaciones", "Más deporte"],
  },
  {
    key: "ingredients",
    label: "Ingredientes a usar o evitar",
    chips: ["Nada especial", "Aprovechar lo que tengo en casa", "Probar cosas nuevas"],
  },
  {
    key: "notes",
    label: "Otras notas",
    chips: ["Nada más"],
  },
];

/** Una respuesta de texto: el chip elegido (si hay) y lo que escribió. */
export type IntakeTextAnswer = { chip: string | null; text: string };

export type IntakeAnswers = Partial<Record<IntakeTextKey, IntakeTextAnswer>>;

/** Tope por respuesta: da para contar algo concreto sin inflar el prompt. */
export const INTAKE_ANSWER_MAX = 200;

/**
 * Deja una respuesta lista para ir DENTRO del prompt como dato: una sola
 * línea, sin comillas ni «» (con ellas se podría cerrar la cita y escribir
 * instrucciones fuera), recortada a `INTAKE_ANSWER_MAX`.
 */
export function cleanIntakeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["«»“”]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, INTAKE_ANSWER_MAX);
}

/** ¿Es el chip de "nada que contar" de su pregunta? No aporta al prompt. */
function isNothingChip(q: IntakeTextQuestion, chip: string) {
  return chip === q.chips[0];
}

/**
 * Texto de una respuesta para enseñarla en la conversación ("Alguna comida
 * fuera — el sábado 10"), o `null` si no respondió nada. `chipLabel` pinta el
 * chip en el idioma de la persona; sin él sale el canónico.
 */
export function intakeAnswerText(
  answer: IntakeTextAnswer | undefined,
  chipLabel: (chip: string) => string = (chip) => chip,
): string | null {
  if (!answer) return null;
  const rawChip = cleanIntakeText(answer.chip);
  const chip = rawChip ? chipLabel(rawChip) : "";
  const text = cleanIntakeText(answer.text);
  if (chip && text) return `${chip} — ${text}`;
  return chip || text || null;
}

/**
 * Las respuestas de texto como un bloque para el prompt del plan, una línea
 * por pregunta con su etiqueta. Se omite lo que no aporta: el chip de "nada
 * que contar" sin texto, o una pregunta sin responder. `null` si no queda nada.
 */
export function monthIntakeNotes(answers: IntakeAnswers | null | undefined): string | null {
  if (!answers) return null;
  const lines: string[] = [];
  for (const q of INTAKE_TEXT_QUESTIONS) {
    const a = answers[q.key];
    if (!a) continue;
    const chip = cleanIntakeText(a.chip);
    const text = cleanIntakeText(a.text);
    const useChip = chip && q.chips.includes(chip) && !isNothingChip(q, chip) ? chip : "";
    const value = useChip && text ? `${useChip} (${text})` : useChip || text;
    if (value) lines.push(`${q.label}: ${value}`);
  }
  return lines.length ? lines.join(". ") : null;
}
