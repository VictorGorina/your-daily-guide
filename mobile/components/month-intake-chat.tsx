import { useMutation } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { DictateButton } from "./dictate-button";
import { DictationField, DictationWave } from "./dictation-field";
import { apiPost } from "../lib/api";
import { dateLocale } from "../lib/i18n";
import {
  AWAY_PRESETS,
  INTAKE_TEXT_QUESTIONS,
  intakeAnswerText,
  type AwayPreset,
  type IntakeAnswers,
  type IntakeTextAnswer,
  type IntakeTextQuestion,
} from "../lib/month-intake";
import { monthParts } from "../lib/plan-shared";

/** Paso 0: ausencia. 1..4: preguntas de texto. 5: resumen y generar. */
const LAST_STEP = INTAKE_TEXT_QUESTIONS.length + 1;

// Tolera cualquier separador y ambos órdenes (DD/MM/AAAA o AAAA-MM-DD) — no
// hay selector nativo de fecha instalado (mismo patrón que el onboarding).
const parseDatePretty = (pretty: string): string | null => {
  const parts = pretty.trim().split(/\D+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  const [y, mo, d] = a.length === 4 ? [a, b, c] : [c, b, a];
  if (y.length !== 4 || mo.length > 2 || d.length > 2) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

/** "2026-10-12" → "12 de octubre". */
const prettyDay = (iso: string, locale: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" });

/**
 * La conversación con el coach antes de generar el plan de un mes: cinco
 * preguntas (`lib/month-intake.ts`). Réplica de
 * `src/components/month-intake-chat.tsx` (web). Un mes se genera una sola vez,
 * así que esto es lo que lo personaliza: al final guarda las respuestas
 * (`/api/v1/plan/constraints`) y llama a `onGenerate`.
 */
export function MonthIntakeChat({
  month,
  generating,
  onGenerate,
  onCancel,
  onAdvance,
}: {
  month: string;
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  /** Tras cada paso: quien la pinta baja su ScrollView hasta la pregunta nueva. */
  onAdvance?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const monthName = monthParts(month, locale).monthName;
  const [step, setStepState] = useState(0);
  const setStep = (next: number) => {
    setStepState(next);
    onAdvance?.();
  };
  const [preset, setPreset] = useState<AwayPreset | null>(null);
  const [awayStartText, setAwayStartText] = useState("");
  const [awayEndText, setAwayEndText] = useState("");
  const [answers, setAnswers] = useState<IntakeAnswers>({});

  const awayStart = parseDatePretty(awayStartText);
  const awayEnd = parseDatePretty(awayEndText);
  const hasRange = preset != null && preset !== "no";
  const rangeOk =
    !!awayStart &&
    !!awayEnd &&
    awayStart <= awayEnd &&
    awayStart.startsWith(month) &&
    awayEnd.startsWith(month);

  const submit = useMutation({
    mutationFn: () =>
      apiPost("plan/constraints", {
        month,
        awayStart: hasRange ? awayStart : null,
        awayEnd: hasRange ? awayEnd : null,
        answers,
      }),
    onSuccess: onGenerate,
    onError: (e) => Alert.alert(e instanceof Error ? e.message : t("monthIntake.saveError")),
  });
  const busy = submit.isPending || generating;

  const nextFromAway = () => {
    if (hasRange && !rangeOk) {
      Alert.alert(
        t("monthIntake.away.checkTitle"),
        t("monthIntake.away.checkBody", { month: monthName }),
      );
      return;
    }
    setStep(1);
  };

  const awayText =
    preset === "no"
      ? t("monthIntake.away.chips.no")
      : preset && awayStart && awayEnd
        ? t("monthIntake.away.range", {
            preset: t(`monthIntake.away.chips.${preset}`),
            from: prettyDay(awayStart, locale),
            to: prettyDay(awayEnd, locale),
          })
        : "";

  // El chip se guarda en español canónico (el servidor solo acepta los de su
  // lista) y se pinta en el idioma de la persona, por su posición en la lista.
  const chipLabel = (q: IntakeTextQuestion, chip: string) => {
    const index = q.chips.indexOf(chip);
    return index < 0 ? chip : t(`monthIntake.q.${q.key}.chips.${index}`);
  };

  const setAnswer = (key: keyof IntakeAnswers, patch: Partial<IntakeTextAnswer>) =>
    setAnswers((prev) => {
      const current = prev[key] ?? { chip: null, text: "" };
      return { ...prev, [key]: { ...current, ...patch } };
    });

  return (
    <View className="mt-8 gap-5 rounded-3xl bg-surface p-6">
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-primary-soft">
          <Sparkles size={16} color="#a84a17" />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-sans-semibold text-foreground">
            {t("monthIntake.title", { month: monthName })}
          </Text>
          <Text className="text-xs text-muted-foreground">{t("monthIntake.subtitle")}</Text>
        </View>
      </View>

      <CoachLine>{t("monthIntake.away.ask", { month: monthName })}</CoachLine>
      {step === 0 ? (
        <View className="gap-3">
          <Chips
            options={AWAY_PRESETS.map((key) => ({
              value: key,
              label: t(`monthIntake.away.chips.${key}`),
            }))}
            value={preset}
            disabled={busy}
            onPick={setPreset}
          />
          {hasRange ? (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={awayStartText}
                onChangeText={setAwayStartText}
                keyboardType="numbers-and-punctuation"
                placeholder={t("monthIntake.away.fromPlaceholder")}
                placeholderTextColor="#6b6256"
                className="min-h-[44px] flex-1 rounded-xl bg-muted px-3 text-sm text-foreground"
              />
              <Text className="text-sm text-muted-foreground">{t("monthIntake.away.sep")}</Text>
              <TextInput
                value={awayEndText}
                onChangeText={setAwayEndText}
                keyboardType="numbers-and-punctuation"
                placeholder={t("monthIntake.away.toPlaceholder")}
                placeholderTextColor="#6b6256"
                className="min-h-[44px] flex-1 rounded-xl bg-muted px-3 text-sm text-foreground"
              />
            </View>
          ) : null}
          <StepButtons onNext={nextFromAway} nextDisabled={preset == null} />
        </View>
      ) : (
        <UserLine>{awayText}</UserLine>
      )}

      {INTAKE_TEXT_QUESTIONS.map((q, i) => {
        const qStep = i + 1;
        if (step < qStep) return null;
        const answer = answers[q.key];
        return (
          <View key={q.key} className="gap-3">
            <CoachLine>{t(`monthIntake.q.${q.key}.ask`)}</CoachLine>
            {step === qStep ? (
              <>
                <Chips
                  options={q.chips.map((chip) => ({ value: chip, label: chipLabel(q, chip) }))}
                  value={answer?.chip ?? null}
                  disabled={busy}
                  onPick={(chip) => setAnswer(q.key, { chip: answer?.chip === chip ? null : chip })}
                />
                <DictationField>
                  <View className="rounded-3xl bg-muted p-2">
                    <View className="relative">
                      <TextInput
                        value={answer?.text ?? ""}
                        onChangeText={(text) => setAnswer(q.key, { text })}
                        multiline
                        maxLength={200}
                        placeholder={t(`monthIntake.q.${q.key}.placeholder`)}
                        placeholderTextColor="#6b6256"
                        className="min-h-[44px] px-2 py-2 text-sm text-foreground"
                        textAlignVertical="top"
                      />
                      <DictationWave className="bg-muted" />
                    </View>
                    <View className="flex-row items-center px-1">
                      <DictateButton
                        onText={(spoken) =>
                          setAnswer(q.key, {
                            text: answer?.text?.trim() ? `${answer.text.trim()} ${spoken}` : spoken,
                          })
                        }
                      />
                    </View>
                  </View>
                </DictationField>
                <StepButtons onBack={() => setStep(qStep - 1)} onNext={() => setStep(qStep + 1)} />
              </>
            ) : (
              <UserLine>
                {intakeAnswerText(answer, (chip) => chipLabel(q, chip)) ?? t("monthIntake.nothing")}
              </UserLine>
            )}
          </View>
        );
      })}

      {step === LAST_STEP ? (
        <View className="gap-3">
          <CoachLine>{t("monthIntake.ready", { month: monthName })}</CoachLine>
          <Pressable
            onPress={() => submit.mutate()}
            disabled={busy}
            className="w-full items-center rounded-full bg-primary py-4 active:opacity-90"
            style={busy ? { opacity: 0.6 } : undefined}
          >
            <Text className="text-sm font-sans-semibold text-primary-foreground">
              {busy ? t("plan.create.preparing") : t("monthIntake.generate", { month: monthName })}
            </Text>
          </Pressable>
          {!busy ? (
            <Pressable
              onPress={() => setStep(LAST_STEP - 1)}
              className="w-full items-center py-1 active:opacity-70"
            >
              <Text className="text-xs font-sans-medium text-muted-foreground">
                {t("monthIntake.change")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {step === 0 ? (
        <Pressable onPress={onCancel} className="w-full items-center py-1 active:opacity-70">
          <Text className="text-xs font-sans-medium text-muted-foreground">
            {t("monthIntake.notNow")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CoachLine({ children }: { children: React.ReactNode }) {
  return <Text className="text-sm leading-relaxed text-foreground">{children}</Text>;
}

function UserLine({ children }: { children: React.ReactNode }) {
  return (
    <View className="max-w-[85%] self-end rounded-2xl bg-secondary px-4 py-2.5">
      <Text className="text-sm text-foreground">{children}</Text>
    </View>
  );
}

function Chips<T extends string>({
  options,
  value,
  disabled,
  onPick,
}: {
  /** `value` es lo que se guarda; `label`, lo que se lee. */
  options: readonly { value: T; label: string }[];
  value: T | null;
  disabled?: boolean;
  onPick: (option: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onPick(option.value)}
            disabled={disabled}
            className={`min-h-[44px] flex-row items-center gap-1.5 rounded-full px-4 active:opacity-80 ${
              active ? "bg-foreground" : "bg-muted"
            }`}
          >
            {active ? <Check size={14} color="#fbfaf7" /> : null}
            <Text
              className={`text-[13.5px] ${
                active
                  ? "font-sans-semibold text-primary-foreground"
                  : "font-sans-medium text-foreground"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepButtons({
  onBack,
  onNext,
  nextDisabled,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row gap-2">
      {onBack ? (
        <Pressable onPress={onBack} className="rounded-full bg-muted px-5 py-3 active:opacity-80">
          <Text className="text-sm font-sans-medium text-foreground">{t("common.back")}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        className="flex-1 items-center rounded-full bg-primary py-3 active:opacity-90"
        style={nextDisabled ? { opacity: 0.6 } : undefined}
      >
        <Text className="text-sm font-sans-semibold text-primary-foreground">
          {t("monthIntake.next")}
        </Text>
      </Pressable>
    </View>
  );
}
