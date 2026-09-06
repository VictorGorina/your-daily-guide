import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DictateButton } from "../../components/dictate-button";
import { RegionStep } from "../../components/region-step";
import { apiPost } from "../../lib/api";
import { ageFromDOB } from "../../lib/age";
import { addMessage, fetchProfile, monthISO, saveProfile, todayISO } from "../../lib/daily";
import type { OnboardingDraft } from "../../lib/onboarding";
import { resolveDeviceTimeZone } from "../../lib/zoned-date";

/**
 * Onboarding conversacional navegable — mismo UI que la web
 * (`src/routes/_authenticated/onboarding.tsx`, artboard 1b del proyecto de Claude
 * Design "Onboarding Peppers"): recorrido en el que se puede saltar a cualquier
 * pregunta, corregir cualquier respuesta tocando su burbuja, aparcar preguntas en
 * "Pendientes", abrir el índice de las 6 etapas y "Guardar y salir" retomando
 * justo donde ibas.
 *
 * La lógica de negocio (parseo por IA de la transcripción, validaciones, huecos
 * peso/altura/horarios, guardado + generación de plan) es idéntica a la web;
 * cambia el transporte de la IA (server functions → `/api/v1/*` vía apiPost), el
 * almacenamiento del progreso (localStorage → AsyncStorage) y la UI (DOM → RN).
 *
 * La fecha de nacimiento se teclea como DD/MM/AAAA (RN no trae `<input
 * type="date">`); la validación y el guardado en ISO son los mismos.
 */

type Question = {
  q: string;
  hint?: string;
  chips?: string[];
  multi?: boolean;
  optional?: boolean;
  /** Pide la respuesta como fecha DD/MM/AAAA en vez de texto libre. */
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Escribe tu fecha de nacimiento como DD/MM/AAAA.";
  const age = ageFromDOB(raw);
  if (age === null || age < 12 || age > 110) return "Revisa la fecha, esa edad no parece real.";
  return null;
};

const formatDatePretty = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const parseDatePretty = (pretty: string): string | null => {
  // Tolera cualquier separador (/, -, ., espacio) y ambos órdenes: DD?MM?AAAA
  // (lo que pide el placeholder) o AAAA?MM?DD (formato ISO). El teclado numérico
  // de iOS y su puntuación "inteligente" pueden convertir el separador, así que
  // no dependemos de que sea exactamente "/".
  const parts = pretty.trim().split(/\D+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  const [y, mo, d] = a.length === 4 ? [a, b, c] : [c, b, a];
  if (y.length !== 4 || mo.length > 2 || d.length > 2) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

// --- Preguntas "hoja" (sin follow-up propio), usadas como follow-up de otras o
// insertadas directamente en SCREENS. Van primero porque BIO_Q, LIVES_WITH_Q y la
// pregunta de objetivo las referencian en su propio `followUp`. Port 1:1 de la web
// — ver "Radiografía del onboarding" para el porqué de cada una.

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

const PARTNER_APP_Q: Question = {
  q: "¿Tu pareja también va a usar Peppers? Si la instala, podéis uniros en Tu hogar y compartir comidas y compra.",
  hint: "Así sé si el presupuesto que me des luego es solo tuyo o el de los dos",
  chips: ["Sí, también la usará", "No, de momento no"],
};

const BIRTHDATE_Q: Question = {
  q: "¿Cuál es tu fecha de nacimiento? Así ajusto tu edad sola con el tiempo y adapto el menú según vas cumpliendo años.",
  hint: "Escríbela como DD/MM/AAAA",
  dateInput: true,
  validate: validateDOB,
};

const BIO_Q: Question = {
  q: "Encantado. Cuéntame tu sexo biológico, peso actual y altura.",
  hint: "Ej.: hombre, 78 kg, 172 cm",
  validate: validateBiometrics,
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

type Draft = OnboardingDraft;
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

const GENERATING_MESSAGES = [
  "Leyendo todo lo que me has contado...",
  "Ajustando las cantidades a ti...",
  "Pensando en tus gustos y tu ritmo de vida...",
  "Encajando las comidas en tu semana...",
  "Dando los últimos retoques a tu plan...",
];

// --- Modelo plano y navegable -------------------------------------------------
// Igual que la web: aplanamos SCREENS a una lista de nodos con clave estable para
// poder saltar a cualquier pregunta. Los follow-ups condicionales (embarazo,
// pareja, gravedad de alergia...) se insertan detrás de su pregunta madre cuando
// la respuesta cumple el `test`, así que la lista crece y encoge con las
// respuestas — se recalcula con useMemo.

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
    out[i]!.lastOfScreen = !next || next.si !== out[i]!.si;
  }
  return out;
};

const DRAFT_STORAGE_KEY = "peppers-onboarding-progress-v1";

type Panel = "chat" | "index" | "resumen" | "saved";

// Colores de icono (RN no entiende currentColor): el tema móvil es monocolor
// naranja, ver tailwind.config.js.
const C = {
  primary: "#ff8a3d",
  onPrimary: "#fbfaf7",
  fg: "#3e3d39",
  muted: "#83796c",
  success: "#4cae64",
  danger: "#e2685f",
};

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();

  const parse = (transcript: string) => apiPost<Draft>("onboarding/parse", { transcript });
  const makePlan = (month: string) => apiPost("plan/generate", { month, today: todayISO() });
  const brief = (month: string) => apiPost<{ text?: string }>("plan/welcome", { month });

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const [regionDone, setRegionDone] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const [curKey, setCurKey] = useState("0-0");
  const [view, setView] = useState<Panel>("chat");
  const [stageEnd, setStageEnd] = useState(false);

  const [value, setValue] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const [welcomeText, setWelcomeText] = useState<string | null>(null);

  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  const [gapMissing, setGapMissing] = useState<GapKey[]>([]);
  const [reviewDraft, setReviewDraft] = useState<Draft | null>(null);
  const [dob, setDob] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const scrollRef = useRef<ScrollView | null>(null);

  const flat = useMemo(() => buildFlat(answers), [answers]);
  const curIndex = flat.findIndex((n) => n.key === curKey);
  const cur = curIndex >= 0 ? flat[curIndex]! : flat[0]!;

  useEffect(() => {
    if (curIndex < 0 && flat.length) setCurKey(flat[0]!.key);
  }, [curIndex, flat]);

  // Hidratación del progreso guardado ("Guardar y salir"): se lee una vez al
  // montar. Bloqueamos el render hasta tenerlo para no parpadear el chat vacío.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(DRAFT_STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
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
      })
      .catch(() => {
        /* progreso corrupto: se empieza de cero */
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Persistencia del progreso: se borra al completar el onboarding con éxito.
  useEffect(() => {
    if (!hydrated || done) return;
    AsyncStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ answers, skipped, curKey, dob, introDismissed }),
    ).catch(() => {
      /* almacenamiento bloqueado: no es crítico */
    });
  }, [answers, skipped, curKey, dob, introDismissed, hydrated, done]);

  // --- Derivados ---------------------------------------------------------------

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

  const answeredCount = flat.filter((n) => answers[n.key] !== undefined).length;
  const total = flat.length;
  const remaining = total - answeredCount;
  const allAnswered = flat.every((n) => answers[n.key] !== undefined || n.q.optional === true);
  const requiredPending = flat.filter((n) => answers[n.key] === undefined && n.q.optional !== true);

  const chipsForAnswer = (node: FlatNode, text: string) =>
    new Set((node.q.chips ?? []).filter((c) => text.split(", ").includes(c)));

  // --- Navegación ------------------------------------------------------------

  const goTo = (key: string) => {
    const node = flat.find((n) => n.key === key);
    const existing = answers[key] ?? "";
    setCurKey(key);
    setView("chat");
    setStageEnd(false);
    setError(null);
    setValue(existing);
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
    const next = nextFlat[idx + 1]!;
    const existing = nextAnswers[next.key] ?? "";
    setCurKey(next.key);
    setValue(existing);
    setSelectedChips(chipsForAnswer(next, existing));
  };

  const commit = (raw: string) => {
    const text = raw.trim();
    if (!text || saving) return;

    const q = displayQ(cur);
    let stored = text;
    if (cur.q.dateInput) {
      const iso = parseDatePretty(text) ?? text;
      const problem = q.validate?.(iso);
      if (problem) {
        setError(problem);
        return;
      }
      setDob(iso);
      stored = formatDatePretty(iso);
    } else {
      const problem = q.validate?.(text);
      if (problem) {
        setError(problem);
        return;
      }
    }

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
  };

  const back = () => {
    if (stageEnd) {
      setStageEnd(false);
      setValue(answers[cur.key] ?? "");
      setSelectedChips(chipsForAnswer(cur, answers[cur.key] ?? ""));
      return;
    }
    if (curIndex > 0) goTo(flat[curIndex - 1]!.key);
  };

  const isLastStage = cur.si === SCREENS.length - 1;

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

  // --- Guardado -------------------------------------------------------------

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
      const parsed = await parse(transcriptFromAnswers(map));
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
      Alert.alert(err instanceof Error ? err.message : "No hemos podido preparar la revisión");
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
      AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});

      const month = monthISO();
      try {
        await makePlan(month);
        const { text } = await brief(month);
        if (text) {
          setWelcomeText(text);
          void addMessage("assistant", text);
        }
        setDone(true);
        setSaving(false);
        setFinishing(false);
        return;
      } catch {
        Alert.alert("He guardado tus datos, el plan del mes lo creamos en la pestaña Plan");
      }
      setSaving(false);
      setFinishing(false);
      router.replace("/hoy");
    } catch (err) {
      Alert.alert(err instanceof Error ? err.message : "No hemos podido guardar");
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

    setSaving(true);
    let draft = reviewDraft;
    try {
      const map = { ...answers };
      const reparsed = await parse(transcriptFromAnswers(map));
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
      Alert.alert("No he podido releer tus cambios, guardo con lo que ya tenía");
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

  if (profileQ.isLoading || !hydrated) return null;
  if (!regionDone && !profileQ.data?.country) {
    return <RegionStep profile={profileQ.data} onDone={() => setRegionDone(true)} />;
  }

  if (!introDismissed) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center px-8">
          <Sparkles size={40} color={C.primary} />
          <Text className="mt-6 text-center font-heading text-2xl text-foreground">
            Vamos a conocerte
          </Text>
          <Text className="mt-4 max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
            Son unas {total} preguntas (~10-15 minutos). Puedes saltar cualquiera, volver atrás y
            corregir lo que quieras — y si lo dejas a medias, retomas justo donde ibas.
          </Text>
          <Pressable
            onPress={() => setIntroDismissed(true)}
            className="mt-8 flex-row items-center gap-2 rounded-full bg-primary px-8 py-3.5 active:opacity-90"
          >
            <Text className="text-sm font-sans-semibold text-primary-foreground">Empezar</Text>
            <ArrowRight size={16} color={C.onPrimary} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (finishing && !done) return <PlanGeneratingScreen />;

  if (done) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center gap-7 px-8">
          <View className="h-24 w-24 items-center justify-center">
            <View className="absolute h-24 w-24 rounded-full bg-primary/10" />
            <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
              <Check size={24} color={C.primary} />
            </View>
          </View>
          <Text className="font-display text-2xl text-foreground">Tu plan está listo</Text>
          {welcomeText ? (
            <Text className="max-w-[320px] text-center text-sm leading-relaxed text-muted-foreground">
              {welcomeText}
            </Text>
          ) : null}
          <Pressable
            onPress={() => router.replace("/hoy")}
            className="w-full max-w-[320px] items-center rounded-full bg-primary py-4 active:opacity-90"
          >
            <Text className="text-sm font-sans-semibold text-primary-foreground">
              Empezar mi primer día
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // --- Overlay: índice ---
  if (view === "index") {
    return (
      <Shell>
        <OverlayHeader eyebrow="índice" title="Todo el recorrido" onClose={closeToChat} />
        <Text className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Ve a cualquier etapa cuando quieras. Lo respondido se guarda tal cual.
        </Text>
        <ScrollView className="mt-4 flex-1" contentContainerClassName="gap-2 pb-2">
          {SCREENS.map((s, si) => {
            const nodes = flat.filter((n) => n.si === si);
            const doneN = nodes.filter((n) => answers[n.key] !== undefined).length;
            const complete = doneN === nodes.length;
            const isCur = si === cur.si;
            const first = nodes[0];
            return (
              <Pressable
                key={s.title}
                onPress={() => first && goTo(first.key)}
                className="flex-row items-center gap-3.5 rounded-2xl bg-surface p-4 active:opacity-90"
              >
                <View
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    complete ? "bg-success" : isCur ? "bg-primary" : "bg-secondary"
                  }`}
                >
                  {complete ? (
                    <Check size={16} color={C.onPrimary} />
                  ) : (
                    <Text
                      className={`font-mono text-xs ${
                        isCur ? "text-primary-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {si + 1}
                    </Text>
                  )}
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[15px] font-sans-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {s.title}
                  </Text>
                  <Text className="font-mono text-[10.5px] text-muted-foreground">
                    {s.subtitle.toLowerCase()} · {doneN}/{nodes.length}
                  </Text>
                </View>
                <ChevronRight size={16} color={C.muted} />
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          onPress={() => void openResumen()}
          className="mt-3 flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">Ver mi resumen</Text>
          <ArrowRight size={16} color={C.onPrimary} />
        </Pressable>
      </Shell>
    );
  }

  // --- Overlay: resumen ---
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
        <Text className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Toca cualquier respuesta para corregirla. Sin prisa: cuando esté bien, confirmamos.
        </Text>

        <ScrollView className="mt-4 flex-1" contentContainerClassName="gap-5 pb-2">
          {canConfirm ? (
            <View className="gap-3 rounded-3xl bg-surface p-4">
              <Text className="text-sm font-sans-medium text-foreground">Datos clave</Text>
              {KEY_FIELDS.map((key) => (
                <View key={key}>
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-xs text-muted-foreground">{GAP_LABEL[key].label}</Text>
                    {gapMissing.includes(key) ? (
                      <View className="rounded-full bg-primary-soft px-2 py-0.5">
                        <Text className="text-[10px] font-sans-medium text-primary">falta</Text>
                      </View>
                    ) : null}
                  </View>
                  <TextInput
                    value={gapValues[key] ?? ""}
                    onChangeText={(t) => setGapValues((v) => ({ ...v, [key]: t }))}
                    keyboardType={GAP_LABEL[key].type === "number" ? "decimal-pad" : "default"}
                    placeholder={GAP_LABEL[key].type === "time" ? "HH:MM" : ""}
                    placeholderTextColor={C.muted}
                    className="mt-1 h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                  />
                  <Text className="mt-1 text-[11px] text-muted-foreground">
                    {GAP_LABEL[key].help}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {pending.length ? (
            <View className="gap-2.5 rounded-3xl bg-primary-soft p-4">
              <Text className="text-[13px] font-sans-semibold text-foreground">
                Pendientes · {pending.length}
              </Text>
              {pending.map((n) => (
                <Pressable
                  key={n.key}
                  onPress={() => goTo(n.key)}
                  className="flex-row items-center gap-3 rounded-2xl bg-surface p-3.5 active:opacity-90"
                >
                  <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
                    {displayQ(n).q}
                  </Text>
                  <Text className="text-xs font-sans-semibold text-primary">Responder</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {sections.map((s) => (
            <View key={s.title} className="gap-2">
              <Text className="px-1 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {s.title}
              </Text>
              {s.items.map((n) => (
                <Pressable
                  key={n.key}
                  onPress={() => goTo(n.key)}
                  className="rounded-3xl bg-surface p-4 active:opacity-90"
                >
                  <Text className="text-xs leading-relaxed text-muted-foreground">
                    {displayQ(n).q}
                  </Text>
                  <View className="mt-1.5 flex-row items-start justify-between gap-3">
                    <Text className="flex-1 text-sm text-foreground">{answers[n.key]}</Text>
                    <Pencil size={14} color={C.muted} />
                  </View>
                </Pressable>
              ))}
            </View>
          ))}

          {emptyResumen ? (
            <Text className="px-1 py-6 text-[13px] leading-relaxed text-muted-foreground">
              Aún no hay respuestas guardadas. Vuelve al chat y empieza por donde quieras.
            </Text>
          ) : null}
        </ScrollView>

        {error ? (
          <View className="mb-2 flex-row items-start gap-1.5">
            <AlertCircle size={14} color={C.danger} />
            <Text className="flex-1 text-xs text-destructive">{error}</Text>
          </View>
        ) : null}
        {!canConfirm && requiredPending.length ? (
          <View className="mb-2 flex-row items-start gap-1.5">
            <Info size={14} color={C.primary} />
            <Text className="flex-1 text-xs text-muted-foreground">
              Te quedan {requiredPending.length} preguntas por responder antes de guardar.
            </Text>
          </View>
        ) : null}

        <Pressable
          disabled={saving}
          onPress={() => (canConfirm ? void confirmAndSave() : closeToChat())}
          className="flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-50"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {saving
              ? "Guardando..."
              : canConfirm
                ? "Confirmar y guardar mi perfil"
                : "Volver al chat"}
          </Text>
          {saving ? null : canConfirm ? (
            <Check size={16} color={C.onPrimary} />
          ) : (
            <ArrowRight size={16} color={C.onPrimary} />
          )}
        </Pressable>
      </Shell>
    );
  }

  // --- Overlay: guardado ---
  if (view === "saved") {
    return (
      <Shell>
        <View className="flex-1 items-center justify-center gap-6">
          <View className="h-24 w-24 items-center justify-center">
            <View className="absolute h-24 w-24 rounded-full bg-primary/10" />
            <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
              <Check size={24} color={C.primary} />
            </View>
          </View>
          <Text className="font-display text-2xl text-foreground">Guardado</Text>
          <Text className="max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
            Llevas {answeredCount} de {total} respuestas. Cuando vuelvas, retomas justo aquí — nada
            se pierde.
          </Text>
          <View className="w-full max-w-[320px] gap-2.5">
            <Pressable
              onPress={closeToChat}
              className="items-center rounded-full bg-primary py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                Seguir ahora
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void openResumen()}
              className="items-center rounded-full bg-surface py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-semibold text-muted-foreground">
                Ver lo que llevo
              </Text>
            </Pressable>
          </View>
        </View>
      </Shell>
    );
  }

  // --- Pantalla: chat ---
  const stage = SCREENS[cur.si]!;
  const screenNodes = flat.filter((n) => n.si === cur.si);
  const posInScreen = screenNodes.findIndex((n) => n.key === cur.key);
  const visibleTurns = screenNodes.slice(0, posInScreen + 1);
  const currentQ = displayQ(cur);

  const segments = SCREENS.map((_, si) => {
    const nodes = flat.filter((n) => n.si === si);
    const done2 = nodes.filter((n) => answers[n.key] !== undefined).length;
    const pct = nodes.length ? done2 / nodes.length : 0;
    return si === cur.si ? Math.max(pct, 0.08) : pct;
  });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 px-5 pt-2">
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={back}
              disabled={curIndex <= 0 && !stageEnd}
              accessibilityLabel="Atrás"
              className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80 disabled:opacity-40"
            >
              <ArrowLeft size={18} color={C.fg} />
            </Pressable>
            <Pressable
              onPress={() => setView("index")}
              className="h-11 flex-1 flex-row items-center justify-between rounded-full bg-surface px-4 active:opacity-90"
            >
              <View className="flex-1">
                <Text className="font-mono text-[9.5px] uppercase tracking-[1px] text-muted-foreground">
                  etapa {cur.si + 1} de {SCREENS.length}
                </Text>
                <Text
                  className="text-[13.5px] font-sans-semibold text-foreground"
                  numberOfLines={1}
                >
                  {stage.title}
                </Text>
              </View>
              <ChevronDown size={16} color={C.muted} />
            </Pressable>
            <Pressable
              onPress={() => setView("saved")}
              accessibilityLabel="Guardar y salir"
              className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80"
            >
              <Save size={18} color={C.muted} />
            </Pressable>
          </View>

          <View className="mt-3.5 flex-row gap-1.5">
            {segments.map((w, i) => (
              <View key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <View
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: `${Math.round(w * 100)}%` as `${number}%` }}
                />
              </View>
            ))}
          </View>
          <View className="mt-2 flex-row items-baseline justify-between">
            <Text className="font-mono text-[11px] text-muted-foreground">
              pregunta {Math.max(1, curIndex + 1)} de {total}
            </Text>
            <Text className="font-mono text-[11px] text-muted-foreground">quedan {remaining}</Text>
          </View>

          <ScrollView
            ref={scrollRef}
            className="mt-5 flex-1"
            contentContainerClassName="gap-3 pb-2"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          >
            {visibleTurns.map((n) => (
              <View key={n.key} className="gap-3">
                <View className="items-start">
                  <View className="max-w-[85%] rounded-3xl bg-surface px-4 py-3">
                    <Text className="text-sm leading-relaxed text-foreground">{displayQ(n).q}</Text>
                  </View>
                </View>
                {answers[n.key] !== undefined ? (
                  <View className="items-end">
                    <Pressable
                      onPress={() => goTo(n.key)}
                      className="max-w-[85%] flex-row items-center gap-2 rounded-3xl bg-primary px-4 py-3 active:opacity-90"
                    >
                      <Text className="text-sm leading-relaxed text-primary-foreground">
                        {answers[n.key]}
                      </Text>
                      <Pencil size={14} color={C.onPrimary} />
                    </Pressable>
                  </View>
                ) : skipped[n.key] ? (
                  <View className="items-end">
                    <Pressable
                      onPress={() => goTo(n.key)}
                      className="flex-row items-center gap-2 rounded-full bg-secondary px-4 py-2.5 active:opacity-80"
                    >
                      <SkipForward size={14} color={C.muted} />
                      <Text className="text-[13px] font-sans-medium text-muted-foreground">
                        Saltada — la retomo luego
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>

          {error ? (
            <View className="mb-2 flex-row items-start gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5">
              <Info size={14} color={C.primary} />
              <Text className="flex-1 text-xs text-foreground">{error}</Text>
            </View>
          ) : null}

          {stageEnd ? (
            <View className="mb-2 gap-3.5 rounded-3xl bg-surface p-4">
              <Text className="text-sm leading-relaxed text-muted-foreground">
                Etapa completa:{" "}
                <Text className="font-sans-medium text-foreground">
                  {stage.subtitle.toLowerCase()}
                </Text>
                .{" "}
                {isLastStage
                  ? "Es la última: ya podemos repasarlo todo."
                  : `Seguimos con ${SCREENS[cur.si + 1]!.subtitle.toLowerCase()}.`}
              </Text>
              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={back}
                  className="flex-row items-center justify-center gap-1.5 rounded-full bg-secondary px-4 py-3 active:opacity-80"
                >
                  <ArrowLeft size={15} color={C.muted} />
                  <Text className="text-[13.5px] font-sans-semibold text-muted-foreground">
                    Repasar
                  </Text>
                </Pressable>
                <Pressable
                  onPress={advanceStage}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3 active:opacity-90"
                >
                  <Text className="text-[13.5px] font-sans-semibold text-primary-foreground">
                    {isLastStage ? "Ver mi resumen" : "Continuar"}
                  </Text>
                  <ArrowRight size={16} color={C.onPrimary} />
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="mb-2 gap-2.5">
              {currentQ.chips?.length ? (
                <View className="flex-row flex-wrap gap-2">
                  {currentQ.chips.map((c) => {
                    const active = selectedChips.has(c);
                    return (
                      <Pressable
                        key={c}
                        onPress={() => toggleChip(c)}
                        className={`min-h-[44px] flex-row items-center gap-1.5 rounded-full px-4 active:opacity-80 ${
                          active ? "bg-foreground" : "bg-surface"
                        }`}
                      >
                        {active ? <Check size={14} color={C.onPrimary} /> : null}
                        <Text
                          className={`text-[13.5px] ${
                            active
                              ? "font-sans-semibold text-primary-foreground"
                              : "font-sans-medium text-foreground"
                          }`}
                        >
                          {c}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View className="rounded-3xl bg-surface p-2">
                <TextInput
                  editable={!saving}
                  value={value}
                  onChangeText={setValue}
                  multiline={!currentQ.dateInput}
                  keyboardType={currentQ.dateInput ? "numbers-and-punctuation" : "default"}
                  onSubmitEditing={currentQ.dateInput ? () => commit(value) : undefined}
                  placeholder={
                    saving
                      ? "Preparando tu plan..."
                      : currentQ.dateInput
                        ? "DD/MM/AAAA"
                        : (currentQ.hint ?? "Escribe aquí...")
                  }
                  placeholderTextColor={C.muted}
                  className="min-h-[44px] px-2 py-2 text-sm text-foreground"
                  textAlignVertical="top"
                />
                <View className="flex-row items-center justify-between px-1">
                  <Pressable
                    onPress={skipCurrent}
                    disabled={saving}
                    className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1.5 active:opacity-70"
                  >
                    <SkipForward size={14} color={C.muted} />
                    <Text className="text-xs font-sans-medium text-muted-foreground">
                      Saltar y volver luego
                    </Text>
                  </Pressable>
                  <View className="flex-row items-center gap-2">
                    {!currentQ.dateInput ? (
                      <DictateButton
                        onText={(t) => setValue((v) => (v.trim() ? `${v.trim()} ${t}` : t))}
                      />
                    ) : null}
                    <Pressable
                      onPress={() => commit(value)}
                      disabled={saving || !value.trim()}
                      accessibilityLabel="Enviar"
                      className={`h-11 w-11 items-center justify-center rounded-full bg-primary ${
                        saving || !value.trim() ? "opacity-40" : ""
                      }`}
                    >
                      <Send size={16} color={C.onPrimary} />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 px-5 pt-2">{children}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1">
        <Text className="font-mono text-[9.5px] uppercase tracking-[1px] text-muted-foreground">
          {eyebrow}
        </Text>
        <Text className="mt-0.5 font-display text-[22px] text-foreground">{title}</Text>
      </View>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Cerrar"
        className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80"
      >
        <X size={18} color={C.fg} />
      </Pressable>
    </View>
  );
}

function PlanGeneratingScreen() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % GENERATING_MESSAGES.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <SafeAreaView className="flex-1 items-center justify-center gap-10 bg-background px-8">
      <View className="h-40 w-40 items-center justify-center">
        <View className="absolute h-32 w-32 rounded-full bg-primary/10" />
        <View className="absolute h-24 w-24 rounded-full bg-primary/15" />
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary">
          <Sparkles size={28} color={C.onPrimary} />
        </View>
      </View>

      <View className="items-center gap-2.5">
        <Text className="font-heading text-xl text-foreground">Estoy preparando tu plan</Text>
        <Text className="min-h-[20px] text-center text-sm text-muted-foreground">
          {GENERATING_MESSAGES[i]}
        </Text>
      </View>

      <ActivityIndicator color={C.primary} />
    </SafeAreaView>
  );
}
