import { useMutation } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { DictateButton } from "./dictate-button";
import { apiPost } from "../lib/api";
import {
  AWAY_QUESTION,
  INTAKE_TEXT_QUESTIONS,
  intakeAnswerText,
  type AwayPreset,
  type IntakeAnswers,
  type IntakeTextAnswer,
} from "../lib/month-intake";
import { monthTitle } from "../lib/plan-shared";

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
const prettyDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long" });

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
  const monthName = monthTitle(month).split(" de ")[0] ?? month;
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
    onError: (e) =>
      Alert.alert(e instanceof Error ? e.message : "No hemos podido guardar tus respuestas"),
  });
  const busy = submit.isPending || generating;

  const nextFromAway = () => {
    if (hasRange && !rangeOk) {
      Alert.alert(
        "Revisa las fechas",
        `Escríbelas como DD/MM/AAAA, dentro de ${monthName} y la de inicio antes que la de fin.`,
      );
      return;
    }
    setStep(1);
  };

  const awayText =
    preset === "no"
      ? "No"
      : preset && awayStart && awayEnd
        ? `${AWAY_QUESTION.chips.find((c) => c.key === preset)?.label}: del ${prettyDay(awayStart)} al ${prettyDay(awayEnd)}`
        : "";

  const setAnswer = (key: keyof IntakeAnswers, patch: Partial<IntakeTextAnswer>) =>
    setAnswers((prev) => {
      const current = prev[key] ?? { chip: null, text: "" };
      return { ...prev, [key]: { ...current, ...patch } };
    });

  return (
    <View className="mt-8 gap-5 rounded-3xl bg-surface p-6">
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-primary-soft">
          <Sparkles size={16} color="#ff8a3d" />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-sans-semibold text-foreground">Preparemos {monthName}</Text>
          <Text className="text-xs text-muted-foreground">
            Cinco preguntas y lo hago a tu medida. El plan del mes se crea una sola vez.
          </Text>
        </View>
      </View>

      <CoachLine>{AWAY_QUESTION.ask(monthName)}</CoachLine>
      {step === 0 ? (
        <View className="gap-3">
          <Chips
            options={AWAY_QUESTION.chips.map((c) => c.label)}
            value={AWAY_QUESTION.chips.find((c) => c.key === preset)?.label ?? null}
            disabled={busy}
            onPick={(label) => setPreset(AWAY_QUESTION.chips.find((c) => c.label === label)!.key)}
          />
          {hasRange ? (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={awayStartText}
                onChangeText={setAwayStartText}
                keyboardType="numbers-and-punctuation"
                placeholder="Desde DD/MM/AAAA"
                placeholderTextColor="#83796c"
                className="min-h-[44px] flex-1 rounded-xl bg-muted px-3 text-sm text-foreground"
              />
              <Text className="text-sm text-muted-foreground">a</Text>
              <TextInput
                value={awayEndText}
                onChangeText={setAwayEndText}
                keyboardType="numbers-and-punctuation"
                placeholder="Hasta DD/MM/AAAA"
                placeholderTextColor="#83796c"
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
            <CoachLine>{q.ask(monthName)}</CoachLine>
            {step === qStep ? (
              <>
                <Chips
                  options={q.chips}
                  value={answer?.chip ?? null}
                  disabled={busy}
                  onPick={(chip) => setAnswer(q.key, { chip: answer?.chip === chip ? null : chip })}
                />
                <View className="rounded-3xl bg-muted p-2">
                  <TextInput
                    value={answer?.text ?? ""}
                    onChangeText={(text) => setAnswer(q.key, { text })}
                    multiline
                    maxLength={200}
                    placeholder={q.placeholder}
                    placeholderTextColor="#83796c"
                    className="min-h-[44px] px-2 py-2 text-sm text-foreground"
                    textAlignVertical="top"
                  />
                  <View className="flex-row items-center px-1">
                    <DictateButton
                      onText={(t) =>
                        setAnswer(q.key, {
                          text: answer?.text?.trim() ? `${answer.text.trim()} ${t}` : t,
                        })
                      }
                    />
                  </View>
                </View>
                <StepButtons onBack={() => setStep(qStep - 1)} onNext={() => setStep(qStep + 1)} />
              </>
            ) : (
              <UserLine>{intakeAnswerText(answer) ?? "Nada que contar"}</UserLine>
            )}
          </View>
        );
      })}

      {step === LAST_STEP ? (
        <View className="gap-3">
          <CoachLine>
            Perfecto, con esto preparo tu plan de {monthName} y su lista de la compra. Tardo un par
            de minutos.
          </CoachLine>
          <Pressable
            onPress={() => submit.mutate()}
            disabled={busy}
            className="w-full items-center rounded-full bg-primary py-4 active:opacity-90"
            style={busy ? { opacity: 0.6 } : undefined}
          >
            <Text className="text-sm font-sans-semibold text-primary-foreground">
              {busy ? "Preparando tu mes..." : `Generar mi plan de ${monthName}`}
            </Text>
          </Pressable>
          {!busy ? (
            <Pressable
              onPress={() => setStep(LAST_STEP - 1)}
              className="w-full items-center py-1 active:opacity-70"
            >
              <Text className="text-xs font-sans-medium text-muted-foreground">
                Cambiar alguna respuesta
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {step === 0 ? (
        <Pressable onPress={onCancel} className="w-full items-center py-1 active:opacity-70">
          <Text className="text-xs font-sans-medium text-muted-foreground">Ahora no</Text>
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

function Chips({
  options,
  value,
  disabled,
  onPick,
}: {
  options: readonly string[];
  value: string | null;
  disabled?: boolean;
  onPick: (option: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((label) => {
        const active = value === label;
        return (
          <Pressable
            key={label}
            onPress={() => onPick(label)}
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
              {label}
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
  return (
    <View className="flex-row gap-2">
      {onBack ? (
        <Pressable onPress={onBack} className="rounded-full bg-muted px-5 py-3 active:opacity-80">
          <Text className="text-sm font-sans-medium text-foreground">Atrás</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        className="flex-1 items-center rounded-full bg-primary py-3 active:opacity-90"
        style={nextDisabled ? { opacity: 0.6 } : undefined}
      >
        <Text className="text-sm font-sans-semibold text-primary-foreground">Siguiente</Text>
      </Pressable>
    </View>
  );
}
