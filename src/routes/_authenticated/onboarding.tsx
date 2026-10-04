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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DictateButton } from "@/components/dictate-button";
import { DictationField, DictationWave } from "@/components/dictation-field";
import { RegionStep } from "@/components/region-step";
import { ageFromDOB } from "@/lib/age";
import { localISODate } from "@/lib/dates";
import { fetchProfile, hasProfileColumn, saveProfile, todayISO } from "@/lib/daily";
import { deriveGoalType } from "@/lib/goal";
import { parseOnboarding } from "@/lib/onboarding.functions";
import {
  BIO_Q,
  buildFlat,
  chipKey,
  chipsOfAnswer,
  displayQuestion,
  errorKey,
  type FlatNode,
  formatDatePretty,
  GAP_TYPE,
  gapHelpKey,
  gapLabelKey,
  hintKey,
  KEY_FIELDS,
  MEALS_TO_PLAN_Q,
  mealSlotsFromAnswer,
  NUMBERS_Q,
  nutritionNumbersFromAnswer,
  parseBiometrics,
  parseDatePretty,
  PARTNER_APP_Q,
  partnerUsesApp,
  type GapKey,
  type Question,
  questionKey,
  SCREENS,
  screenSubtitleKey,
  screenTitleKey,
} from "@/lib/onboarding-script";
import { useCurrencySymbol } from "@/lib/use-money";
import { resolveDeviceTimeZone } from "@/lib/zoned-date";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

// Fechas locales: `toISOString()` es la de UTC, y por la noche en América ya es mañana.
const DOB_MAX = localISODate(new Date());
const DOB_MIN = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 110);
  return localISODate(d);
})();

type Draft = Awaited<ReturnType<typeof parseOnboarding>>;

// El guion (preguntas, chips, follow-ups, validaciones) vive en
// `lib/onboarding-script.ts` y su texto en el catálogo (`onboarding.*`): aquí
// solo queda la pantalla. El rediseño (proyecto de Claude Design "Onboarding
// Peppers", artboard 1b) es un recorrido navegable: se puede saltar a cualquier
// pregunta, corregir cualquier respuesta y aparcar preguntas.

// v2: el recorte de preguntas (issue 06) desplaza las claves posicionales `si-qi`,
// así que un borrador guardado con el guion anterior restauraría respuestas en la
// pregunta equivocada. Subir la versión descarta esos borradores a medias.
// v3: la pregunta de ver cifras (ticket 01 de `precision-nutricional`) entra en
// "Hacia dónde vamos" y desplaza las de detrás.
const DRAFT_STORAGE_KEY = "peppers-onboarding-progress-v3";

type View = "chat" | "index" | "resumen" | "saved";

function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const parse = useServerFn(parseOnboarding);
  const { t } = useTranslation();
  const currency = useCurrencySymbol();

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

  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  const [gapMissing, setGapMissing] = useState<GapKey[]>([]);
  const [reviewDraft, setReviewDraft] = useState<Draft | null>(null);
  // Fecha de nacimiento en ISO (YYYY-MM-DD), capturada directamente del selector
  // de fecha: no dependemos de que la IA la extraiga bien del texto.
  const [dob, setDob] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const hydrated = useRef(false);

  const numbersQuestion = hasProfileColumn(profileQ.data, "nutrition_numbers");
  const flat = useMemo(() => buildFlat(answers, numbersQuestion), [answers, numbersQuestion]);
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
    if (!hydrated.current) return;
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ answers, skipped, curKey, dob, introDismissed }),
      );
    } catch {
      /* almacenamiento lleno o bloqueado: no es crítico */
    }
  }, [answers, skipped, curKey, dob, introDismissed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    if (view === "chat" && !saving && !stageEnd) inputRef.current?.focus();
  }, [flat, curKey, view, saving, stageEnd]);

  // Si la pareja no va a usar la app, no hay quien más registre su parte del
  // gasto: pedimos el presupuesto total de la casa en vez del personal.
  const partnerNode = flat.find((n) => n.q === PARTNER_APP_Q);
  const partnerAnswer = partnerNode ? answers[partnerNode.key] : undefined;
  const partnerHasApp = partnerUsesApp(partnerAnswer);

  // La pregunta tal como se enseña (la de presupuesto cambia si la pareja no
  // usa la app) y su texto en el idioma de la persona.
  const displayQ = (node: FlatNode): Question => displayQuestion(node.q, partnerHasApp);
  const qText = (node: FlatNode) => t(questionKey(displayQ(node)), { currency });
  const qHint = (q: Question) => {
    const key = hintKey(q);
    return key ? t(key, { currency }) : null;
  };
  const chipLabel = (q: Question, chip: string) => (q.literalChips ? chip : t(chipKey(q, chip)));

  const answeredNodes = flat.filter((n) => answers[n.key] !== undefined);
  const answeredCount = answeredNodes.length;
  const total = flat.length;
  const remaining = total - answeredCount;
  const allAnswered = flat.every((n) => answers[n.key] !== undefined || n.q.optional === true);
  const requiredPending = flat.filter((n) => answers[n.key] === undefined && n.q.optional !== true);

  const chipsForAnswer = (node: FlatNode, text: string) => new Set(chipsOfAnswer(node.q, text));

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
    const nextFlat = buildFlat(nextAnswers, numbersQuestion);
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
      setError(t(errorKey(problem)));
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
      setValue(chipLabel(cur.q, c));
      inputRef.current?.focus();
      return;
    }
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      const ordered = cur.q.chips?.filter((chip) => next.has(chip)) ?? [];
      setValue(ordered.map((chip) => chipLabel(cur.q, chip)).join(", "));
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

  // Lo que lee `parseOnboarding`. Las marcas "Coach"/"Persona" y el "nada que
  // destacar" son material del prompt, no interfaz: se quedan en español.
  const transcriptFromAnswers = (map: Record<string, string>) =>
    buildFlat(map, numbersQuestion)
      .map((n) => {
        if (map[n.key] !== undefined) return `Coach: ${qText(n)}\nPersona: ${map[n.key]}`;
        if (n.q.optional) return `Coach: ${qText(n)}\nPersona: Nada que destacar`;
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
      toast.error(err instanceof Error ? err.message : t("onboarding.errors.reviewFailed"));
    }
    setSaving(false);
  };

  const saveAll = async (draft: Draft, extra: Partial<Draft>) => {
    setSaving(true);
    const d = { ...draft, ...extra };
    // La clave en `answers` es posicional ("2-5"), así que se busca el nodo
    // por identidad del objeto Question en vez de asumir una posición fija.
    const flatNow = buildFlat(answers, numbersQuestion);
    const mealsKey = flatNow.find((n) => n.q === MEALS_TO_PLAN_Q)?.key;
    const meal_slots = mealSlotsFromAnswer(mealsKey ? answers[mealsKey] : undefined);
    // Del chip al valor, sin pasar por la IA (mismo motivo que `meal_slots`).
    const numbersKey = flatNow.find((n) => n.q === NUMBERS_Q)?.key;
    const nutrition_numbers = numbersKey
      ? nutritionNumbersFromAnswer(answers[numbersKey])
      : undefined;
    try {
      const existing = await fetchProfile();
      await saveProfile({
        app_started_on: existing?.app_started_on ?? todayISO(),
        meal_slots,
        ...(nutrition_numbers ? { nutrition_numbers } : {}),
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
        // Ticket 07: día a día y rutina por separado (se ignoran sin la migración).
        ...(d.daily_activity ? { daily_activity: d.daily_activity } : {}),
        ...(d.training ? { training: d.training } : {}),
        meals_per_day: d.meals_per_day,
        diet_pattern: d.diet_pattern,
        non_negotiable_foods: d.non_negotiable_foods,
        food_relationship: d.food_relationship,
        target_weight_kg: d.target_weight_kg,
        goal_type: deriveGoalType(d.current_weight_kg, d.target_weight_kg) ?? "mantener",
        goal_amount:
          d.target_weight_kg != null && d.current_weight_kg != null
            ? Math.abs(d.current_weight_kg - d.target_weight_kg)
            : null,
        goal_target_date: d.goal_target_date,
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

      // El plan no se genera aquí: un mes se genera una vez y tras la
      // conversación con el coach (`MonthIntakeChat` en Plan), también el
      // primero. La bienvenida del coach llega al generarlo.
      setSaving(false);
      navigate({ to: "/plan", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("onboarding.errors.saveFailed"));
      setSaving(false);
    }
  };

  const confirmAndSave = async () => {
    const extra: Partial<Draft> = {};
    for (const key of KEY_FIELDS) {
      const rawVal = (gapValues[key] ?? "").trim();
      if (!rawVal) {
        setError(t("onboarding.errors.gapRequired", { field: t(gapLabelKey(key)).toLowerCase() }));
        return;
      }
      if (GAP_TYPE[key] === "number") {
        const n = Number(rawVal.replace(",", "."));
        const ok = key === "current_weight_kg" ? n >= 25 && n <= 350 : n >= 100 && n <= 250;
        if (!ok) {
          setError(
            t(
              key === "current_weight_kg"
                ? "onboarding.errors.weightRange"
                : "onboarding.errors.heightRange",
            ),
          );
          return;
        }
        (extra as Record<string, unknown>)[key] = n;
      } else {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawVal)) {
          setError(t("onboarding.errors.timeFormat", { field: t(gapLabelKey(key)) }));
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
      toast.error(t("onboarding.errors.rereadFailed"));
    }
    if (!draft) {
      setSaving(false);
      setError(t("onboarding.errors.profileFailed"));
      return;
    }
    setView("chat");
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
          <Sparkles className="mx-auto h-10 w-10 text-primary-ink" aria-hidden />
          <h1 className="font-title text-2xl font-semibold tracking-tight text-foreground">
            {t("onboarding.intro.title")}
          </h1>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.intro.body", { count: total })}
          </p>
          <button
            type="button"
            onClick={() => setIntroDismissed(true)}
            className="mx-auto flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {t("onboarding.intro.start")} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
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
        <OverlayHeader
          eyebrow={t("onboarding.index.eyebrow")}
          title={t("onboarding.index.title")}
          closeLabel={t("onboarding.chat.close")}
          onClose={closeToChat}
        />
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          {t("onboarding.index.body")}
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
                key={s.id}
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
                    {t(screenTitleKey(s))}
                  </span>
                  <span className="font-num text-[10.5px] text-muted-foreground">
                    {t(screenSubtitleKey(s)).toLowerCase()} · {doneN}/{nodes.length}
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
          {t("onboarding.index.seeSummary")} <ArrowRight className="h-4 w-4" />
        </button>
      </Shell>
    );
  }

  if (view === "resumen") {
    const pending = flat.filter((n) => skipped[n.key]);
    const sections = SCREENS.map((s, si) => ({
      id: s.id,
      title: t(screenTitleKey(s)),
      items: flat.filter((n) => n.si === si && answers[n.key] !== undefined),
    })).filter((s) => s.items.length);
    const emptyResumen = pending.length === 0 && sections.length === 0;
    const canConfirm = allAnswered;

    return (
      <Shell>
        <OverlayHeader
          eyebrow={t("onboarding.summary.eyebrow", { done: answeredCount, total })}
          title={t("onboarding.summary.title")}
          closeLabel={t("onboarding.chat.close")}
          onClose={closeToChat}
        />
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          {t("onboarding.summary.body")}
        </p>

        <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
          {canConfirm ? (
            <section className="space-y-3 rounded-3xl bg-surface p-4">
              <p className="text-sm font-medium">{t("onboarding.summary.keyData")}</p>
              {KEY_FIELDS.map((key) => (
                <label key={key} className="block text-xs text-muted-foreground">
                  {t(gapLabelKey(key))}
                  {gapMissing.includes(key) ? (
                    <span className="ml-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-ink">
                      {t("onboarding.summary.missing")}
                    </span>
                  ) : null}
                  <input
                    type={GAP_TYPE[key] === "time" ? "time" : "text"}
                    inputMode={GAP_TYPE[key] === "number" ? "decimal" : undefined}
                    value={gapValues[key] ?? ""}
                    onChange={(e) => setGapValues((v) => ({ ...v, [key]: e.target.value }))}
                    className="mt-1 h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                  />
                  <span className="mt-1 block text-[11px]">{t(gapHelpKey(key))}</span>
                </label>
              ))}
            </section>
          ) : null}

          {pending.length ? (
            <section className="space-y-2.5 rounded-3xl bg-primary-soft p-4">
              <p className="text-[13px] font-semibold text-foreground">
                {t("onboarding.summary.pending", { count: pending.length })}
              </p>
              {pending.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => goTo(n.key)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left"
                >
                  <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {qText(n)}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-primary-ink">
                    {t("onboarding.summary.answer")}
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {sections.map((s) => (
            <section key={s.id} className="space-y-2">
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
                    {qText(n)}
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
              {t("onboarding.summary.empty")}
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
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-ink" />{" "}
            {t("onboarding.summary.remaining", { count: requiredPending.length })}
          </p>
        ) : null}

        <button
          type="button"
          disabled={saving}
          onClick={() => (canConfirm ? void confirmAndSave() : closeToChat())}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {t(
            saving
              ? "onboarding.summary.saving"
              : canConfirm
                ? "onboarding.summary.confirm"
                : "onboarding.summary.backToChat",
          )}
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
            <span className="relative grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary-ink">
              <Check className="h-6 w-6" strokeWidth={2.6} />
            </span>
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {t("onboarding.saved.title")}
          </h1>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.saved.body", { done: answeredCount, total })}
          </p>
          <div className="flex w-full max-w-xs flex-col gap-2.5">
            <button
              type="button"
              onClick={closeToChat}
              className="rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              {t("onboarding.saved.continue")}
            </button>
            <button
              type="button"
              onClick={() => void openResumen()}
              className="rounded-full bg-surface py-4 text-sm font-semibold text-muted-foreground transition-transform active:scale-[0.98]"
            >
              {t("onboarding.saved.review")}
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
          aria-label={t("onboarding.chat.back")}
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
              {t("onboarding.chat.stage", { n: cur.si + 1, total: SCREENS.length })}
            </span>
            <span className="truncate text-[13.5px] font-semibold tracking-tight">
              {t(screenTitleKey(stage))}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => setView("saved")}
          aria-label={t("onboarding.chat.saveAndExit")}
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
          {t("onboarding.chat.question", { n: Math.max(1, curIndex + 1), total })}
        </p>
        <p className="font-num text-[11px] text-muted-foreground">
          {t("onboarding.chat.left", { count: remaining })}
        </p>
      </div>

      <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {visibleTurns.map((n) => (
          <div key={n.key} className="space-y-3">
            <div className="animate-rise flex justify-start">
              <p className="max-w-[85%] rounded-3xl bg-surface px-4 py-3 text-sm leading-relaxed text-foreground">
                {qText(n)}
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
                  {t("onboarding.chat.skipped")}
                </button>
              </div>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error ? (
        <div className="animate-rise mb-2 flex items-start gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-ink" />
          <span>{error}</span>
        </div>
      ) : null}

      {stageEnd ? (
        <div className="animate-rise space-y-3.5 rounded-3xl bg-surface p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.chat.stageDone")}{" "}
            <span className="font-medium text-foreground">
              {t(screenSubtitleKey(stage)).toLowerCase()}
            </span>
            .{" "}
            {isLastStage
              ? t("onboarding.chat.lastStage")
              : t("onboarding.chat.nextStage", {
                  stage: t(screenSubtitleKey(SCREENS[cur.si + 1])).toLowerCase(),
                })}
          </p>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={back}
              className="flex items-center justify-center gap-1.5 rounded-full bg-secondary px-4 py-3 text-[13.5px] font-semibold text-muted-foreground transition-transform active:scale-95"
            >
              <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
              {t("onboarding.chat.review")}
            </button>
            <button
              type="button"
              onClick={advanceStage}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              {t(isLastStage ? "onboarding.index.seeSummary" : "onboarding.chat.continue")}
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
                    {chipLabel(currentQ, c)}
                  </button>
                );
              })}
            </div>
          ) : null}

          <DictationField>
            <div className="rounded-3xl bg-surface p-2 focus-within:ring-2 focus-within:ring-ring/40">
              <div className="relative rounded-2xl">
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
                    aria-label={t("onboarding.chat.answerLabel")}
                    placeholder={
                      saving
                        ? t("onboarding.chat.placeholderSaving")
                        : (qHint(currentQ) ?? t("onboarding.chat.placeholder"))
                    }
                    className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
                  />
                )}
                <DictationWave />
              </div>
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1">
                  {currentQ.dateInput ? null : (
                    <DictateButton
                      onText={(t) => setValue((v) => (v ? `${v.trim()} ${t}` : t))}
                      label={t("onboarding.chat.dictate")}
                    />
                  )}
                  <button
                    type="button"
                    onClick={skipCurrent}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    <SkipForward className="h-3.5 w-3.5" /> {t("onboarding.chat.skip")}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={saving || !value.trim()}
                  aria-label={t("onboarding.chat.send")}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </DictationField>
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
  closeLabel,
  onClose,
}: {
  eyebrow: string;
  title: string;
  closeLabel: string;
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
        aria-label={closeLabel}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-transform active:scale-95"
      >
        <X className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}
