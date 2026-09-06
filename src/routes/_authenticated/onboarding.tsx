import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Pencil,
  Save,
  Send,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DictateButton } from "@/components/dictate-button";
import { RegionStep } from "@/components/region-step";
import { ageFromDOB } from "@/lib/age";
import { addMessage, fetchProfile, monthISO, saveProfile, todayISO } from "@/lib/daily";
import { parseOnboarding } from "@/lib/onboarding.functions";
import { generateMonthlyPlan, welcomeBriefing } from "@/lib/plan.functions";
import { resolveDeviceTimeZone } from "@/lib/zoned-date";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

type Question = {
  q: string;
  hint?: string;
  chips?: string[];
  /** Los chips son de selección única salvo que se marque explícitamente lo contrario:
   * casi todas estas preguntas mapean a un único valor (nivel de actividad, tono...),
   * así que combinar varias opciones a la vez no tendría sentido. */
  multi?: boolean;
  optional?: boolean;
  /** Sustituye el textarea por un selector de fecha nativo (usado en la fecha de nacimiento). */
  dateInput?: boolean;
  validate?: (text: string) => string | null;
  /** Pregunta que se inserta justo después de esta si `test` devuelve true sobre la
   * respuesta dada — no consume un "step" del flujo fijo (ver PARTNER_APP_Q, el
   * primer caso de este patrón). */
  followUp?: { test: (answerText: string) => boolean; question: Question };
};
type Screen = { title: string; subtitle: string; questions: Question[] };

/** Detecta una respuesta con contenido real frente a un "no"/"ninguna"/"nada"
 * (se usa para follow-ups condicionales: alergias -> gravedad). */
const mentionsSomething = (t: string) => !/^\s*(ning[uú]n[ao]?s?|no|nada)\b/i.test(t.trim());

const num = (t: string) => t.replace(",", ".");

type Biometrics = { age: number | null; weight: number | null; height: number | null };

/** Lee edad, peso y altura de una frase libre, con o sin unidades. */
const parseBiometrics = (raw: string): Biometrics => {
  const t = num(raw).toLowerCase();
  let age: number | null = null;
  let weight: number | null = null;
  let height: number | null = null;

  const unit = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };

  age = unit(/(\d{1,3})\s*(?:años|anos|año|a\b)/);
  weight = unit(/(\d{2,3}(?:\.\d+)?)\s*(?:kg|kilos?|kilogramos?)/);
  height = unit(/(\d{2,3}(?:\.\d+)?)\s*(?:cm|cent[ií]metros?|centimetros?)/);
  const meters = unit(/([12](?:\.\d{1,2}))\s*(?:m|metros?)\b/);
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

const validateBiometrics = (raw: string) => {
  const { weight, height } = parseBiometrics(raw);
  if (!weight && !height)
    return "Para calcular bien tu progreso necesito tu peso y tu altura. ¿Me los dices así? Ej.: hombre, 78 kg, 172 cm";
  if (!weight)
    return "Me falta tu peso actual en kg (ej.: 78 kg). Es la base del progreso, sin juicios.";
  if (!height) return "Me falta tu altura en cm (ej.: 172 cm) para ajustar las cantidades.";
  return null;
};

const validateTimes = (raw: string) => {
  const hours = num(raw).match(/\b([01]?\d|2[0-3])(?:[:.]\d{2})?\s*(h|am|pm)?\b/gi) ?? [];
  if (hours.length < 2)
    return "Dime las dos horas para poder avisarte a tiempo. Ej.: a las 8:00 y a las 22:00";
  return null;
};

const validateMeals = (raw: string) => {
  const n = Number((num(raw).match(/\d+(?:\.\d+)?/) ?? [])[0]);
  if (!n || n < 1 || n > 8) return "Dime un número de comidas al día entre 1 y 8 (ej.: 3).";
  return null;
};

const validateDOB = (raw: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Elige tu fecha de nacimiento con el calendario.";
  const age = ageFromDOB(raw);
  if (age === null || age < 12 || age > 110) return "Revisa la fecha, esa edad no parece real.";
  return null;
};

const formatDatePretty = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const parseDatePretty = (pretty: string): string | null => {
  const m = pretty.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
};

const DOB_MAX = new Date().toISOString().slice(0, 10);
const DOB_MIN = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 110);
  return d.toISOString().slice(0, 10);
})();

// --- Preguntas "hoja" (sin follow-up propio) usadas como follow-up de otras o
// insertadas directamente en SCREENS. Van primero porque BIO_Q, LIVES_WITH_Q y la
// pregunta de objetivo las referencian en su propio `followUp`. Ver "Radiografía
// del onboarding" para el porqué de cada una.

const ALLERGY_SEVERITY_Q: Question = {
  q: "De esas alergias o intolerancias, ¿alguna es grave (tipo anafilaxia) o son más llevaderas?",
  hint: "Ej.: el marisco es grave, la lactosa la llevo bien",
  optional: true,
};

const MENSTRUAL_CYCLE_Q: Question = {
  q: "¿Notas que tu ciclo menstrual te afecta al apetito, la energía o los antojos?",
  hint: "Ej.: los días antes de la regla me apetece picar más (o 'no lo noto' / 'prefiero no decirlo')",
  optional: true,
};

const PREGNANCY_Q: Question = {
  q: "¿Estás embarazada o en periodo de lactancia ahora mismo?",
  hint: "Cambia lo que es seguro recomendarte",
  chips: ["Sí, embarazada", "Sí, en lactancia", "No", "Prefiero no decirlo"],
  // Si no está embarazada ni en lactancia, encadenamos la pregunta del ciclo;
  // si lo está, no tiene sentido preguntarla ahora.
  followUp: { test: (t) => !/embarazad|lactancia/i.test(t), question: MENSTRUAL_CYCLE_Q },
};

const ED_HISTORY_Q: Question = {
  q: "Antes de seguir: ¿tienes ahora, o has tenido antes, una relación muy difícil con la comida — atracones, restricción muy estricta, purgas? Te lo pregunto para acompañarte mejor, nunca para juzgarte.",
  hint: "Sin filtros, aquí no se juzga nada",
  chips: ["Sí, ahora", "Sí, en el pasado", "No", "Prefiero no decirlo"],
};

const ALCOHOL_Q: Question = {
  q: "¿Sueles tomar alcohol?",
  chips: ["Nunca", "De vez en cuando", "Con bastante frecuencia"],
};

const DISLIKED_FOODS_Q: Question = {
  q: "¿Hay ingredientes que no quieres ver en tus platos?",
  hint: "Ej.: cilantro, hígado, pescado azul (si no hay ninguno, dime 'ninguno')",
};

const CUISINE_Q: Question = {
  q: "¿Qué tipo de comida te gusta más?",
  chips: [
    "Mediterránea",
    "Casera de siempre",
    "Asiática",
    "Mexicana",
    "Italiana",
    "Un poco de todo",
  ],
  multi: true,
};

const MEALS_TO_PLAN_Q: Question = {
  q: "¿Qué comidas quieres que te planifique y te incluya en la compra?",
  chips: ["Desayuno", "Comida", "Cena", "Snacks"],
  multi: true,
};

const KITCHEN_EQUIPMENT_Q: Question = {
  q: "¿Con qué cuentas en la cocina?",
  chips: ["Horno", "Air fryer", "Olla lenta", "Robot de cocina", "Solo fuego", "Microondas"],
  multi: true,
};

const COOKING_SKILL_Q: Question = {
  q: "¿Cómo te llevas con la cocina?",
  chips: ["Me apaño con lo básico", "Cocino bien", "Se me da genial"],
};

const TRAINING_EXPERIENCE_Q: Question = {
  q: "Como tu objetivo es ganar músculo: ¿cuánta experiencia tienes entrenando fuerza?",
  chips: ["Ninguna", "Menos de 1 año", "1-3 años", "Más de 3 años"],
};

const SMOKING_Q: Question = {
  q: "¿Fumas?",
  chips: ["No", "Ocasionalmente", "Sí"],
};

const WEIGH_IN_CADENCE_Q: Question = {
  q: "¿Cada cuánto quieres registrar tu peso?",
  chips: ["Cada semana", "Cada dos semanas", "Te aviso yo cuando quiera"],
};

/**
 * Solo se pregunta si la respuesta a LIVES_WITH_Q menciona a la pareja: así sabemos
 * si el presupuesto que se pida más adelante (BUDGET_Q) debe ser el de una persona
 * o, si la pareja no va a usar la app para sincronizar, el total de la casa.
 */
const PARTNER_APP_Q: Question = {
  q: "¿Tu pareja también va a usar Peppers? Si la instala, podéis uniros en Tu hogar y compartir comidas y compra.",
  hint: "Así sé si el presupuesto que me des luego es solo tuyo o el de los dos",
  chips: ["Sí, también la usará", "No, de momento no"],
};

/** Pedimos la fecha exacta (no la edad suelta) para poder recalcularla sola con el
 * tiempo y adaptar el menú según la persona va cumpliendo años, en vez de quedarnos
 * con una edad fija del día del onboarding. */
const BIRTHDATE_Q: Question = {
  q: "¿Cuál es tu fecha de nacimiento? Así ajusto tu edad sola con el tiempo y adapto el menú según vas cumpliendo años.",
  hint: "Elige el día con el calendario",
  dateInput: true,
  validate: validateDOB,
};

const BIO_Q: Question = {
  q: "Encantado. Cuéntame tu sexo biológico, peso actual y altura.",
  hint: "Ej.: hombre, 78 kg, 172 cm",
  validate: validateBiometrics,
  // Solo relevante para quien se identifica como mujer — mismo patrón de follow-up
  // condicional que PARTNER_APP_Q más abajo, aplicado aquí por primera vez.
  followUp: { test: (t) => /\bmujer\b/i.test(t), question: PREGNANCY_Q },
};

const LIVES_WITH_Q: Question = {
  q: "¿Con quién vives? Dime si compartes las comidas con alguien y cuáles (por ejemplo, cenáis siempre juntos).",
  hint: "Ej.: vivo con mi pareja, cenamos juntos todos los días",
  followUp: { test: (t) => /\bpareja\b/i.test(t), question: PARTNER_APP_Q },
};

const BUDGET_Q: Question = {
  q: "¿Cuánto tiempo tienes para cocinar al día y cuánto te quieres gastar en comida al mes?",
  hint: "Ej.: 20 min al día y unos 250 € al mes",
};

const SCREENS: Screen[] = [
  {
    title: "Sobre ti",
    subtitle: "Datos biométricos y de salud",
    questions: [
      {
        q: "Hola, soy Peppers, tu asistente de alimentación con IA. Te acompañaré cada día con ideas flexibles, nunca con dietas rígidas ni prisas. Para empezar, ¿cómo te llamo?",
        hint: "Tu nombre",
      },
      BIRTHDATE_Q,
      BIO_Q,
      {
        q: "¿Tienes alguna condición médica o estás bajo supervisión médica que deba tener en cuenta?",
        hint: "Opcional: si no hay nada, pulsa Saltar",
        optional: true,
      },
      {
        q: "¿Tomas algún medicamento que afecte al apetito, metabolismo o energía? Aprovecho también para preguntarte por suplementos: proteína, creatina, vitaminas...",
        hint: "Opcional",
        optional: true,
      },
      SMOKING_Q,
      {
        q: "¿Tienes alergias o intolerancias alimentarias?",
        hint: "Si no hay ninguna, dime 'ninguna'",
        followUp: { test: mentionsSomething, question: ALLERGY_SEVERITY_Q },
      },
    ],
  },
  {
    title: "Tu día a día",
    subtitle: "Estilo de vida y actividad",
    questions: [
      {
        q: "¿Cómo describirías tu nivel de actividad física habitual?",
        chips: ["Sedentario", "Activo ligero", "Activo", "Muy activo"],
      },
      {
        q: "¿Haces ejercicio de forma regular? ¿Qué tipo y con qué frecuencia?",
        hint: "Ej.: gimnasio 2 días y padel los domingos",
      },
      {
        q: "¿Cómo es tu horario laboral o diario? Turnos fijos, viajes, oficina...",
        hint: "Ej.: oficina de 9 a 18, viajo una semana al mes",
      },
      {
        q: "¿A qué hora sueles despertarte y acostarte?",
        hint: "Ej.: me levanto a las 7:00 y me acuesto a las 23:30",
      },
      {
        q: "¿Cuántas comidas sueles hacer al día actualmente?",
        chips: ["2", "3", "4", "5"],
        validate: validateMeals,
      },
      MEALS_TO_PLAN_Q,
    ],
  },
  {
    title: "Cómo comes hoy",
    subtitle: "Alimentación actual",
    questions: [
      {
        q: "¿Cocinas tú habitualmente o comes fuera y pides con frecuencia? Concreta qué días y comidas.",
        hint: "Ej.: cocino de lunes a viernes por la noche, como fuera al mediodía",
      },
      KITCHEN_EQUIPMENT_Q,
      COOKING_SKILL_Q,
      {
        q: "¿Sigues algún patrón alimentario?",
        chips: [
          "Omnívoro",
          "Flexitariano / poca carne roja",
          "Vegetariano",
          "Vegano",
          "Pescetariano",
          "Sin gluten",
        ],
        multi: true,
      },
      {
        q: "¿Hay algún alimento que no estés dispuesto a eliminar bajo ningún concepto?",
        hint: "Ej.: mi café con leche de la mañana y el chocolate del finde",
      },
      DISLIKED_FOODS_Q,
      CUISINE_Q,
      ALCOHOL_Q,
      {
        q: "¿Cómo describirías tu relación con la comida hoy en día?",
        hint: "Sin filtros, aquí no se juzga nada",
        chips: ["Tranquila", "Ansiosa", "Sin tiempo para pensarlo"],
      },
      ED_HISTORY_Q,
    ],
  },
  {
    title: "Tu casa",
    subtitle: "Entorno familiar",
    questions: [
      LIVES_WITH_Q,
      {
        q: "¿Hay niños en casa? Cuéntame su edad, alergias o intolerancias y cómo comen.",
        hint: "Opcional: si no hay peques, pulsa Saltar",
        optional: true,
      },
      {
        q: "¿Alguien más en casa tiene alergias, intolerancias o algo que no come?",
        hint: "Opcional",
        optional: true,
      },
      {
        q: "¿Para cuántas raciones cocinas normalmente cada comida?",
        hint: "Ej.: 2 entre semana, 4 el sábado — puede variar",
      },
    ],
  },
  {
    title: "Hacia dónde vamos",
    subtitle: "Objetivos",
    questions: [
      {
        q: "¿Cuál es tu objetivo principal?",
        chips: [
          "Perder peso",
          "Ganar masa muscular",
          "Mantener",
          "Mejorar hábitos",
          "Más energía y sueño",
        ],
        followUp: { test: (t) => /ganar masa muscular/i.test(t), question: TRAINING_EXPERIENCE_Q },
      },
      {
        q: "Si tu objetivo es de peso, ¿cuánto y en qué plazo te gustaría lograrlo? Sin presión, solo para orientarnos.",
        hint: "Ej.: 5 kg antes de junio (o 'no aplica')",
      },
      {
        q: "¿Tienes algún objetivo a corto plazo para las próximas 2-4 semanas?",
        hint: "Ej.: dejar de picar entre horas, beber más agua",
      },
      {
        q: "¿Qué es lo que más te ha costado mantener en intentos anteriores? Y de paso: ¿has probado antes a contar calorías o macros, o con otras dietas? ¿Te ayudó o te obsesionó?",
        hint: "Saberlo me ayuda a no repetir lo que no te funciona",
      },
      WEIGH_IN_CADENCE_Q,
      BUDGET_Q,
    ],
  },
  {
    title: "Cómo te acompaño",
    subtitle: "Preferencias de acompañamiento",
    questions: [
      {
        q: "¿Prefieres que sea más motivador y relajado o más exigente y directo?",
        chips: ["Relajado", "Neutro", "Exigente"],
      },
      {
        q: "¿Quieres también sugerencias de comportamiento (salir a caminar 15 min) o prefieres que me centre solo en la comida?",
        chips: ["Comida y hábitos", "Solo comida"],
      },
      {
        q: "Última: ¿a qué hora te gustaría recibir el resumen matutino y el repaso nocturno?",
        hint: "Ej.: a las 8:00 y a las 22:00",
        validate: validateTimes,
      },
    ],
  },
];

type Draft = Awaited<ReturnType<typeof parseOnboarding>>;
type GapKey = "current_weight_kg" | "height_cm" | "morning_time" | "evening_time";

const GAP_LABEL: Record<GapKey, { label: string; help: string; type: "number" | "time" }> = {
  current_weight_kg: {
    label: "Peso actual (kg)",
    help: "Sin él no puedo calcular tu progreso.",
    type: "number",
  },
  height_cm: {
    label: "Altura (cm)",
    help: "Me ayuda a ajustar cantidades y consejos.",
    type: "number",
  },
  morning_time: {
    label: "Resumen de la mañana",
    help: "Cuándo te doy la guía del día.",
    type: "time",
  },
  evening_time: {
    label: "Repaso de la noche",
    help: "Cuándo hacemos el cierre del día.",
    type: "time",
  },
};

const KEY_FIELDS: GapKey[] = ["current_weight_kg", "height_cm", "morning_time", "evening_time"];

// --- Modelo plano y navegable -------------------------------------------------
// El rediseño (proyecto de Claude Design "Onboarding Peppers", artboard 1b) pasa
// de un chat de una sola dirección a un recorrido navegable: se puede saltar a
// cualquier pregunta, corregir cualquier respuesta y aparcar preguntas. Para eso
// aplanamos SCREENS a una lista de nodos con clave estable. Los follow-ups
// condicionales (embarazo, pareja, gravedad de alergia...) se insertan justo
// detrás de su pregunta madre cuando la respuesta cumple el `test`, así que la
// lista crece y encoge con las respuestas — de ahí que se recalcule con useMemo.

type FlatNode = {
  q: Question;
  key: string;
  si: number;
  screenTitle: string;
  screenSub: string;
  isFollowUp: boolean;
  lastOfScreen: boolean;
};

const buildFlat = (answers: Record<string, string>): FlatNode[] => {
  const out: FlatNode[] = [];

  const pushChain = (q: Question, key: string, si: number, screen: Screen, isFollowUp: boolean) => {
    out.push({
      q,
      key,
      si,
      screenTitle: screen.title,
      screenSub: screen.subtitle,
      isFollowUp,
      lastOfScreen: false,
    });
    const ans = answers[key];
    if (q.followUp && ans !== undefined && ans.trim() !== "" && q.followUp.test(ans)) {
      pushChain(q.followUp.question, `${key}>fu`, si, screen, true);
    }
  };

  SCREENS.forEach((screen, si) => {
    screen.questions.forEach((baseQ, qi) => pushChain(baseQ, `${si}-${qi}`, si, screen, false));
  });

  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i].lastOfScreen = !next || next.si !== out[i].si;
  }
  return out;
};

const DRAFT_STORAGE_KEY = "peppers-onboarding-progress-v1";

type View = "chat" | "index" | "resumen" | "saved";

function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const parse = useServerFn(parseOnboarding);
  const makePlan = useServerFn(generateMonthlyPlan);
  const brief = useServerFn(welcomeBriefing);

  // País e idioma van antes del chat guionizado: mientras `profile.country` no
  // esté fijado, se muestra el RegionStep en lugar del onboarding conversacional.
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const [regionDone, setRegionDone] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(false);

  // Respuestas y saltos por clave de nodo (no por índice): la lista plana cambia
  // de longitud con los follow-ups, así que navegamos por clave estable.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const [curKey, setCurKey] = useState("0-0");
  const [view, setView] = useState<View>("chat");
  const [stageEnd, setStageEnd] = useState(false);

  const [value, setValue] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  // Se activa al confirmar el resumen: mientras esté en true (y aún no haya
  // terminado), sustituimos toda la pantalla por la animación de "generando tu
  // plan" en vez del formulario de chat deshabilitado.
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const [welcomeText, setWelcomeText] = useState<string | null>(null);

  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  const [gapMissing, setGapMissing] = useState<GapKey[]>([]);
  const [reviewDraft, setReviewDraft] = useState<Draft | null>(null);
  // Fecha de nacimiento en ISO (YYYY-MM-DD), capturada directamente del selector
  // de fecha: no dependemos de que la IA la extraiga bien del texto.
  const [dob, setDob] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const hydrated = useRef(false);

  const flat = useMemo(() => buildFlat(answers), [answers]);
  const curIndex = flat.findIndex((n) => n.key === curKey);
  const cur = curIndex >= 0 ? flat[curIndex] : flat[0];

  // Si un follow-up que era la pregunta actual desaparece (porque se corrigió la
  // respuesta madre), reencauzamos a un nodo que sí exista.
  useEffect(() => {
    if (curIndex < 0 && flat.length) setCurKey(flat[Math.min(flat.length - 1, 0)].key);
  }, [curIndex, flat]);

  // Hidratación del progreso guardado ("Guardar y salir"): se lee una vez al
  // montar. Si el perfil ya está completo no restauramos nada.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        answers?: Record<string, string>;
        skipped?: Record<string, true>;
        curKey?: string;
        dob?: string | null;
        introDismissed?: boolean;
      };
      if (saved.answers) setAnswers(saved.answers);
      if (saved.skipped) setSkipped(saved.skipped);
      if (saved.curKey) setCurKey(saved.curKey);
      if (saved.dob) setDob(saved.dob);
      if (saved.introDismissed) setIntroDismissed(true);
    } catch {
      /* progreso corrupto: se ignora y se empieza de cero */
    }
  }, []);

  // Persistencia del progreso: cualquier cambio en respuestas/saltos/posición se
  // guarda en local. Se borra al completar el onboarding con éxito.
  useEffect(() => {
    if (!hydrated.current || done) return;
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ answers, skipped, curKey, dob, introDismissed }),
      );
    } catch {
      /* almacenamiento lleno o bloqueado: no es crítico */
    }
  }, [answers, skipped, curKey, dob, introDismissed, done]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    if (view === "chat" && !saving && !stageEnd && !done) inputRef.current?.focus();
  }, [flat, curKey, view, saving, stageEnd, done]);

  // Si la pareja no va a usar la app, no hay quien más registre su parte del
  // gasto: pedimos el presupuesto total de la casa en vez del personal.
  const partnerNode = flat.find((n) => n.q === PARTNER_APP_Q);
  const partnerAnswer = partnerNode ? answers[partnerNode.key] : undefined;
  const partnerHasApp =
    partnerAnswer == null
      ? null
      : /^\s*s[ií]\b/i.test(partnerAnswer)
        ? true
        : /^\s*no\b/i.test(partnerAnswer)
          ? false
          : null;

  const displayQ = (node: FlatNode): Question => {
    if (node.q === BUDGET_Q && partnerHasApp === false) {
      return {
        ...node.q,
        q: "¿Cuánto tiempo tienes para cocinar al día y cuál es el presupuesto mensual TOTAL de la casa (contando a tu pareja) en comida?",
        hint: "Como tu pareja no va a usar la app, planificamos la compra para los dos. Ej.: 20 min al día y unos 400 € al mes en total",
      };
    }
    return node.q;
  };

  const answeredNodes = flat.filter((n) => answers[n.key] !== undefined);
  const answeredCount = answeredNodes.length;
  const total = flat.length;
  const remaining = total - answeredCount;
  const allAnswered = flat.every((n) => answers[n.key] !== undefined || n.q.optional === true);
  const requiredPending = flat.filter((n) => answers[n.key] === undefined && n.q.optional !== true);

  const chipsForAnswer = (node: FlatNode, text: string) =>
    new Set((node.q.chips ?? []).filter((c) => text.split(", ").includes(c)));

  // El textarea guarda el texto tal cual; el `<input type="date">` necesita ISO,
  // pero la respuesta almacenada está en dd/mm/aaaa (más legible en el chat).
  const inputValueFor = (node: FlatNode | undefined, existing: string) => {
    if (!node?.q.dateInput) return existing;
    if (/^\d{4}-\d{2}-\d{2}$/.test(existing)) return existing;
    return parseDatePretty(existing) ?? "";
  };

  const goTo = (key: string) => {
    const node = flat.find((n) => n.key === key);
    const existing = answers[key] ?? "";
    setCurKey(key);
    setView("chat");
    setStageEnd(false);
    setError(null);
    setValue(inputValueFor(node, existing));
    setSelectedChips(node ? chipsForAnswer(node, existing) : new Set());
  };

  const advanceFrom = (key: string, nextAnswers: Record<string, string>) => {
    const nextFlat = buildFlat(nextAnswers);
    const idx = nextFlat.findIndex((n) => n.key === key);
    const node = nextFlat[idx];
    setError(null);
    if (!node || node.lastOfScreen) {
      setValue("");
      setSelectedChips(new Set());
      setStageEnd(true);
      return;
    }
    // Prefijamos la respuesta que ya tuviera la siguiente pregunta (al corregir
    // una del medio se puede aterrizar en una ya contestada) — como el prototipo.
    const next = nextFlat[idx + 1];
    const existing = nextAnswers[next.key] ?? "";
    setCurKey(next.key);
    setValue(inputValueFor(next, existing));
    setSelectedChips(chipsForAnswer(next, existing));
  };

  const commit = (raw: string) => {
    const text = raw.trim();
    if (!text || saving) return;

    const q = displayQ(cur);
    const problem = q.validate?.(text);
    if (problem) {
      setError(problem);
      return;
    }
    if (cur.q.dateInput) setDob(text);

    const stored = cur.q.dateInput ? formatDatePretty(text) : text;
    const nextAnswers = { ...answers, [cur.key]: stored };
    setAnswers(nextAnswers);
    setSkipped((s) => {
      const n = { ...s };
      delete n[cur.key];
      return n;
    });
    advanceFrom(cur.key, nextAnswers);
  };

  const skipCurrent = () => {
    if (saving) return;
    const nextAnswers = { ...answers };
    delete nextAnswers[cur.key];
    setAnswers(nextAnswers);
    setSkipped((s) => ({ ...s, [cur.key]: true }));
    advanceFrom(cur.key, nextAnswers);
  };

  const toggleChip = (c: string) => {
    if (!cur?.q.multi) {
      setSelectedChips(new Set([c]));
      setValue(c);
      inputRef.current?.focus();
      return;
    }
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      const ordered = cur.q.chips?.filter((chip) => next.has(chip)) ?? [];
      setValue(ordered.join(", "));
      return next;
    });
    inputRef.current?.focus();
  };

  const back = () => {
    if (stageEnd) {
      setStageEnd(false);
      setValue(inputValueFor(cur, answers[cur.key] ?? ""));
      setSelectedChips(chipsForAnswer(cur, answers[cur.key] ?? ""));
      return;
    }
    if (curIndex > 0) goTo(flat[curIndex - 1].key);
  };

  const isLastStage = cur.si === SCREENS.length - 1;

  // Cerrar un overlay vuelve al chat; si la pregunta actual es la última de una
  // etapa ya respondida, mostramos su tarjeta de fin de etapa en lugar de dejar
  // un textarea sin salida visible.
  const closeToChat = () => {
    setView("chat");
    if (cur.lastOfScreen && answers[cur.key] !== undefined) setStageEnd(true);
  };

  const advanceStage = () => {
    if (isLastStage) {
      void openResumen();
      return;
    }
    const first = flat.find((n) => n.si === cur.si + 1);
    if (first) goTo(first.key);
  };

  const transcriptFromAnswers = (map: Record<string, string>) =>
    buildFlat(map)
      .map((n) => {
        if (map[n.key] !== undefined) return `Coach: ${displayQ(n).q}\nPersona: ${map[n.key]}`;
        if (n.q.optional) return `Coach: ${displayQ(n).q}\nPersona: Nada que destacar`;
        return null;
      })
      .filter(Boolean)
      .join("\n");

  const openResumen = async () => {
    setView("resumen");
    if (!allAnswered) return;
    setSaving(true);
    try {
      const map = { ...answers };
      const parsed = (await parse({ data: { transcript: transcriptFromAnswers(map) } })) as Draft;
      const bioNode = flat.find((n) => n.q === BIO_Q);
      const bio = parseBiometrics(bioNode ? (map[bioNode.key] ?? "") : "");
      const draft: Draft = {
        ...parsed,
        date_of_birth: dob ?? parsed.date_of_birth,
        age: dob ? ageFromDOB(dob) : (parsed.age ?? bio.age),
        current_weight_kg: parsed.current_weight_kg ?? bio.weight,
        height_cm: parsed.height_cm ?? bio.height,
      };
      const missing = KEY_FIELDS.filter((k) => !draft[k as keyof Draft]);
      setReviewDraft(draft);
      setGapMissing(missing);
      setGapValues({
        current_weight_kg: draft.current_weight_kg ? String(draft.current_weight_kg) : "",
        height_cm: draft.height_cm ? String(draft.height_cm) : "",
        morning_time: draft.morning_time ?? "",
        evening_time: draft.evening_time ?? "",
      });
      setError(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No hemos podido preparar la revisión");
    }
    setSaving(false);
  };

  const saveAll = async (draft: Draft, extra: Partial<Draft>) => {
    setSaving(true);
    const d = { ...draft, ...extra };
    try {
      const existing = await fetchProfile();
      await saveProfile({
        app_started_on: existing?.app_started_on ?? todayISO(),
        timezone: resolveDeviceTimeZone(),
        display_name: d.display_name,
        age: d.age,
        date_of_birth: d.date_of_birth,
        sex: d.sex,
        height_cm: d.height_cm,
        current_weight_kg: d.current_weight_kg,
        start_weight_kg: d.current_weight_kg,
        medical_conditions: d.medical_conditions,
        medications: d.medications,
        activity_level: d.activity_level ?? "activo ligero",
        exercise: d.exercise,
        work_schedule: d.work_schedule,
        wake_time: d.wake_time,
        sleep_time: d.sleep_time,
        meals_per_day: d.meals_per_day,
        diet_pattern: d.diet_pattern,
        non_negotiable_foods: d.non_negotiable_foods,
        food_relationship: d.food_relationship,
        goal_type: d.goal_type ?? "mantener",
        goal_amount: d.goal_amount,
        goal_target_date: d.goal_target_date,
        short_term_goal: d.short_term_goal,
        past_struggles: d.past_struggles,
        restrictions: d.restrictions,
        meal_schedule: d.meal_schedule,
        life_context: d.life_context,
        family_context: d.family_context,
        budget_month_eur: d.budget_month_eur,
        coach_scope: d.coach_scope ?? "comida y hábitos",
        tone: d.tone ?? "relajado",
        morning_time: d.morning_time ?? "08:00",
        evening_time: d.evening_time ?? "22:00",
        pregnancy_status: d.pregnancy_status,
        menstrual_cycle: d.menstrual_cycle,
        ed_history: d.ed_history,
        alcohol: d.alcohol,
        allergy_severity: d.allergy_severity,
        disliked_foods: d.disliked_foods,
        cuisine_preference: d.cuisine_preference,
        portions_per_meal: d.portions_per_meal,
        meals_to_plan: d.meals_to_plan,
        kitchen_equipment: d.kitchen_equipment,
        cooking_skill: d.cooking_skill,
        strength_training_experience: d.strength_training_experience,
        supplements: d.supplements,
        smoking: d.smoking,
        tracking_experience: d.tracking_experience,
        weigh_in_cadence: d.weigh_in_cadence,
        onboarding_completed: true,
      });

      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.refetchQueries({ queryKey: ["profile"] });
      qc.removeQueries({ queryKey: ["today"] });
      qc.removeQueries({ queryKey: ["logs"] });

      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        /* nada que limpiar */
      }

      const month = monthISO();
      try {
        await makePlan({ data: { month, today: todayISO() } });
        const { text } = await brief({ data: { month } });
        if (text) {
          setWelcomeText(text);
          void addMessage("assistant", text);
        }
        setDone(true);
        setSaving(false);
        setFinishing(false);
        return;
      } catch {
        toast.error("He guardado tus datos, el plan del mes lo creamos en la pestaña Plan");
      }
      setSaving(false);
      setFinishing(false);
      navigate({ to: "/hoy", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No hemos podido guardar");
      setSaving(false);
      setFinishing(false);
    }
  };

  const confirmAndSave = async () => {
    const extra: Partial<Draft> = {};
    for (const key of KEY_FIELDS) {
      const rawVal = (gapValues[key] ?? "").trim();
      if (!rawVal) {
        setError(`Necesito ${GAP_LABEL[key].label.toLowerCase()} para poder guardar.`);
        return;
      }
      if (GAP_LABEL[key].type === "number") {
        const n = Number(rawVal.replace(",", "."));
        const ok = key === "current_weight_kg" ? n >= 25 && n <= 350 : n >= 100 && n <= 250;
        if (!ok) {
          setError(
            key === "current_weight_kg"
              ? "El peso debe estar entre 25 y 350 kg."
              : "La altura debe estar entre 100 y 250 cm.",
          );
          return;
        }
        (extra as Record<string, unknown>)[key] = n;
      } else {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawVal)) {
          setError(`${GAP_LABEL[key].label} debe tener formato HH:MM.`);
          return;
        }
        (extra as Record<string, unknown>)[key] = rawVal;
      }
    }
    setError(null);

    // Releemos siempre la transcripción al confirmar: con navegación libre no hay
    // un único "momento final", cualquier respuesta puede haber cambiado.
    setSaving(true);
    let draft = reviewDraft;
    try {
      const map = { ...answers };
      const reparsed = (await parse({ data: { transcript: transcriptFromAnswers(map) } })) as Draft;
      const bioNode = flat.find((n) => n.q === BIO_Q);
      const bio = parseBiometrics(bioNode ? (map[bioNode.key] ?? "") : "");
      draft = {
        ...reparsed,
        date_of_birth: dob ?? reparsed.date_of_birth,
        age: dob ? ageFromDOB(dob) : (reparsed.age ?? bio.age),
        current_weight_kg: reparsed.current_weight_kg ?? bio.weight,
        height_cm: reparsed.height_cm ?? bio.height,
      };
    } catch {
      toast.error("No he podido releer tus cambios, guardo con lo que ya tenía");
    }
    if (!draft) {
      setSaving(false);
      setError("No hemos podido preparar tu perfil. Inténtalo de nuevo.");
      return;
    }
    setView("chat");
    setFinishing(true);
    await saveAll(draft, extra);
  };

  // --- Render --------------------------------------------------------------

  if (profileQ.isLoading) return null;
  if (!regionDone && !profileQ.data?.country) {
    return <RegionStep profile={profileQ.data} onDone={() => setRegionDone(true)} />;
  }

  if (!introDismissed) {
    return (
      <main className="mx-auto flex h-[100dvh] max-w-lg flex-col items-center justify-center px-6">
        <div className="w-full space-y-6 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="font-title text-2xl font-semibold tracking-tight text-foreground">
            Vamos a conocerte
          </h1>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
            Son unas {total} preguntas (~10-15 minutos). Puedes saltar cualquiera, volver atrás y
            corregir lo que quieras — y si lo dejas a medias, retomas justo donde ibas.
          </p>
          <button
            type="button"
            onClick={() => setIntroDismissed(true)}
            className="mx-auto flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Empezar <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    );
  }

  if (finishing && !done) return <PlanGeneratingScreen />;

  if (done) {
    return (
      <main className="mx-auto flex h-[100dvh] max-w-lg flex-col items-center justify-center gap-8 px-8 text-center">
        <span className="relative grid h-24 w-24 place-items-center">
          <span className="animate-coach-pulse absolute h-24 w-24 rounded-full bg-primary/12" />
          <span className="relative grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary">
            <Check className="h-6 w-6" strokeWidth={2.6} />
          </span>
        </span>
        <div className="space-y-2.5">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Tu plan está listo</h1>
          {welcomeText ? (
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              {welcomeText}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/hoy", replace: true })}
          className="w-full max-w-xs rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Empezar mi primer día
        </button>
      </main>
    );
  }

  const stage = SCREENS[cur.si];
  const screenNodes = flat.filter((n) => n.si === cur.si);
  const posInScreen = screenNodes.findIndex((n) => n.key === cur.key);
  const visibleTurns = screenNodes.slice(0, posInScreen + 1);

  const segments = SCREENS.map((_, si) => {
    const nodes = flat.filter((n) => n.si === si);
    const done = nodes.filter((n) => answers[n.key] !== undefined).length;
    const pct = nodes.length ? done / nodes.length : 0;
    return si === cur.si ? Math.max(pct, 0.08) : pct;
  });

  const currentQ = displayQ(cur);

  if (view === "index") {
    return (
      <Shell>
        <OverlayHeader eyebrow="índice" title="Todo el recorrido" onClose={closeToChat} />
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Ve a cualquier etapa cuando quieras. Lo respondido se guarda tal cual.
        </p>
        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
          {SCREENS.map((s, si) => {
            const nodes = flat.filter((n) => n.si === si);
            const doneN = nodes.filter((n) => answers[n.key] !== undefined).length;
            const complete = doneN === nodes.length;
            const isCur = si === cur.si;
            const first = nodes[0];
            return (
              <button
                key={s.title}
                type="button"
                onClick={() => first && goTo(first.key)}
                className="flex w-full items-center gap-3.5 rounded-2xl bg-surface p-4 text-left transition-transform active:scale-[0.99]"
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-num text-xs ${
                    complete
                      ? "bg-success text-success-foreground"
                      : isCur
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {complete ? <Check className="h-4 w-4" strokeWidth={2.6} /> : si + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold tracking-tight">
                    {s.title}
                  </span>
                  <span className="font-num text-[10.5px] text-muted-foreground">
                    {s.subtitle.toLowerCase()} · {doneN}/{nodes.length}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void openResumen()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Ver mi resumen <ArrowRight className="h-4 w-4" />
        </button>
      </Shell>
    );
  }

  if (view === "resumen") {
    const pending = flat.filter((n) => skipped[n.key]);
    const sections = SCREENS.map((s, si) => ({
      title: s.title,
      items: flat.filter((n) => n.si === si && answers[n.key] !== undefined),
    })).filter((s) => s.items.length);
    const emptyResumen = pending.length === 0 && sections.length === 0;
    const canConfirm = allAnswered;

    return (
      <Shell>
        <OverlayHeader
          eyebrow={`resumen · ${answeredCount} de ${total}`}
          title="Repasa tus respuestas"
          onClose={closeToChat}
        />
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Toca cualquier respuesta para corregirla. Sin prisa: cuando esté bien, confirmamos.
        </p>

        <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
          {canConfirm ? (
            <section className="space-y-3 rounded-3xl bg-surface p-4">
              <p className="text-sm font-medium">Datos clave</p>
              {KEY_FIELDS.map((key) => (
                <label key={key} className="block text-xs text-muted-foreground">
                  {GAP_LABEL[key].label}
                  {gapMissing.includes(key) ? (
                    <span className="ml-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                      falta
                    </span>
                  ) : null}
                  <input
                    type={GAP_LABEL[key].type === "time" ? "time" : "text"}
                    inputMode={GAP_LABEL[key].type === "number" ? "decimal" : undefined}
                    value={gapValues[key] ?? ""}
                    onChange={(e) => setGapValues((v) => ({ ...v, [key]: e.target.value }))}
                    className="mt-1 h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                  />
                  <span className="mt-1 block text-[11px]">{GAP_LABEL[key].help}</span>
                </label>
              ))}
            </section>
          ) : null}

          {pending.length ? (
            <section className="space-y-2.5 rounded-3xl bg-primary-soft p-4">
              <p className="text-[13px] font-semibold text-foreground">
                Pendientes · {pending.length}
              </p>
              {pending.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => goTo(n.key)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left"
                >
                  <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {displayQ(n).q}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-primary">Responder</span>
                </button>
              ))}
            </section>
          ) : null}

          {sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <p className="px-1 font-num text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {s.title}
              </p>
              {s.items.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => goTo(n.key)}
                  className="block w-full rounded-3xl bg-surface p-4 text-left"
                >
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {displayQ(n).q}
                  </span>
                  <span className="mt-1.5 flex items-start justify-between gap-3">
                    <span className="text-sm text-foreground">{answers[n.key]}</span>
                    <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </span>
                </button>
              ))}
            </section>
          ))}

          {emptyResumen ? (
            <p className="px-1 py-6 text-[13px] leading-relaxed text-muted-foreground">
              Aún no hay respuestas guardadas. Vuelve al chat y empieza por donde quieras.
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="animate-rise mb-2 flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        ) : null}
        {!canConfirm && requiredPending.length ? (
          <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> Te quedan{" "}
            {requiredPending.length} preguntas por responder antes de guardar.
          </p>
        ) : null}

        <button
          type="button"
          disabled={saving}
          onClick={() => (canConfirm ? void confirmAndSave() : closeToChat())}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {saving
            ? "Guardando..."
            : canConfirm
              ? "Confirmar y guardar mi perfil"
              : "Volver al chat"}
          {saving ? null : canConfirm ? (
            <Check className="h-4 w-4" strokeWidth={2.6} />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
        </button>
      </Shell>
    );
  }

  if (view === "saved") {
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
          <span className="relative grid h-24 w-24 place-items-center">
            <span className="animate-coach-pulse absolute h-24 w-24 rounded-full bg-primary/12" />
            <span className="relative grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary">
              <Check className="h-6 w-6" strokeWidth={2.6} />
            </span>
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Guardado</h1>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Llevas {answeredCount} de {total} respuestas. Cuando vuelvas, retomas justo aquí — nada
            se pierde.
          </p>
          <div className="flex w-full max-w-xs flex-col gap-2.5">
            <button
              type="button"
              onClick={closeToChat}
              className="rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              Seguir ahora
            </button>
            <button
              type="button"
              onClick={() => void openResumen()}
              className="rounded-full bg-surface py-4 text-sm font-semibold text-muted-foreground transition-transform active:scale-[0.98]"
            >
              Ver lo que llevo
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // view === "chat"
  return (
    <Shell>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={back}
          aria-label="Atrás"
          disabled={curIndex <= 0 && !stageEnd}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-transform active:scale-95 disabled:opacity-40"
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          onClick={() => setView("index")}
          className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-surface px-4 text-left transition-transform active:scale-[0.99]"
        >
          <span className="flex min-w-0 flex-col">
            <span className="font-num text-[9.5px] uppercase tracking-[0.09em] text-muted-foreground">
              etapa {cur.si + 1} de {SCREENS.length}
            </span>
            <span className="truncate text-[13.5px] font-semibold tracking-tight">
              {stage.title}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => setView("saved")}
          aria-label="Guardar y salir"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground transition-transform active:scale-95"
        >
          <Save className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </div>

      <div className="mt-3.5 flex gap-1.5">
        {segments.map((w, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
            aria-hidden
          >
            <span
              className="block h-1.5 rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.round(w * 100)}%` }}
            />
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2.5">
        <p className="font-num text-[11px] text-muted-foreground">
          pregunta {Math.max(1, curIndex + 1)} de {total}
        </p>
        <p className="font-num text-[11px] text-muted-foreground">quedan {remaining}</p>
      </div>

      <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {visibleTurns.map((n) => (
          <div key={n.key} className="space-y-3">
            <div className="animate-rise flex justify-start">
              <p className="max-w-[85%] rounded-3xl bg-surface px-4 py-3 text-sm leading-relaxed text-foreground">
                {displayQ(n).q}
              </p>
            </div>
            {answers[n.key] !== undefined ? (
              <div className="animate-rise flex justify-end">
                <button
                  type="button"
                  onClick={() => goTo(n.key)}
                  className="flex max-w-[85%] items-center gap-2 rounded-3xl bg-primary px-4 py-3 text-left text-sm leading-relaxed text-primary-foreground transition-transform active:scale-[0.98]"
                >
                  <span>{answers[n.key]}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={2.2} />
                </button>
              </div>
            ) : skipped[n.key] ? (
              <div className="animate-rise flex justify-end">
                <button
                  type="button"
                  onClick={() => goTo(n.key)}
                  className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5 text-[13px] font-medium text-muted-foreground transition-transform active:scale-95"
                >
                  <SkipForward className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Saltada — la retomo luego
                </button>
              </div>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error ? (
        <div className="animate-rise mb-2 flex items-start gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{error}</span>
        </div>
      ) : null}

      {stageEnd ? (
        <div className="animate-rise space-y-3.5 rounded-3xl bg-surface p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Etapa completa:{" "}
            <span className="font-medium text-foreground">{stage.subtitle.toLowerCase()}</span>.{" "}
            {isLastStage
              ? "Es la última: ya podemos repasarlo todo."
              : `Seguimos con ${SCREENS[cur.si + 1].subtitle.toLowerCase()}.`}
          </p>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={back}
              className="flex items-center justify-center gap-1.5 rounded-full bg-secondary px-4 py-3 text-[13.5px] font-semibold text-muted-foreground transition-transform active:scale-95"
            >
              <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
              Repasar
            </button>
            <button
              type="button"
              onClick={advanceStage}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              {isLastStage ? "Ver mi resumen" : "Continuar"}
              <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit(value);
          }}
          className="space-y-2.5"
        >
          {currentQ.chips?.length ? (
            <div className="flex flex-wrap gap-2">
              {currentQ.chips.map((c) => {
                const active = selectedChips.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleChip(c)}
                    aria-pressed={active}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-transform active:scale-95 ${
                      active
                        ? "bg-foreground font-semibold text-background"
                        : "bg-surface text-foreground"
                    }`}
                  >
                    {active ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : null}
                    {c}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="rounded-3xl bg-surface p-2">
            {currentQ.dateInput ? (
              <input
                type="date"
                autoFocus
                disabled={saving}
                value={value}
                min={DOB_MIN}
                max={DOB_MAX}
                onChange={(e) => setValue(e.target.value)}
                className="w-full bg-transparent px-2 py-2.5 text-sm outline-none"
              />
            ) : (
              <textarea
                ref={inputRef}
                rows={2}
                disabled={saving}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commit(value);
                  }
                }}
                placeholder={
                  saving ? "Preparando tu plan..." : (currentQ.hint ?? "Escribe aquí...")
                }
                className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
              />
            )}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                {currentQ.dateInput ? null : (
                  <DictateButton
                    onText={(t) => setValue((v) => (v ? `${v.trim()} ${t}` : t))}
                    label="Dictar"
                  />
                )}
                <button
                  type="button"
                  onClick={skipCurrent}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  <SkipForward className="h-3.5 w-3.5" /> Saltar y volver luego
                </button>
              </div>
              <button
                type="submit"
                disabled={saving || !value.trim()}
                aria-label="Enviar"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex h-[100dvh] max-w-lg flex-col px-5 pb-5 pt-10">{children}</main>
  );
}

function OverlayHeader({
  eyebrow,
  title,
  onClose,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-num text-[9.5px] uppercase tracking-[0.09em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-0.5 font-display text-[22px] font-semibold tracking-tight">{title}</h1>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-transform active:scale-95"
      >
        <X className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}

const GENERATING_MESSAGES = [
  "Leyendo todo lo que me has contado...",
  "Ajustando las cantidades a ti...",
  "Pensando en tus gustos y tu ritmo de vida...",
  "Encajando las comidas en tu semana...",
  "Dando los últimos retoques a tu plan...",
];

/**
 * Pantalla que sustituye al chat mientras se guarda el perfil y se genera el plan
 * mensual (tras confirmar la revisión final). Sin esta pantalla, el usuario solo
 * veía un textarea deshabilitado; aquí le damos algo vivo a lo que mirar mientras
 * espera, con mensajes rotativos para que la espera se note más corta.
 */
function PlanGeneratingScreen() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % GENERATING_MESSAGES.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="mx-auto flex h-[100dvh] max-w-lg flex-col items-center justify-center gap-10 px-8 text-center">
      <div className="relative grid h-40 w-40 place-items-center">
        <span className="animate-coach-pulse absolute h-32 w-32 rounded-full bg-primary/10" />
        <span className="animate-coach-pulse absolute h-24 w-24 rounded-full bg-primary/15 [animation-delay:0.6s]" />
        <span className="animate-breathe relative grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="h-7 w-7" />
        </span>
      </div>

      <div className="space-y-2.5">
        <h1 className="font-title text-xl font-semibold tracking-[-0.02em]">
          Estoy preparando tu plan
        </h1>
        <p key={i} className="animate-rise min-h-[1.25rem] text-sm text-muted-foreground">
          {GENERATING_MESSAGES[i]}
        </p>
      </div>

      <span className="flex items-center gap-1.5" aria-hidden>
        <span className="animate-coach-dot h-2 w-2 rounded-full bg-primary" />
        <span className="animate-coach-dot h-2 w-2 rounded-full bg-primary/70 [animation-delay:0.15s]" />
        <span className="animate-coach-dot h-2 w-2 rounded-full bg-primary/50 [animation-delay:0.3s]" />
      </span>
    </main>
  );
}
