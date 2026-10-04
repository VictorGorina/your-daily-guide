import { ageFromDOB } from "@/lib/age";
import type { MealSlot } from "@/lib/plan-shared";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

/**
 * Guion del onboarding: qué se pregunta, en qué orden, con qué chips y qué
 * pregunta encadena cada respuesta. Es puro y no lleva texto: cada pregunta y
 * cada chip tienen un identificador estable y su texto vive en el catálogo
 * (`onboarding.q.<id>`), para que la pantalla salga en el idioma de la persona
 * sin que cambie lo que se guarda (ticket 34, B2). Copia en
 * `mobile/lib/onboarding-script.ts` (drift check).
 *
 * Las respuestas siguen siendo texto libre, también las de chips: un chip solo
 * escribe su etiqueta en el campo. Por eso lo que decide algo (qué comidas se
 * planifican, si se ven las cifras, qué pregunta va detrás) se lee con
 * `chipsOfAnswer`, que reconoce la etiqueta en cualquiera de los idiomas: un
 * progreso guardado en español sigue valiendo si la persona cambia a inglés.
 */

export type OnboardingError =
  "bioBoth" | "bioWeight" | "bioHeight" | "times" | "meals" | "dobFormat" | "dobAge";

export type Question = {
  /** Clave del catálogo: `onboarding.q.<id>.text`. */
  id: string;
  /** Tiene texto de ayuda en `onboarding.q.<id>.hint`. */
  hint?: true;
  /** Identificadores de los chips; su etiqueta, en `onboarding.q.<id>.chips`. */
  chips?: readonly string[];
  /** Los chips son su propia etiqueta (números): no pasan por el catálogo. */
  literalChips?: true;
  /** Los chips son de selección única salvo que se marque lo contrario. */
  multi?: true;
  optional?: true;
  /** La respuesta es una fecha (selector en la web, DD/MM/AAAA en el móvil). */
  dateInput?: true;
  validate?: (text: string) => OnboardingError | null;
  /** Pregunta que se inserta justo detrás si `test` acepta la respuesta. */
  followUp?: { test: (answer: string) => boolean; question: Question };
};

export type Screen = { id: string; questions: Question[] };

// --- Catálogo: claves y etiquetas ---------------------------------------------

type QuestionCopy = { chips?: Record<string, string> };
const COPY = [es, en].map((c) => c.onboarding.q as unknown as Record<string, QuestionCopy>);

export const screenTitleKey = (screen: Screen) => `onboarding.screens.${screen.id}.title`;
export const screenSubtitleKey = (screen: Screen) => `onboarding.screens.${screen.id}.subtitle`;
export const questionKey = (q: Question) => `onboarding.q.${q.id}.text`;
/** `typed`: la fecha se teclea (móvil) en vez de elegirse en un calendario. */
export const hintKey = (q: Question, typed = false) =>
  q.hint ? `onboarding.q.${q.id}.${typed && q.dateInput ? "hintTyped" : "hint"}` : null;
export const chipKey = (q: Question, chip: string) => `onboarding.q.${q.id}.chips.${chip}`;
export const errorKey = (error: OnboardingError, typed = false) =>
  `onboarding.errors.${error}${typed && error === "dobFormat" ? "Typed" : ""}`;

/** Las etiquetas de un chip en todos los idiomas del catálogo. */
const chipLabels = (q: Question, chip: string): string[] =>
  q.literalChips
    ? [chip]
    : COPY.map((copy) => copy[q.id]?.chips?.[chip]).filter((l): l is string => !!l);

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Los chips que elige una respuesta, por identificador y en su orden. Una
 * pregunta de varios chips los trae separados por comas; una de uno solo, la
 * etiqueta entera (que puede llevar comas: "Sí, embarazada").
 */
export const chipsOfAnswer = (q: Question, answer: string | undefined): string[] => {
  const text = (answer ?? "").trim();
  if (!text || !q.chips) return [];
  const parts = q.multi ? text.split(",") : [text];
  return q.chips.filter((chip) =>
    chipLabels(q, chip).some((label) => parts.some((part) => sameText(part, label))),
  );
};

// --- Lectura de respuestas libres ---------------------------------------------

/** Coma decimal a punto ("61,5 kilos y 1,65 m"); las comas de la frase se quedan. */
const num = (t: string) => t.replace(/(\d),(?=\d)/g, "$1.");

/** Una respuesta con contenido frente a un "no" / "ninguna" / "none". */
const mentionsSomething = (t: string) =>
  !/^\s*(ning[uú]n[ao]?s?|no|nada|none|nothing|nope)\b/i.test(t.trim());

export type Biometrics = { age: number | null; weight: number | null; height: number | null };

/** Lee edad, peso y altura de una frase libre, con o sin unidades. */
export const parseBiometrics = (raw: string): Biometrics => {
  const t = num(raw).toLowerCase();
  let age: number | null = null;
  let weight: number | null = null;
  let height: number | null = null;

  const unit = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };

  age = unit(/(\d{1,3})\s*(?:años|anos|año|years?|yrs?|a\b)/);
  weight = unit(/(\d{2,3}(?:\.\d+)?)\s*(?:kg|kilos?|kilogramos?|kilograms?)/);
  height = unit(/(\d{2,3}(?:\.\d+)?)\s*(?:cm|cent[ií]metros?|centimetros?|centimet(?:er|re)s?)/);
  const meters = unit(/([12](?:\.\d{1,2}))\s*(?:m|metros?|met(?:er|re)s?)\b/);
  if (!height && meters) height = Math.round(meters * 100);

  // Números sueltos: los asignamos por rango plausible.
  const numbers = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const used = new Set<number>(
    [age, weight, height, meters].filter((n): n is number => n !== null),
  );
  for (const n of numbers) {
    if (used.has(n)) continue;
    if (!height && ((n >= 120 && n <= 250) || (n >= 1.2 && n <= 2.5))) {
      height = n <= 2.5 ? Math.round(n * 100) : n;
      used.add(n);
      continue;
    }
    if (!weight && n >= 30 && n <= 350) {
      weight = n;
      used.add(n);
      continue;
    }
    if (!age && n >= 10 && n <= 100) {
      age = n;
      used.add(n);
    }
  }
  return { age, weight, height };
};

const validateBiometrics = (raw: string): OnboardingError | null => {
  const { weight, height } = parseBiometrics(raw);
  if (!weight && !height) return "bioBoth";
  if (!weight) return "bioWeight";
  if (!height) return "bioHeight";
  return null;
};

const validateTimes = (raw: string): OnboardingError | null => {
  const hours = num(raw).match(/\b([01]?\d|2[0-3])(?:[:.]\d{2})?\s*(h|am|pm)?\b/gi) ?? [];
  return hours.length < 2 ? "times" : null;
};

const validateMeals = (raw: string): OnboardingError | null => {
  const n = Number((num(raw).match(/\d+(?:\.\d+)?/) ?? [])[0]);
  return !n || n < 1 || n > 8 ? "meals" : null;
};

/** `raw` es la fecha en ISO (YYYY-MM-DD). */
const validateDOB = (raw: string): OnboardingError | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "dobFormat";
  const age = ageFromDOB(raw);
  if (age === null || age < 12 || age > 110) return "dobAge";
  return null;
};

/** De ISO a DD/MM/AAAA, que es como se enseña y se guarda la respuesta. */
export const formatDatePretty = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/**
 * De lo tecleado a ISO. Tolera cualquier separador (/, -, ., espacio) y los dos
 * órdenes: DD?MM?AAAA (lo que pide el placeholder) o AAAA?MM?DD. El teclado
 * numérico de iOS y su puntuación "inteligente" pueden cambiar el separador.
 */
export const parseDatePretty = (pretty: string): string | null => {
  const parts = pretty.trim().split(/\D+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  const [y, mo, d] = a.length === 4 ? [a, b, c] : [c, b, a];
  if (y.length !== 4 || mo.length > 2 || d.length > 2) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

// --- Preguntas ------------------------------------------------------------------
// Las "hoja" (sin follow-up propio) van primero porque otras las referencian en
// su `followUp`. Ver "Radiografía del onboarding" para el porqué de cada una.

const ALLERGY_SEVERITY_Q: Question = { id: "allergySeverity", hint: true, optional: true };

const MENSTRUAL_CYCLE_Q: Question = { id: "cycle", hint: true, optional: true };

export const PREGNANCY_Q: Question = {
  id: "pregnancy",
  hint: true,
  chips: ["pregnant", "breastfeeding", "no", "undisclosed"],
  // Si no está embarazada ni en lactancia, encadenamos la pregunta del ciclo;
  // si lo está, no tiene sentido preguntarla ahora.
  followUp: {
    test: (t) => {
      const [chip] = chipsOfAnswer(PREGNANCY_Q, t);
      if (chip) return chip === "no" || chip === "undisclosed";
      return !/embarazad|lactancia|pregnan|breastfeed|nursing/i.test(t);
    },
    question: MENSTRUAL_CYCLE_Q,
  },
};

const ED_HISTORY_Q: Question = {
  id: "edHistory",
  hint: true,
  chips: ["now", "past", "no", "undisclosed"],
};

const ALCOHOL_Q: Question = { id: "alcohol", chips: ["never", "sometimes", "often"] };

const CUISINE_Q: Question = {
  id: "cuisine",
  chips: ["mediterranean", "homestyle", "asian", "mexican", "italian", "everything"],
  multi: true,
};

export const MEALS_TO_PLAN_Q: Question = {
  id: "mealsToPlan",
  chips: ["breakfast", "lunch", "dinner", "snack"],
  multi: true,
};

const MEAL_SLOT_BY_CHIP: Record<string, MealSlot> = {
  breakfast: "desayuno",
  lunch: "comida",
  dinner: "cena",
  snack: "snack",
};

/**
 * `meal_slots` a partir de la respuesta a `MEALS_TO_PLAN_Q` ("Comida, Cena").
 * Sale del chip, sin pasar por `parseOnboarding`: ese paso manda toda la
 * conversación a la IA para resumirla en frases, y una selección clara podía
 * volver convertida en una frase que ya no se podía interpretar con seguridad.
 */
export const mealSlotsFromAnswer = (raw: string | undefined): MealSlot[] | null => {
  const slots = chipsOfAnswer(MEALS_TO_PLAN_Q, raw).map((chip) => MEAL_SLOT_BY_CHIP[chip]!);
  return slots.length ? slots : null;
};

const KITCHEN_EQUIPMENT_Q: Question = {
  id: "kitchen",
  chips: ["oven", "airFryer", "slowCooker", "cookingRobot", "stoveOnly", "microwave"],
  multi: true,
};

const COOKING_SKILL_Q: Question = { id: "cookingSkill", chips: ["basic", "good", "great"] };

const TRAINING_EXPERIENCE_Q: Question = {
  id: "trainingExperience",
  chips: ["none", "under1", "from1to3", "over3"],
};

const SMOKING_Q: Question = { id: "smoking", chips: ["no", "sometimes", "yes"] };

/**
 * Solo se pregunta si la respuesta a LIVES_WITH_Q menciona a la pareja: así
 * sabemos si el presupuesto que se pida más adelante (BUDGET_Q) debe ser el de
 * una persona o, si la pareja no va a usar la app, el total de la casa.
 */
export const PARTNER_APP_Q: Question = { id: "partnerApp", hint: true, chips: ["yes", "no"] };

/** ¿La pareja va a usar la app? `null` si no se preguntó o no queda claro. */
export const partnerUsesApp = (answer: string | undefined): boolean | null => {
  if (answer == null) return null;
  const [chip] = chipsOfAnswer(PARTNER_APP_Q, answer);
  if (chip) return chip === "yes";
  if (/^\s*(s[ií]|yes|yeah)(?![a-záéíóúñ])/i.test(answer)) return true;
  if (/^\s*no(?![a-záéíóúñ])/i.test(answer)) return false;
  return null;
};

/**
 * Pedimos la fecha exacta (no la edad suelta) para poder recalcularla sola con
 * el tiempo, en vez de quedarnos con una edad fija del día del onboarding.
 */
const BIRTHDATE_Q: Question = {
  id: "birthdate",
  hint: true,
  dateInput: true,
  validate: validateDOB,
};

export const BIO_Q: Question = {
  id: "bio",
  hint: true,
  validate: validateBiometrics,
  // Solo relevante para quien se identifica como mujer.
  followUp: { test: (t) => /\b(mujer|woman|female)\b/i.test(t), question: PREGNANCY_Q },
};

const LIVES_WITH_Q: Question = {
  id: "livesWith",
  hint: true,
  followUp: {
    test: (t) => /\b(pareja|partner|husband|wife|boyfriend|girlfriend|spouse)\b/i.test(t),
    question: PARTNER_APP_Q,
  },
};

/**
 * Ticket 01 de `precision-nutricional` (D3): ver cifras es una preferencia que
 * elige la persona, no algo que la app deduzca. Cambia lo que enseña toda la
 * app, así que se gana su sitio pese a la memoria `onboarding-direction`
 * (recortar preguntas).
 */
export const NUMBERS_Q: Question = { id: "numbers", hint: true, chips: ["show", "hide"] };

const NUMBERS_VALUE_BY_CHIP: Record<string, "mostrar" | "ocultar"> = {
  show: "mostrar",
  hide: "ocultar",
};

/** `nutrition_numbers` del chip elegido, sin pasar por la IA (como `meal_slots`). */
export const nutritionNumbersFromAnswer = (
  raw: string | undefined,
): "mostrar" | "ocultar" | undefined =>
  NUMBERS_VALUE_BY_CHIP[chipsOfAnswer(NUMBERS_Q, raw)[0] ?? ""];

export const BUDGET_Q: Question = { id: "budget", hint: true };

/** La de presupuesto cuando la pareja no usa la app: se pide el total de la casa. */
const BUDGET_HOUSEHOLD_Q: Question = { id: "budgetHousehold", hint: true };

/**
 * La pregunta tal como se enseña. Si la pareja no va a usar la app, no hay
 * quien más registre su parte del gasto: se pide el presupuesto de la casa.
 */
export const displayQuestion = (q: Question, partnerHasApp: boolean | null): Question =>
  q === BUDGET_Q && partnerHasApp === false ? BUDGET_HOUSEHOLD_Q : q;

export const SCREENS: Screen[] = [
  {
    id: "about",
    questions: [
      { id: "name", hint: true },
      BIRTHDATE_Q,
      BIO_Q,
      { id: "medical", hint: true, optional: true },
      SMOKING_Q,
      {
        id: "allergies",
        hint: true,
        followUp: { test: mentionsSomething, question: ALLERGY_SEVERITY_Q },
      },
    ],
  },
  {
    id: "routine",
    questions: [
      { id: "activity", hint: true },
      { id: "schedule", hint: true },
      {
        id: "mealsPerDay",
        chips: ["2", "3", "4", "5"],
        literalChips: true,
        validate: validateMeals,
      },
      MEALS_TO_PLAN_Q,
    ],
  },
  {
    id: "eating",
    questions: [
      { id: "cooking", hint: true },
      KITCHEN_EQUIPMENT_Q,
      COOKING_SKILL_Q,
      {
        id: "dietPattern",
        chips: ["omnivore", "flexitarian", "vegetarian", "vegan", "pescatarian", "glutenFree"],
        multi: true,
      },
      { id: "foods", hint: true },
      CUISINE_Q,
      ALCOHOL_Q,
      { id: "foodRelationship", hint: true, chips: ["calm", "anxious", "noTime"] },
      ED_HISTORY_Q,
    ],
  },
  {
    id: "home",
    questions: [
      LIVES_WITH_Q,
      { id: "kids", hint: true, optional: true },
      { id: "othersDiet", hint: true, optional: true },
      { id: "portions", hint: true },
    ],
  },
  {
    id: "goals",
    questions: [
      {
        id: "targetWeight",
        hint: true,
        followUp: {
          test: (t) => /músculo|musculo|fuerza|gym|gimnasio|pesas|muscle|strength|weights/i.test(t),
          question: TRAINING_EXPERIENCE_Q,
        },
      },
      NUMBERS_Q,
      { id: "deadline", hint: true },
      { id: "scope", chips: ["food", "habits", "energy"] },
      { id: "struggles", hint: true },
      BUDGET_Q,
    ],
  },
  {
    id: "coaching",
    questions: [
      { id: "tone", chips: ["relaxed", "neutral", "demanding"] },
      { id: "times", hint: true, validate: validateTimes },
    ],
  },
];

// --- Datos clave del resumen -----------------------------------------------------

export type GapKey = "current_weight_kg" | "height_cm" | "morning_time" | "evening_time";

/** Los datos sin los que no se guarda el perfil; se repasan antes de confirmar. */
export const KEY_FIELDS: GapKey[] = [
  "current_weight_kg",
  "height_cm",
  "morning_time",
  "evening_time",
];

export const GAP_TYPE: Record<GapKey, "number" | "time"> = {
  current_weight_kg: "number",
  height_cm: "number",
  morning_time: "time",
  evening_time: "time",
};

export const gapLabelKey = (key: GapKey) => `onboarding.gaps.${key}.label`;
export const gapHelpKey = (key: GapKey) => `onboarding.gaps.${key}.help`;

// --- Modelo plano y navegable ---------------------------------------------------
// El recorrido es navegable: se puede saltar a cualquier pregunta, corregir
// cualquier respuesta y aparcar preguntas. Para eso SCREENS se aplana a una lista
// de nodos con clave estable. Los follow-ups condicionales (embarazo, pareja,
// gravedad de alergia...) se insertan justo detrás de su pregunta madre cuando la
// respuesta cumple el `test`, así que la lista crece y encoge con las respuestas.

export type FlatNode = {
  q: Question;
  key: string;
  /** Índice de su pantalla en `SCREENS`. */
  si: number;
  isFollowUp: boolean;
  lastOfScreen: boolean;
};

export const buildFlat = (answers: Record<string, string>): FlatNode[] => {
  const out: FlatNode[] = [];

  const pushChain = (q: Question, key: string, si: number, isFollowUp: boolean) => {
    out.push({ q, key, si, isFollowUp, lastOfScreen: false });
    const ans = answers[key];
    if (q.followUp && ans !== undefined && ans.trim() !== "" && q.followUp.test(ans)) {
      pushChain(q.followUp.question, `${key}>fu`, si, true);
    }
  };

  SCREENS.forEach((screen, si) => {
    screen.questions.forEach((baseQ, qi) => {
      pushChain(baseQ, `${si}-${qi}`, si, false);
    });
  });

  out.forEach((node, i) => {
    const next = out[i + 1];
    node.lastOfScreen = !next || next.si !== node.si;
  });
  return out;
};
