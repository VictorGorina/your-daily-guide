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
import { useTranslation } from "react-i18next";
import {
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
import { DictationField, DictationWave } from "../../components/dictation-field";
import { RegionStep } from "../../components/region-step";
import { apiPost } from "../../lib/api";
import { ageFromDOB } from "../../lib/age";
import { deriveGoalType, fetchProfile, saveProfile, todayISO } from "../../lib/daily";
import type { OnboardingDraft } from "../../lib/onboarding";
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
} from "../../lib/onboarding-script";
import { useCurrencySymbol } from "../../lib/use-money";
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
 *
 * El guion (preguntas, chips, follow-ups, validaciones) vive en
 * `lib/onboarding-script.ts` y su texto en el catálogo (`onboarding.*`).
 */

type Draft = OnboardingDraft;

// v2: el recorte de preguntas (issue 06) desplaza las claves posicionales `si-qi`,
// así que un borrador guardado con el guion anterior restauraría respuestas en la
// pregunta equivocada. Subir la versión descarta esos borradores a medias.
// v3: la pregunta de ver cifras (ticket 01 de `precision-nutricional`) entra en
// "Hacia dónde vamos" y desplaza las de detrás.
// v4: "Hacia dónde vamos" pasa al peso objetivo (como la web) y la pregunta de
// sugerencias de comportamiento sale de "Cómo te acompaño": cambian las claves de
// las dos pantallas.
const DRAFT_STORAGE_KEY = "peppers-onboarding-progress-v4";

type Panel = "chat" | "index" | "resumen" | "saved";

// Colores de icono (RN no entiende currentColor): el tema móvil es monocolor
// naranja, ver tailwind.config.js.
// Contraste AA (ticket 33): el naranja como icono es el tostado (primary-ink)
// y lo que va SOBRE el naranja, oscuro; sobre verde u oscuro sigue claro.
const C = {
  primary: "#a84a17",
  onPrimary: "#3e3d39",
  onDark: "#fbfaf7",
  fg: "#3e3d39",
  muted: "#6b6256",
  success: "#4cae64",
  danger: "#b8433b",
};

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const currency = useCurrencySymbol();

  const parse = (transcript: string) => apiPost<Draft>("onboarding/parse", { transcript });

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
    if (!hydrated) return;
    AsyncStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ answers, skipped, curKey, dob, introDismissed }),
    ).catch(() => {
      /* almacenamiento bloqueado: no es crítico */
    });
  }, [answers, skipped, curKey, dob, introDismissed, hydrated]);

  // --- Derivados ---------------------------------------------------------------

  const partnerNode = flat.find((n) => n.q === PARTNER_APP_Q);
  const partnerAnswer = partnerNode ? answers[partnerNode.key] : undefined;
  const partnerHasApp = partnerUsesApp(partnerAnswer);

  // La pregunta tal como se enseña (la de presupuesto cambia si la pareja no
  // usa la app) y su texto en el idioma de la persona.
  const displayQ = (node: FlatNode): Question => displayQuestion(node.q, partnerHasApp);
  const qText = (node: FlatNode) => t(questionKey(displayQ(node)), { currency });
  const qHint = (q: Question) => {
    const key = hintKey(q, true);
    return key ? t(key, { currency }) : null;
  };
  const chipLabel = (q: Question, chip: string) => (q.literalChips ? chip : t(chipKey(q, chip)));

  const answeredCount = flat.filter((n) => answers[n.key] !== undefined).length;
  const total = flat.length;
  const remaining = total - answeredCount;
  const allAnswered = flat.every((n) => answers[n.key] !== undefined || n.q.optional === true);
  const requiredPending = flat.filter((n) => answers[n.key] === undefined && n.q.optional !== true);

  const chipsForAnswer = (node: FlatNode, text: string) => new Set(chipsOfAnswer(node.q, text));

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
        setError(t(errorKey(problem, true)));
        return;
      }
      setDob(iso);
      stored = formatDatePretty(iso);
    } else {
      const problem = q.validate?.(text);
      if (problem) {
        setError(t(errorKey(problem, true)));
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
      setValue(chipLabel(cur.q, c));
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

  // Lo que lee `parseOnboarding`. Las marcas "Coach"/"Persona" y el "nada que
  // destacar" son material del prompt, no interfaz: se quedan en español.
  const transcriptFromAnswers = (map: Record<string, string>) =>
    buildFlat(map)
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
      Alert.alert(err instanceof Error ? err.message : t("onboarding.errors.reviewFailed"));
    }
    setSaving(false);
  };

  const saveAll = async (draft: Draft, extra: Partial<Draft>) => {
    setSaving(true);
    const d = { ...draft, ...extra };
    // La clave en `answers` es posicional ("2-5"), así que se busca el nodo
    // por identidad del objeto Question en vez de asumir una posición fija.
    const flatNow = buildFlat(answers);
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
      AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});

      // El plan no se genera aquí: un mes se genera una vez y tras la
      // conversación con el coach (`MonthIntakeChat` en Plan), también el
      // primero. La bienvenida del coach llega al generarlo.
      setSaving(false);
      router.replace("/plan");
    } catch (err) {
      Alert.alert(err instanceof Error ? err.message : t("onboarding.errors.saveFailed"));
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
      Alert.alert(t("onboarding.errors.rereadFailed"));
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
            {t("onboarding.intro.title")}
          </Text>
          <Text className="mt-4 max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.intro.body", { count: total })}
          </Text>
          <Pressable
            onPress={() => setIntroDismissed(true)}
            className="mt-8 flex-row items-center gap-2 rounded-full bg-primary px-8 py-3.5 active:opacity-90"
          >
            <Text className="text-sm font-sans-semibold text-primary-foreground">
              {t("onboarding.intro.start")}
            </Text>
            <ArrowRight size={16} color={C.onPrimary} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // --- Overlay: índice ---
  if (view === "index") {
    return (
      <Shell>
        <OverlayHeader
          eyebrow={t("onboarding.index.eyebrow")}
          title={t("onboarding.index.title")}
          closeLabel={t("onboarding.chat.close")}
          onClose={closeToChat}
        />
        <Text className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          {t("onboarding.index.body")}
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
                key={s.id}
                onPress={() => first && goTo(first.key)}
                className="flex-row items-center gap-3.5 rounded-2xl bg-surface p-4 active:opacity-90"
              >
                <View
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    complete ? "bg-success" : isCur ? "bg-primary" : "bg-secondary"
                  }`}
                >
                  {complete ? (
                    <Check size={16} color={C.onDark} />
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
                    {t(screenTitleKey(s))}
                  </Text>
                  <Text className="font-mono text-[10.5px] text-muted-foreground">
                    {t(screenSubtitleKey(s)).toLowerCase()} · {doneN}/{nodes.length}
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
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {t("onboarding.index.seeSummary")}
          </Text>
          <ArrowRight size={16} color={C.onPrimary} />
        </Pressable>
      </Shell>
    );
  }

  // --- Overlay: resumen ---
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
        <Text className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          {t("onboarding.summary.body")}
        </Text>

        <ScrollView className="mt-4 flex-1" contentContainerClassName="gap-5 pb-2">
          {canConfirm ? (
            <View className="gap-3 rounded-3xl bg-surface p-4">
              <Text className="text-sm font-sans-medium text-foreground">
                {t("onboarding.summary.keyData")}
              </Text>
              {KEY_FIELDS.map((key) => (
                <View key={key}>
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-xs text-muted-foreground">{t(gapLabelKey(key))}</Text>
                    {gapMissing.includes(key) ? (
                      <View className="rounded-full bg-primary-soft px-2 py-0.5">
                        <Text className="text-[10px] font-sans-medium text-primary-ink">
                          {t("onboarding.summary.missing")}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <TextInput
                    value={gapValues[key] ?? ""}
                    onChangeText={(t) => setGapValues((v) => ({ ...v, [key]: t }))}
                    keyboardType={GAP_TYPE[key] === "number" ? "decimal-pad" : "default"}
                    placeholder={GAP_TYPE[key] === "time" ? "HH:MM" : ""}
                    placeholderTextColor={C.muted}
                    className="mt-1 h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                  />
                  <Text className="mt-1 text-[11px] text-muted-foreground">
                    {t(gapHelpKey(key))}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {pending.length ? (
            <View className="gap-2.5 rounded-3xl bg-primary-soft p-4">
              <Text className="text-[13px] font-sans-semibold text-foreground">
                {t("onboarding.summary.pending", { count: pending.length })}
              </Text>
              {pending.map((n) => (
                <Pressable
                  key={n.key}
                  onPress={() => goTo(n.key)}
                  className="flex-row items-center gap-3 rounded-2xl bg-surface p-3.5 active:opacity-90"
                >
                  <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
                    {qText(n)}
                  </Text>
                  <Text className="text-xs font-sans-semibold text-primary-ink">
                    {t("onboarding.summary.answer")}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {sections.map((s) => (
            <View key={s.id} className="gap-2">
              <Text className="px-1 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {s.title}
              </Text>
              {s.items.map((n) => (
                <Pressable
                  key={n.key}
                  onPress={() => goTo(n.key)}
                  className="rounded-3xl bg-surface p-4 active:opacity-90"
                >
                  <Text className="text-xs leading-relaxed text-muted-foreground">{qText(n)}</Text>
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
              {t("onboarding.summary.empty")}
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
              {t("onboarding.summary.remaining", { count: requiredPending.length })}
            </Text>
          </View>
        ) : null}

        <Pressable
          disabled={saving}
          onPress={() => (canConfirm ? void confirmAndSave() : closeToChat())}
          className="flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-50"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {t(
              saving
                ? "onboarding.summary.saving"
                : canConfirm
                  ? "onboarding.summary.confirm"
                  : "onboarding.summary.backToChat",
            )}
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
          <Text className="font-display text-2xl text-foreground">
            {t("onboarding.saved.title")}
          </Text>
          <Text className="max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.saved.body", { done: answeredCount, total })}
          </Text>
          <View className="w-full max-w-[320px] gap-2.5">
            <Pressable
              onPress={closeToChat}
              className="items-center rounded-full bg-primary py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {t("onboarding.saved.continue")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void openResumen()}
              className="items-center rounded-full bg-surface py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-semibold text-muted-foreground">
                {t("onboarding.saved.review")}
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
              accessibilityLabel={t("onboarding.chat.back")}
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
                  {t("onboarding.chat.stage", { n: cur.si + 1, total: SCREENS.length })}
                </Text>
                <Text
                  className="text-[13.5px] font-sans-semibold text-foreground"
                  numberOfLines={1}
                >
                  {t(screenTitleKey(stage))}
                </Text>
              </View>
              <ChevronDown size={16} color={C.muted} />
            </Pressable>
            <Pressable
              onPress={() => setView("saved")}
              accessibilityLabel={t("onboarding.chat.saveAndExit")}
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
              {t("onboarding.chat.question", { n: Math.max(1, curIndex + 1), total })}
            </Text>
            <Text className="font-mono text-[11px] text-muted-foreground">
              {t("onboarding.chat.left", { count: remaining })}
            </Text>
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
                    <Text className="text-sm leading-relaxed text-foreground">{qText(n)}</Text>
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
                        {t("onboarding.chat.skipped")}
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
                {t("onboarding.chat.stageDone")}{" "}
                <Text className="font-sans-medium text-foreground">
                  {t(screenSubtitleKey(stage)).toLowerCase()}
                </Text>
                .{" "}
                {isLastStage
                  ? t("onboarding.chat.lastStage")
                  : t("onboarding.chat.nextStage", {
                      stage: t(screenSubtitleKey(SCREENS[cur.si + 1]!)).toLowerCase(),
                    })}
              </Text>
              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={back}
                  className="flex-row items-center justify-center gap-1.5 rounded-full bg-secondary px-4 py-3 active:opacity-80"
                >
                  <ArrowLeft size={15} color={C.muted} />
                  <Text className="text-[13.5px] font-sans-semibold text-muted-foreground">
                    {t("onboarding.chat.review")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={advanceStage}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3 active:opacity-90"
                >
                  <Text className="text-[13.5px] font-sans-semibold text-primary-foreground">
                    {t(isLastStage ? "onboarding.index.seeSummary" : "onboarding.chat.continue")}
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
                        {active ? <Check size={14} color={C.onDark} /> : null}
                        <Text
                          className={`text-[13.5px] ${
                            active
                              ? "font-sans-semibold text-background"
                              : "font-sans-medium text-foreground"
                          }`}
                        >
                          {chipLabel(currentQ, c)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <DictationField>
                <View className="rounded-3xl bg-surface p-2">
                  <View className="relative">
                    <TextInput
                      editable={!saving}
                      value={value}
                      onChangeText={setValue}
                      multiline={!currentQ.dateInput}
                      keyboardType={currentQ.dateInput ? "numbers-and-punctuation" : "default"}
                      onSubmitEditing={currentQ.dateInput ? () => commit(value) : undefined}
                      placeholder={
                        saving
                          ? t("onboarding.chat.placeholderSaving")
                          : currentQ.dateInput
                            ? t("onboarding.chat.datePlaceholder")
                            : (qHint(currentQ) ?? t("onboarding.chat.placeholder"))
                      }
                      placeholderTextColor={C.muted}
                      className="min-h-[44px] px-2 py-2 text-sm text-foreground"
                      textAlignVertical="top"
                    />
                    <DictationWave />
                  </View>
                  <View className="flex-row items-center justify-between px-1">
                    <Pressable
                      onPress={skipCurrent}
                      disabled={saving}
                      className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1.5 active:opacity-70"
                    >
                      <SkipForward size={14} color={C.muted} />
                      <Text className="text-xs font-sans-medium text-muted-foreground">
                        {t("onboarding.chat.skip")}
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
                        accessibilityLabel={t("onboarding.chat.send")}
                        className={`h-11 w-11 items-center justify-center rounded-full bg-primary ${
                          saving || !value.trim() ? "opacity-40" : ""
                        }`}
                      >
                        <Send size={16} color={C.onPrimary} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </DictationField>
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
  closeLabel,
  onClose,
}: {
  eyebrow: string;
  title: string;
  closeLabel: string;
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
        accessibilityLabel={closeLabel}
        className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80"
      >
        <X size={18} color={C.fg} />
      </Pressable>
    </View>
  );
}
