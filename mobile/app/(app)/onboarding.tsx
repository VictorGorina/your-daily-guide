import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Info,
  Pencil,
  Send,
  SkipForward,
  Sparkles,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
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

import { apiPost } from "../../lib/api";
import { ageFromDOB } from "../../lib/age";
import { addMessage, monthISO, saveProfile } from "../../lib/daily";
import type { OnboardingDraft } from "../../lib/onboarding";

/**
 * Onboarding conversacional, port 1:1 de `src/routes/_authenticated/onboarding.tsx`
 * de la web. La lógica (máquina de estados del chat, revisión final, guardado +
 * generación de plan) es idéntica; cambia el transporte de las operaciones de IA
 * (server functions → `/api/v1/*` vía apiPost) y la UI (DOM → React Native).
 *
 * Diferencia respecto a la web: la fecha de nacimiento se teclea como DD/MM/AAAA
 * (RN no trae un `<input type="date">`); la validación y el guardado en ISO son
 * los mismos.
 */

type Turn = { role: "coach" | "me"; text: string };
type Question = {
  q: string;
  hint?: string;
  chips?: string[];
  multi?: boolean;
  optional?: boolean;
  /** Pide la respuesta como fecha DD/MM/AAAA en vez de texto libre. */
  dateInput?: boolean;
  validate?: (text: string) => string | null;
};
type Screen = { title: string; subtitle: string; questions: Question[] };

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
};

const LIVES_WITH_Q: Question = {
  q: "¿Con quién vives? Dime si compartes las comidas con alguien y cuáles (por ejemplo, cenáis siempre juntos).",
  hint: "Ej.: vivo con mi pareja, cenamos juntos todos los días",
};

const BUDGET_Q: Question = {
  q: "¿Cuánto tiempo tienes para cocinar al día y cuánto te quieres gastar en comida al mes?",
  hint: "Ej.: 20 min al día y unos 250 € al mes",
};

const PARTNER_APP_Q: Question = {
  q: "¿Tu pareja también va a usar Peppers? Si la instala, podéis uniros en Tu hogar y compartir comidas y compra.",
  hint: "Así sé si el presupuesto que me des luego es solo tuyo o el de los dos",
  chips: ["Sí, también la usará", "No, de momento no"],
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
        q: "¿Tomas algún medicamento que afecte al apetito, metabolismo o energía?",
        hint: "Opcional",
        optional: true,
      },
      {
        q: "¿Tienes alergias o intolerancias alimentarias?",
        hint: "Si no hay ninguna, dime 'ninguna'",
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
      {
        q: "¿Sigues algún patrón alimentario?",
        chips: ["Omnívoro", "Vegetariano", "Vegano", "Sin gluten"],
      },
      {
        q: "¿Hay algún alimento que no estés dispuesto a eliminar bajo ningún concepto?",
        hint: "Ej.: mi café con leche de la mañana y el chocolate del finde",
      },
      {
        q: "¿Cómo describirías tu relación con la comida hoy en día?",
        hint: "Sin filtros, aquí no se juzga nada",
        chips: ["Tranquila", "Ansiosa", "Sin tiempo para pensarlo"],
      },
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
        q: "¿Qué es lo que más te ha costado mantener en intentos anteriores?",
        hint: "Saberlo me ayuda a no repetir lo que no te funciona",
      },
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

const TOTAL = SCREENS.reduce((n, s) => n + s.questions.length, 0);

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

type Answer = { key: string; q: string; section: string; a: string };
type Review = { draft: Draft; missing: GapKey[] };

const KEY_FIELDS: GapKey[] = ["current_weight_kg", "height_cm", "morning_time", "evening_time"];
const STAGES = [...SCREENS.map((s) => s.title), "Revisión"];
const TOTAL_UNITS = TOTAL + 1;

const GENERATING_MESSAGES = [
  "Leyendo todo lo que me has contado...",
  "Ajustando las cantidades a ti...",
  "Pensando en tus gustos y tu ritmo de vida...",
  "Encajando las comidas en tu semana...",
  "Dando los últimos retoques a tu plan...",
];

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();

  const parse = (transcript: string) => apiPost<Draft>("onboarding/parse", { transcript });
  const makePlan = (month: string) => apiPost("plan/generate", { month });
  const brief = (month: string) => apiPost<{ text?: string }>("plan/welcome", { month });

  const [screen, setScreen] = useState(0);
  const [step, setStep] = useState(0);
  const [screenDone, setScreenDone] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([
    { role: "coach", text: SCREENS[0]!.questions[0]!.q },
  ]);
  const [value, setValue] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  const [dob, setDob] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Answer[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const [pending, setPending] = useState<Question | null>(null);
  const [partnerHasApp, setPartnerHasApp] = useState<boolean | null>(null);

  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    setSelectedChips(new Set());
  }, [screen, step]);

  const resolveQuestion = (base: Question): Question => {
    if (base === BUDGET_Q && partnerHasApp === false) {
      return {
        ...base,
        q: "¿Cuánto tiempo tienes para cocinar al día y cuál es el presupuesto mensual TOTAL de la casa (contando a tu pareja) en comida?",
        hint: "Como tu pareja no va a usar la app, planificamos la compra para los dos. Ej.: 20 min al día y unos 400 € al mes en total",
      };
    }
    return base;
  };

  const current = pending ?? resolveQuestion(SCREENS[screen]!.questions[step]!);

  const saveAll = async (draft: Draft, extra: Partial<Draft>) => {
    setSaving(true);
    const d = { ...draft, ...extra };
    try {
      await saveProfile({
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
        onboarding_completed: true,
      });

      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.refetchQueries({ queryKey: ["profile"] });
      qc.removeQueries({ queryKey: ["today"] });
      qc.removeQueries({ queryKey: ["logs"] });

      const month = monthISO();
      try {
        await makePlan(month);
        const { text } = await brief(month);
        if (text) {
          setTurns((prev) => [...prev, { role: "coach", text }]);
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

  const transcriptFrom = (list: Answer[]) =>
    list.map((a) => `Coach: ${a.q}\nPersona: ${a.a}`).join("\n");

  const buildReview = async (list: Answer[]) => {
    setSaving(true);
    try {
      const parsed = await parse(transcriptFrom(list));
      const bio = parseBiometrics(list.find((a) => a.q === BIO_Q.q)?.a ?? "");
      const draft: Draft = {
        ...parsed,
        date_of_birth: dob ?? parsed.date_of_birth,
        age: dob ? ageFromDOB(dob) : (parsed.age ?? bio.age),
        current_weight_kg: parsed.current_weight_kg ?? bio.weight,
        height_cm: parsed.height_cm ?? bio.height,
      };
      const missing = KEY_FIELDS.filter((k) => !draft[k as keyof Draft]);
      setGapValues({
        current_weight_kg: draft.current_weight_kg ? String(draft.current_weight_kg) : "",
        height_cm: draft.height_cm ? String(draft.height_cm) : "",
        morning_time: draft.morning_time ?? "",
        evening_time: draft.evening_time ?? "",
      });
      setReview({ draft, missing });
      setDirty(false);
      setError(null);
    } catch (err) {
      Alert.alert(err instanceof Error ? err.message : "No hemos podido preparar la revisión");
    }
    setSaving(false);
  };

  const confirmReview = async () => {
    if (!review) return;
    const extra: Partial<Draft> = {};
    for (const key of KEY_FIELDS) {
      const raw = (gapValues[key] ?? "").trim();
      if (!raw) {
        setError(`Necesito ${GAP_LABEL[key].label.toLowerCase()} para poder guardar.`);
        return;
      }
      if (GAP_LABEL[key].type === "number") {
        const n = Number(raw.replace(",", "."));
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
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
          setError(`${GAP_LABEL[key].label} debe tener formato HH:MM.`);
          return;
        }
        (extra as Record<string, unknown>)[key] = raw;
      }
    }
    setError(null);

    let draft = review.draft;
    if (dirty) {
      setSaving(true);
      try {
        const reparsed = await parse(transcriptFrom(answers));
        const bio = parseBiometrics(answers.find((a) => a.q === BIO_Q.q)?.a ?? "");
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
    }
    setReview(null);
    setFinishing(true);
    await saveAll(draft, extra);
  };

  const toggleChip = (c: string) => {
    if (!current?.multi) {
      setSelectedChips(new Set([c]));
      setValue(c);
      return;
    }
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      const ordered = current?.chips?.filter((chip) => next.has(chip)) ?? [];
      setValue(ordered.join(", "));
      return next;
    });
  };

  const answerPending = (text: string) => {
    const hasApp = /^\s*s[ií]\b/i.test(text) ? true : /^\s*no\b/i.test(text) ? false : null;
    setPartnerHasApp(hasApp);
    setAnswers((prev) => [
      ...prev,
      {
        key: `${screen}-partner-app`,
        q: PARTNER_APP_Q.q,
        section: SCREENS[screen]!.title,
        a: text,
      },
    ]);
    setValue("");
    setError(null);
    setPending(null);

    const next: Turn[] = [...turns, { role: "me", text }];
    const note =
      hasApp === true
        ? "Genial, cuando termines podéis uniros en Tu hogar (dentro de Ajustes) para compartir comidas y compra. "
        : hasApp === false
          ? "Entendido, más adelante te pido el presupuesto total de la casa para que la compra os cubra a los dos. "
          : "";

    const following = SCREENS[screen]!.questions[step];
    if (following) {
      setTurns([...next, { role: "coach", text: note + resolveQuestion(following).q }]);
      return;
    }
    if (screen + 1 < SCREENS.length) {
      setTurns(next);
      setScreenDone(true);
      return;
    }
    setTurns(next);
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || saving || screenDone) return;

    if (pending) {
      answerPending(text);
      return;
    }

    const problem = current?.validate?.(text);
    if (problem) {
      setError(problem);
      const shown = current?.dateInput ? formatDatePretty(text) : text;
      setTurns((prev) => [...prev, { role: "me", text: shown }, { role: "coach", text: problem }]);
      setValue("");
      return;
    }
    setError(null);

    if (current?.dateInput) setDob(text);
    const shown = current?.dateInput ? formatDatePretty(text) : text;

    const next: Turn[] = [...turns, { role: "me", text: shown }];
    const nextAnswers: Answer[] = [
      ...answers,
      { key: `${screen}-${step}`, q: current.q, section: SCREENS[screen]!.title, a: shown },
    ];
    setAnswers(nextAnswers);
    setValue("");

    if (current === LIVES_WITH_Q && /\bpareja\b/i.test(text)) {
      setTurns([...next, { role: "coach", text: PARTNER_APP_Q.q }]);
      setStep(step + 1);
      setPending(PARTNER_APP_Q);
      return;
    }

    const following = SCREENS[screen]!.questions[step + 1];
    if (following) {
      setTurns([...next, { role: "coach", text: resolveQuestion(following).q }]);
      setStep(step + 1);
      return;
    }

    if (screen + 1 < SCREENS.length) {
      setTurns(next);
      setScreenDone(true);
      return;
    }

    setTurns([
      ...next,
      {
        role: "coach",
        text: "Gracias por contármelo todo. Antes de guardar, repasa conmigo tus respuestas y corrige lo que quieras.",
      },
    ]);
    void buildReview(nextAnswers);
  };

  const submit = () => {
    if (current?.dateInput) {
      const iso = parseDatePretty(value);
      send(iso ?? value);
    } else {
      send(value);
    }
  };

  const nextScreen = () => {
    const nextIndex = screen + 1;
    setTurns([{ role: "coach", text: resolveQuestion(SCREENS[nextIndex]!.questions[0]!).q }]);
    setScreen(nextIndex);
    setStep(0);
    setScreenDone(false);
  };

  // --- Pantalla: generando plan ---
  if (finishing && !done) return <PlanGeneratingScreen />;

  // --- Pantalla: revisión final ---
  if (review) {
    const sections = SCREENS.map((s) => ({
      title: s.title,
      items: answers.filter((a) => a.section === s.title),
    })).filter((s) => s.items.length);

    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 px-5 pt-2">
            <OnboardingProgress
              stage={SCREENS.length}
              stageFill={1}
              answeredUnits={TOTAL}
              title="Repasa tus respuestas"
              subtitle="Revisión final"
            />
            <Text className="mt-2 text-xs text-muted-foreground">
              Toca cualquier respuesta para corregirla. Sin prisa: cuando esté bien, confirmamos.
            </Text>

            <ScrollView className="mt-5 flex-1" contentContainerClassName="gap-5 pb-4">
              <View className="gap-3 rounded-3xl bg-surface p-4">
                <Text className="text-sm font-sans-medium text-foreground">Datos clave</Text>
                {KEY_FIELDS.map((key) => (
                  <View key={key}>
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-xs text-muted-foreground">{GAP_LABEL[key].label}</Text>
                      {review.missing.includes(key) ? (
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
                      placeholderTextColor="#83796c"
                      className="mt-1 h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                    />
                    <Text className="mt-1 text-[11px] text-muted-foreground">
                      {GAP_LABEL[key].help}
                    </Text>
                  </View>
                ))}
              </View>

              {sections.map((s) => (
                <View key={s.title} className="gap-2">
                  <Text className="px-1 text-xs font-sans-semibold uppercase tracking-wide text-muted-foreground">
                    {s.title}
                  </Text>
                  {s.items.map((a) => (
                    <View key={a.key} className="rounded-3xl bg-surface p-4">
                      <Text className="text-xs leading-relaxed text-muted-foreground">{a.q}</Text>
                      {editing === a.key ? (
                        <View className="mt-2 gap-2">
                          <TextInput
                            multiline
                            value={a.a}
                            onChangeText={(t) => {
                              setAnswers((prev) =>
                                prev.map((x) => (x.key === a.key ? { ...x, a: t } : x)),
                              );
                              if (a.q === BIRTHDATE_Q.q) setDob(parseDatePretty(t));
                              setDirty(true);
                            }}
                            className="min-h-[72px] rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-foreground"
                            textAlignVertical="top"
                          />
                          <Pressable
                            onPress={() => setEditing(null)}
                            className="self-end rounded-full bg-secondary px-3.5 py-1.5"
                          >
                            <Text className="text-xs font-sans-medium text-secondary-foreground">
                              Listo
                            </Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => setEditing(a.key)}
                          className="mt-1.5 flex-row items-start justify-between gap-3"
                        >
                          <Text className="flex-1 text-sm text-foreground">{a.a}</Text>
                          <Pencil size={14} color="#83796c" />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>

            {error ? (
              <View className="mb-2 flex-row items-start gap-1.5">
                <AlertCircle size={14} color="#e2685f" />
                <Text className="flex-1 text-xs text-destructive">{error}</Text>
              </View>
            ) : null}
            {dirty ? (
              <View className="mb-2 flex-row items-start gap-1.5">
                <Info size={14} color="#6dbe7b" />
                <Text className="flex-1 text-xs text-muted-foreground">
                  He anotado tus cambios, los releo al confirmar.
                </Text>
              </View>
            ) : null}

            <Pressable
              disabled={saving}
              onPress={() => void confirmReview()}
              className="mb-2 flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-50"
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {saving ? "Guardando..." : "Confirmar y guardar mi perfil"}
              </Text>
              {saving ? null : <Check size={16} color="#3e3d39" />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- Pantalla: chat del cuestionario ---
  const stageFill = done ? 1 : screenDone ? 1 : (step + 1) / SCREENS[screen]!.questions.length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 px-5 pt-2">
          <OnboardingProgress
            stage={screen}
            stageFill={stageFill}
            answeredUnits={done ? TOTAL + 1 : answers.length}
            title={SCREENS[screen]!.title}
            subtitle={SCREENS[screen]!.subtitle}
          />

          <ScrollView
            ref={scrollRef}
            className="mt-6 flex-1"
            contentContainerClassName="gap-3 pb-2"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          >
            {turns.map((t, i) => (
              <View
                key={`${screen}-${i}-${t.text.slice(0, 12)}`}
                className={t.role === "me" ? "items-end" : "items-start"}
              >
                <View
                  className={`max-w-[85%] rounded-3xl px-4 py-3 ${
                    t.role === "me" ? "bg-primary" : "bg-surface"
                  }`}
                >
                  <Text
                    className={`text-sm leading-relaxed ${
                      t.role === "me" ? "text-primary-foreground" : "text-foreground"
                    }`}
                  >
                    {t.text}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {!saving && !screenDone && !done && current?.chips?.length ? (
            <View className="mb-2 flex-row flex-wrap gap-2">
              {current.chips.map((c) => {
                const active = selectedChips.has(c);
                return (
                  <Pressable
                    key={c}
                    onPress={() => toggleChip(c)}
                    className={`rounded-full px-3.5 py-2 active:opacity-80 ${
                      active ? "bg-foreground" : "bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-xs font-sans-medium ${
                        active ? "text-primary-foreground" : "text-foreground"
                      }`}
                    >
                      {c}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {error && !done ? (
            <View className="mb-2 flex-row items-start gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5">
              <Info size={14} color="#6dbe7b" />
              <Text className="flex-1 text-xs text-foreground">{error}</Text>
            </View>
          ) : null}

          {done ? (
            <Pressable
              onPress={() => router.replace("/hoy")}
              className="mb-2 w-full items-center rounded-full bg-primary py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                Empezar mi primer día
              </Text>
            </Pressable>
          ) : screenDone ? (
            <View className="mb-2 gap-3 rounded-3xl bg-surface p-4">
              <Text className="text-sm text-muted-foreground">
                Perfecto, ya tengo {SCREENS[screen]!.subtitle.toLowerCase()}. Seguimos con{" "}
                <Text className="font-sans-medium text-foreground">
                  {SCREENS[screen + 1]!.subtitle.toLowerCase()}
                </Text>
                .
              </Text>
              <Pressable
                onPress={nextScreen}
                className="flex-row items-center justify-center gap-2 rounded-full bg-primary py-3.5 active:opacity-90"
              >
                <Text className="text-sm font-sans-semibold text-primary-foreground">
                  Continuar
                </Text>
                <ArrowRight size={16} color="#3e3d39" />
              </Pressable>
            </View>
          ) : (
            <View className="mb-2 rounded-3xl bg-surface p-2">
              <TextInput
                editable={!saving}
                value={value}
                onChangeText={setValue}
                multiline={!current?.dateInput}
                keyboardType={current?.dateInput ? "numbers-and-punctuation" : "default"}
                onSubmitEditing={current?.dateInput ? submit : undefined}
                placeholder={
                  saving
                    ? "Preparando tu plan..."
                    : current?.dateInput
                      ? "DD/MM/AAAA"
                      : (current?.hint ?? "Escribe aquí...")
                }
                placeholderTextColor="#83796c"
                className="min-h-[44px] px-2 py-2 text-sm text-foreground"
                textAlignVertical="top"
              />
              <View className="flex-row items-center justify-between px-1">
                <View className="flex-row items-center gap-1">
                  {current?.optional ? (
                    <Pressable
                      onPress={() => send("Nada que destacar")}
                      disabled={saving}
                      className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1.5"
                    >
                      <SkipForward size={14} color="#83796c" />
                      <Text className="text-xs font-sans-medium text-muted-foreground">Saltar</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  onPress={submit}
                  disabled={saving || !value.trim()}
                  className={`h-9 w-9 items-center justify-center rounded-full bg-primary ${
                    saving || !value.trim() ? "opacity-40" : ""
                  }`}
                >
                  <Send size={16} color="#3e3d39" />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OnboardingProgress({
  stage,
  stageFill,
  answeredUnits,
  title,
  subtitle,
}: {
  stage: number;
  stageFill: number;
  answeredUnits: number;
  title: string;
  subtitle: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, answeredUnits / TOTAL_UNITS)) * 100);
  const left = STAGES.length - stage - 1;

  return (
    <View>
      <View className="flex-row items-end justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-sans-medium text-muted-foreground">
            Etapa {stage + 1} de {STAGES.length} · {subtitle}
          </Text>
          <Text className="text-lg font-sans-semibold text-foreground" numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-xs font-sans-medium text-foreground">{pct}%</Text>
          <Text className="text-[11px] text-muted-foreground">
            {left > 0 ? `Quedan ${left} ${left === 1 ? "etapa" : "etapas"}` : "Última etapa"}
          </Text>
        </View>
      </View>
      <View className="mt-3 flex-row gap-1.5">
        {STAGES.map((label, i) => {
          const width =
            i < stage
              ? "100%"
              : i === stage
                ? `${Math.round(Math.min(1, Math.max(0.08, stageFill)) * 100)}%`
                : "0%";
          return (
            <View key={label} className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <View
                className="h-1.5 rounded-full bg-primary"
                style={{ width: width as `${number}%` }}
              />
            </View>
          );
        })}
      </View>
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
          <Sparkles size={28} color="#3e3d39" />
        </View>
      </View>

      <View className="items-center gap-2.5">
        <Text className="font-heading text-xl text-foreground">Estoy preparando tu plan</Text>
        <Text className="min-h-[20px] text-center text-sm text-muted-foreground">
          {GENERATING_MESSAGES[i]}
        </Text>
      </View>

      <ActivityIndicator color="#6dbe7b" />
    </SafeAreaView>
  );
}
