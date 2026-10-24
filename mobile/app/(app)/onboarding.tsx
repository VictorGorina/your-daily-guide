import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { HealthConsentStep } from "../../components/health-consent";
import { ChatPanel } from "../../components/onboarding/chat-panel";
import { IntroStep } from "../../components/onboarding/intro-step";
import { SavedPanel } from "../../components/onboarding/saved-panel";
import { StageIndex } from "../../components/onboarding/stage-index";
import { SummaryPanel } from "../../components/onboarding/summary-panel";
import { RegionStep } from "../../components/region-step";
import { apiPost } from "../../lib/api";
import { ageFromDOB } from "../../lib/age";
import { deriveGoalType, fetchProfile, saveProfile, todayISO, type Profile } from "../../lib/daily";
import { hasHealthConsent, withoutHealthData } from "../../lib/health-consent";
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
  withoutHealthAnswers,
} from "../../lib/onboarding-script";
import { useOnboardingDraft } from "../../lib/use-onboarding-draft";
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
 *
 * La pantalla lleva el recorrido (navegación, validación y guardado); el
 * progreso guardado vive en `useOnboardingDraft` y lo que se pinta, en
 * `components/onboarding/`.
 */

type Draft = OnboardingDraft;

type Panel = "chat" | "index" | "resumen" | "saved";

export default function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const currency = useCurrencySymbol();

  const parse = (transcript: string) => apiPost<Draft>("onboarding/parse", { transcript });

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const [regionDone, setRegionDone] = useState(false);

  const {
    answers,
    setAnswers,
    skipped,
    setSkipped,
    curKey,
    setCurKey,
    dob,
    setDob,
    introDismissed,
    setIntroDismissed,
    healthDeclined,
    setHealthDeclined,
    hydrated,
    clearDraft,
  } = useOnboardingDraft();
  const [view, setView] = useState<Panel>("chat");
  const [stageEnd, setStageEnd] = useState(false);

  const [value, setValue] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  const [gapMissing, setGapMissing] = useState<GapKey[]>([]);
  const [reviewDraft, setReviewDraft] = useState<Draft | null>(null);

  // Las preguntas de salud, solo con consentimiento (ticket 30). Se decide en
  // el paso de después de la portada; sin decidir, no se pinta el chat.
  const healthConsent = hasHealthConsent(profileQ.data);
  const flatOpts = useMemo(() => ({ health: healthConsent }), [healthConsent]);
  const flat = useMemo(() => buildFlat(answers, flatOpts), [answers, flatOpts]);
  const curIndex = flat.findIndex((n) => n.key === curKey);
  const cur = curIndex >= 0 ? flat[curIndex]! : flat[0]!;

  useEffect(() => {
    if (curIndex < 0 && flat.length) setCurKey(flat[0]!.key);
  }, [curIndex, flat, setCurKey]);

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
    const nextFlat = buildFlat(nextAnswers, flatOpts);
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
    buildFlat(map, flatOpts)
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
    const flatNow = buildFlat(answers, flatOpts);
    const mealsKey = flatNow.find((n) => n.q === MEALS_TO_PLAN_Q)?.key;
    const meal_slots = mealSlotsFromAnswer(mealsKey ? answers[mealsKey] : undefined);
    // Del chip al valor, sin pasar por la IA (mismo motivo que `meal_slots`).
    const numbersKey = flatNow.find((n) => n.q === NUMBERS_Q)?.key;
    const nutrition_numbers = numbersKey
      ? nutritionNumbersFromAnswer(answers[numbersKey])
      : undefined;
    try {
      const existing = await fetchProfile();
      const patch: Partial<Profile> = {
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
      };
      // Sin consentimiento, nada de salud: tampoco lo que la IA haya deducido
      // de otras respuestas (ticket 30).
      await saveProfile(hasHealthConsent(existing) ? patch : withoutHealthData(patch));

      await qc.invalidateQueries({ queryKey: ["profile"] });
      await qc.refetchQueries({ queryKey: ["profile"] });
      qc.removeQueries({ queryKey: ["today"] });
      qc.removeQueries({ queryKey: ["logs"] });
      clearDraft();

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
    // Cuántas preguntas son, con las de salud salvo que ya las haya rechazado.
    const intro = buildFlat(answers, { health: !healthDeclined }).length;
    return <IntroStep total={intro} onStart={() => setIntroDismissed(true)} />;
  }

  if (!healthConsent && !healthDeclined) {
    return (
      // Aceptar guarda el consentimiento en el perfil, y al releerlo salen las
      // preguntas de salud.
      <HealthConsentStep
        onDeclined={() => {
          setAnswers((a) => withoutHealthAnswers(a));
          setHealthDeclined(true);
        }}
      />
    );
  }

  if (view === "index") {
    return (
      <StageIndex
        flat={flat}
        answers={answers}
        currentStage={cur.si}
        onClose={closeToChat}
        onGoTo={goTo}
        onSummary={() => void openResumen()}
      />
    );
  }

  if (view === "resumen") {
    return (
      <SummaryPanel
        flat={flat}
        answers={answers}
        skipped={skipped}
        answeredCount={answeredCount}
        total={total}
        canConfirm={allAnswered}
        requiredPendingCount={requiredPending.length}
        gapMissing={gapMissing}
        gapValues={gapValues}
        onGapChange={(key, text) => setGapValues((v) => ({ ...v, [key]: text }))}
        qText={qText}
        error={error}
        saving={saving}
        onClose={closeToChat}
        onGoTo={goTo}
        onConfirm={() => void confirmAndSave()}
      />
    );
  }

  if (view === "saved") {
    return (
      <SavedPanel
        answeredCount={answeredCount}
        total={total}
        onContinue={closeToChat}
        onReview={() => void openResumen()}
      />
    );
  }

  return (
    <ChatPanel
      flat={flat}
      answers={answers}
      skipped={skipped}
      cur={cur}
      curIndex={curIndex}
      total={total}
      remaining={remaining}
      currentQ={displayQ(cur)}
      stageEnd={stageEnd}
      isLastStage={isLastStage}
      qText={qText}
      qHint={qHint}
      chipLabel={chipLabel}
      selectedChips={selectedChips}
      value={value}
      setValue={setValue}
      error={error}
      saving={saving}
      onBack={back}
      onOpenIndex={() => setView("index")}
      onSaveAndExit={() => setView("saved")}
      onGoTo={goTo}
      onAdvanceStage={advanceStage}
      onToggleChip={toggleChip}
      onCommit={commit}
      onSkip={skipCurrent}
    />
  );
}
