import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Info,
  Pencil,
  Send,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DictateButton } from "@/components/dictate-button";
import { ageFromDOB } from "@/lib/age";
import { addMessage, monthISO, saveProfile } from "@/lib/daily";
import { parseOnboarding } from "@/lib/onboarding.functions";
import { generateMonthlyPlan, welcomeBriefing } from "@/lib/plan.functions";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

type Turn = { role: "coach" | "me"; text: string };
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
};

const LIVES_WITH_Q: Question = {
  q: "¿Con quién vives? Dime si compartes las comidas con alguien y cuáles (por ejemplo, cenáis siempre juntos).",
  hint: "Ej.: vivo con mi pareja, cenamos juntos todos los días",
};

const BUDGET_Q: Question = {
  q: "¿Cuánto tiempo tienes para cocinar al día y cuánto te quieres gastar en comida al mes?",
  hint: "Ej.: 20 min al día y unos 250 € al mes",
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

type Answer = { key: string; q: string; section: string; a: string };
type Review = { draft: Draft; missing: GapKey[] };

const KEY_FIELDS: GapKey[] = ["current_weight_kg", "height_cm", "morning_time", "evening_time"];

function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const parse = useServerFn(parseOnboarding);
  const makePlan = useServerFn(generateMonthlyPlan);
  const brief = useServerFn(welcomeBriefing);

  const [screen, setScreen] = useState(0);
  const [step, setStep] = useState(0);
  const [screenDone, setScreenDone] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [turns, setTurns] = useState<Turn[]>([{ role: "coach", text: SCREENS[0].questions[0].q }]);
  const [value, setValue] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // Se activa justo al confirmar la revisión final: mientras esté en true (y aún
  // no haya terminado), sustituimos toda la pantalla por la animación de "generando
  // tu plan" en vez del formulario de chat deshabilitado.
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  // Fecha de nacimiento en ISO (YYYY-MM-DD), capturada directamente del selector de
  // fecha: no dependemos de que la IA la extraiga bien del texto, así que se usa
  // siempre como fuente de verdad para la edad, tanto al guardar como más adelante.
  const [dob, setDob] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Answer[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Pregunta dinámica ("¿tu pareja también usa la app?"), insertada solo cuando
  // la respuesta a LIVES_WITH_Q menciona a la pareja. Mientras esté activa, sustituye
  // a la pregunta de la pantalla actual sin consumir un "step" del flujo fijo.
  const [pending, setPending] = useState<Question | null>(null);
  const [partnerHasApp, setPartnerHasApp] = useState<boolean | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    if (!saving && !screenDone && !done) inputRef.current?.focus();
  }, [turns, saving, screenDone, done]);

  useEffect(() => {
    setSelectedChips(new Set());
  }, [screen, step]);

  const answered = SCREENS.slice(0, screen).reduce((n, s) => n + s.questions.length, 0) + step;
  const progress = Math.min(1, (answered + 1) / TOTAL);

  // Si la pareja no va a usar la app, no hay quien más registre su parte del gasto:
  // pedimos el presupuesto total de la casa en vez del personal.
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

  const current = pending ?? resolveQuestion(SCREENS[screen].questions[step]);

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
        await makePlan({ data: { month } });
        const { text } = await brief({ data: { month } });
        if (text) {
          setTurns((prev) => [...prev, { role: "coach", text }]);
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No hemos podido guardar");
      setSaving(false);
      setFinishing(false);
    }
  };

  const transcriptFrom = (list: Answer[]) =>
    list.map((a) => `Coach: ${a.q}\nPersona: ${a.a}`).join("\n");

  const buildReview = async (list: Answer[]) => {
    setSaving(true);
    try {
      const parsed = (await parse({ data: { transcript: transcriptFrom(list) } })) as Draft;
      // Respaldo local: si la IA no ha leído bien peso o altura, los sacamos del texto.
      const bio = parseBiometrics(list.find((a) => a.q === BIO_Q.q)?.a ?? "");
      const draft: Draft = {
        ...parsed,
        // La fecha de nacimiento (y la edad que sacamos de ella) vienen siempre del
        // selector de fecha, nunca del parseo por IA: es la fuente exacta.
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No hemos podido preparar la revisión");
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
        const reparsed = (await parse({ data: { transcript: transcriptFrom(answers) } })) as Draft;
        const bio = parseBiometrics(answers.find((a) => a.q === BIO_Q.q)?.a ?? "");
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
    }
    setReview(null);
    setFinishing(true);
    await saveAll(draft, extra);
  };

  const toggleChip = (c: string) => {
    // La mayoría de estas preguntas piden un único valor (nivel de actividad, tono,
    // número de comidas...), así que elegir un chip sustituye al anterior en vez de
    // sumarse. Solo las preguntas marcadas con `multi` permiten combinar varios.
    if (!current?.multi) {
      setSelectedChips(new Set([c]));
      setValue(c);
      inputRef.current?.focus();
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
    inputRef.current?.focus();
  };

  /** Respuesta a PARTNER_APP_Q: guarda si la pareja usará la app y retoma el flujo fijo. */
  const answerPending = (text: string) => {
    const hasApp = /^\s*s[ií]\b/i.test(text) ? true : /^\s*no\b/i.test(text) ? false : null;
    setPartnerHasApp(hasApp);
    setAnswers((prev) => [
      ...prev,
      { key: `${screen}-partner-app`, q: PARTNER_APP_Q.q, section: SCREENS[screen].title, a: text },
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

    const following = SCREENS[screen].questions[step];
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

    // La fecha de nacimiento se guarda tal cual (ISO) para poder recalcular la edad
    // más adelante; en el chat mostramos el formato dd/mm/aaaa, más legible.
    if (current?.dateInput) setDob(text);
    const shown = current?.dateInput ? formatDatePretty(text) : text;

    const next: Turn[] = [...turns, { role: "me", text: shown }];
    const nextAnswers: Answer[] = [
      ...answers,
      { key: `${screen}-${step}`, q: current.q, section: SCREENS[screen].title, a: shown },
    ];
    setAnswers(nextAnswers);
    setValue("");

    if (current === LIVES_WITH_Q && /\bpareja\b/i.test(text)) {
      setTurns([...next, { role: "coach", text: PARTNER_APP_Q.q }]);
      setStep(step + 1);
      setPending(PARTNER_APP_Q);
      return;
    }

    const following = SCREENS[screen].questions[step + 1];
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
    setHistory((h) => [...h, ...next]);
    void buildReview(nextAnswers);
  };

  const nextScreen = () => {
    const nextIndex = screen + 1;
    setHistory((h) => [...h, ...turns]);
    setTurns([{ role: "coach", text: resolveQuestion(SCREENS[nextIndex].questions[0]).q }]);
    setScreen(nextIndex);
    setStep(0);
    setScreenDone(false);
  };

  if (review) {
    const sections = SCREENS.map((s) => ({
      title: s.title,
      items: answers.filter((a) => a.section === s.title),
    })).filter((s) => s.items.length);

    return (
      <main className="mx-auto flex h-[100dvh] max-w-lg flex-col px-5 pb-5 pt-10">
        <OnboardingProgress
          stage={SCREENS.length}
          stageFill={1}
          answeredUnits={TOTAL}
          title="Repasa tus respuestas"
          subtitle="Revisión final"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Toca cualquier respuesta para corregirla. Sin prisa: cuando esté bien, confirmamos.
        </p>

        <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
          <section className="space-y-3 rounded-3xl border border-border bg-surface p-4">
            <p className="text-sm font-medium">Datos clave</p>
            {KEY_FIELDS.map((key) => (
              <label key={key} className="block text-xs text-muted-foreground">
                {GAP_LABEL[key].label}
                {review.missing.includes(key) ? (
                  <span className="ml-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                    falta
                  </span>
                ) : null}
                <input
                  type={GAP_LABEL[key].type === "time" ? "time" : "text"}
                  inputMode={GAP_LABEL[key].type === "number" ? "decimal" : undefined}
                  value={gapValues[key] ?? ""}
                  onChange={(e) => setGapValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="mt-1 h-12 w-full rounded-2xl border border-input bg-background px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                />
                <span className="mt-1 block text-[11px]">{GAP_LABEL[key].help}</span>
              </label>
            ))}
          </section>

          {sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.title}
              </p>
              {s.items.map((a) => (
                <div key={a.key} className="rounded-3xl border border-border bg-surface p-4">
                  <p className="text-xs leading-relaxed text-muted-foreground">{a.q}</p>
                  {editing === a.key ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        rows={3}
                        value={a.a}
                        onChange={(e) => {
                          const text = e.target.value;
                          setAnswers((prev) =>
                            prev.map((x) => (x.key === a.key ? { ...x, a: text } : x)),
                          );
                          // Si corrige la fecha de nacimiento aquí, releemos su fecha exacta
                          // (dd/mm/aaaa); si no encaja, dejamos que la IA la reinterprete al confirmar.
                          if (a.q === BIRTHDATE_Q.q) setDob(parseDatePretty(text));
                          setDirty(true);
                        }}
                        className="w-full resize-none rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                      />
                      <div className="flex items-center justify-between">
                        <DictateButton
                          onText={(t) => {
                            setAnswers((prev) =>
                              prev.map((x) =>
                                x.key === a.key ? { ...x, a: x.a ? `${x.a.trim()} ${t}` : t } : x,
                              ),
                            );
                            setDirty(true);
                          }}
                          label="Dictar"
                        />
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="rounded-full bg-secondary px-3.5 py-1.5 text-xs font-medium"
                        >
                          Listo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(a.key)}
                      className="mt-1.5 flex w-full items-start justify-between gap-3 text-left"
                    >
                      <span className="text-sm text-foreground">{a.a}</span>
                      <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>

        {error ? (
          <p className="animate-rise mb-2 flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        ) : null}
        {dirty ? (
          <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> He anotado tus cambios,
            los releo al confirmar.
          </p>
        ) : null}

        <button
          type="button"
          disabled={saving}
          onClick={() => void confirmReview()}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Confirmar y guardar mi perfil"}
          {saving ? null : <Check className="h-4 w-4" />}
        </button>
      </main>
    );
  }

  if (finishing && !done) {
    return <PlanGeneratingScreen />;
  }

  return (
    <main className="mx-auto flex h-[100dvh] max-w-lg flex-col px-5 pb-5 pt-10">
      <OnboardingProgress
        stage={screen}
        stageFill={done ? 1 : screenDone ? 1 : (step + 1) / SCREENS[screen].questions.length}
        answeredUnits={done ? TOTAL + 1 : answers.length}
        title={SCREENS[screen].title}
        subtitle={SCREENS[screen].subtitle}
      />

      <div className="mt-6 min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {turns.map((t, i) => (
          <div
            key={`${screen}-${i}-${t.text.slice(0, 12)}`}
            className={`animate-rise flex ${t.role === "me" ? "justify-end" : "justify-start"}`}
          >
            <p
              className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-relaxed ${
                t.role === "me"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-surface text-foreground"
              }`}
            >
              {t.text}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {!saving && !screenDone && !done && current?.chips?.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {current.chips.map((c) => {
            const active = selectedChips.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleChip(c)}
                aria-pressed={active}
                className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-transform active:scale-95 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-surface"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      ) : null}

      {error && !done ? (
        <div className="animate-rise mb-2 flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary-soft px-3.5 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{error}</span>
        </div>
      ) : null}

      {done ? (
        <button
          type="button"
          onClick={() => navigate({ to: "/hoy", replace: true })}
          className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Empezar mi primer día
        </button>
      ) : screenDone ? (
        <div className="animate-rise space-y-3 rounded-3xl border border-border bg-surface p-4">
          <p className="text-sm text-muted-foreground">
            Perfecto, ya tengo {SCREENS[screen].subtitle.toLowerCase()}. Seguimos con{" "}
            <span className="font-medium text-foreground">
              {SCREENS[screen + 1].subtitle.toLowerCase()}
            </span>
            .
          </p>
          <button
            type="button"
            onClick={nextScreen}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Continuar <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(value);
          }}
          className="rounded-3xl border border-input bg-surface p-2"
        >
          {current?.dateInput ? (
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
                  send(value);
                }
              }}
              placeholder={saving ? "Preparando tu plan..." : (current?.hint ?? "Escribe aquí...")}
              className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            />
          )}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1">
              {current?.dateInput ? null : (
                <DictateButton
                  onText={(t) => setValue((v) => (v ? `${v.trim()} ${t}` : t))}
                  label="Dictar"
                />
              )}
              {current?.optional ? (
                <button
                  type="button"
                  onClick={() => send("Nada que destacar")}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  <SkipForward className="h-3.5 w-3.5" /> Saltar
                </button>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={saving || !value.trim()}
              aria-label="Enviar"
              className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

const STAGES = [...SCREENS.map((s) => s.title), "Revisión"];
const TOTAL_UNITS = TOTAL + 1;

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
    <header>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            Etapa {stage + 1} de {STAGES.length} · {subtitle}
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-xs font-medium text-foreground">{pct}%</span>
          <p className="text-[11px] text-muted-foreground">
            {left > 0 ? `Quedan ${left} ${left === 1 ? "etapa" : "etapas"}` : "Última etapa"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {STAGES.map((label, i) => (
          <span
            key={label}
            aria-label={label}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
          >
            <span
              className="block h-1.5 rounded-full bg-primary transition-all duration-500"
              style={{
                width:
                  i < stage
                    ? "100%"
                    : i === stage
                      ? `${Math.round(Math.min(1, Math.max(0.08, stageFill)) * 100)}%`
                      : "0%",
              }}
            />
          </span>
        ))}
      </div>
    </header>
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
        <span
          aria-hidden
          className="animate-orbit absolute h-40 w-40 rounded-full opacity-70 blur-md"
          style={{
            background:
              "conic-gradient(from 0deg, transparent, color-mix(in oklab, var(--color-primary) 60%, transparent), transparent 65%)",
          }}
        />
        <span className="animate-coach-pulse absolute h-32 w-32 rounded-full bg-primary/10" />
        <span className="animate-coach-pulse absolute h-24 w-24 rounded-full bg-primary/15 [animation-delay:0.6s]" />
        <span className="animate-breathe relative grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="h-7 w-7" />
        </span>
      </div>

      <div className="space-y-2.5">
        <h1 className="font-display text-xl font-semibold tracking-tight">
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
