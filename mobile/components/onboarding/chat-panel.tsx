import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Info,
  Pencil,
  Save,
  Send,
  SkipForward,
} from "lucide-react-native";
import { useRef, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  type FlatNode,
  type Question,
  SCREENS,
  screenSubtitleKey,
  screenTitleKey,
} from "../../lib/onboarding-script";
import { DictateButton } from "../dictate-button";
import { DictationField, DictationWave } from "../dictation-field";
import { C } from "./shell";

type Props = {
  flat: FlatNode[];
  answers: Record<string, string>;
  skipped: Record<string, true>;
  cur: FlatNode;
  curIndex: number;
  total: number;
  remaining: number;
  /** La pregunta en curso tal como se enseña (ver `displayQuestion`). */
  currentQ: Question;
  /** La etapa acaba de completarse: en vez del campo va la tarjeta de paso. */
  stageEnd: boolean;
  isLastStage: boolean;
  qText: (node: FlatNode) => string;
  qHint: (q: Question) => string | null;
  chipLabel: (q: Question, chip: string) => string;
  selectedChips: Set<string>;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  error: string | null;
  saving: boolean;
  onBack: () => void;
  onOpenIndex: () => void;
  onSaveAndExit: () => void;
  onGoTo: (key: string) => void;
  onAdvanceStage: () => void;
  onToggleChip: (chip: string) => void;
  onCommit: (raw: string) => void;
  onSkip: () => void;
};

/** El chat del onboarding: cabecera de etapa, progreso, turnos y el campo. */
export function ChatPanel({
  flat,
  answers,
  skipped,
  cur,
  curIndex,
  total,
  remaining,
  currentQ,
  stageEnd,
  isLastStage,
  qText,
  qHint,
  chipLabel,
  selectedChips,
  value,
  setValue,
  error,
  saving,
  onBack,
  onOpenIndex,
  onSaveAndExit,
  onGoTo,
  onAdvanceStage,
  onToggleChip,
  onCommit,
  onSkip,
}: Props) {
  const screenNodes = flat.filter((n) => n.si === cur.si);
  const posInScreen = screenNodes.findIndex((n) => n.key === cur.key);
  const visibleTurns = screenNodes.slice(0, posInScreen + 1);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 px-5 pt-2">
          <ChatHeader
            stage={cur.si}
            backDisabled={curIndex <= 0 && !stageEnd}
            onBack={onBack}
            onOpenIndex={onOpenIndex}
            onSaveAndExit={onSaveAndExit}
          />
          <ChatProgress
            flat={flat}
            answers={answers}
            stage={cur.si}
            curIndex={curIndex}
            total={total}
            remaining={remaining}
          />
          <ChatTurns
            turns={visibleTurns}
            answers={answers}
            skipped={skipped}
            qText={qText}
            onGoTo={onGoTo}
          />

          {error ? (
            <View className="mb-2 flex-row items-start gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5">
              <Info size={14} color={C.primary} />
              <Text className="flex-1 text-xs text-foreground">{error}</Text>
            </View>
          ) : null}

          {stageEnd ? (
            <StageEndCard
              stage={cur.si}
              isLastStage={isLastStage}
              onBack={onBack}
              onAdvanceStage={onAdvanceStage}
            />
          ) : (
            <Composer
              currentQ={currentQ}
              qHint={qHint}
              chipLabel={chipLabel}
              selectedChips={selectedChips}
              value={value}
              setValue={setValue}
              saving={saving}
              onToggleChip={onToggleChip}
              onCommit={onCommit}
              onSkip={onSkip}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChatHeader({
  stage,
  backDisabled,
  onBack,
  onOpenIndex,
  onSaveAndExit,
}: {
  stage: number;
  backDisabled: boolean;
  onBack: () => void;
  onOpenIndex: () => void;
  onSaveAndExit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        disabled={backDisabled}
        accessibilityLabel={t("onboarding.chat.back")}
        className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80 disabled:opacity-40"
      >
        <ArrowLeft size={18} color={C.fg} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenIndex}
        className="h-11 flex-1 flex-row items-center justify-between rounded-full bg-surface px-4 active:opacity-90"
      >
        <View className="flex-1">
          <Text className="font-mono text-[9.5px] uppercase tracking-[1px] text-muted-foreground">
            {t("onboarding.chat.stage", { n: stage + 1, total: SCREENS.length })}
          </Text>
          <Text className="text-[13.5px] font-sans-semibold text-foreground" numberOfLines={1}>
            {t(screenTitleKey(SCREENS[stage]!))}
          </Text>
        </View>
        <ChevronDown size={16} color={C.muted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onSaveAndExit}
        accessibilityLabel={t("onboarding.chat.saveAndExit")}
        className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80"
      >
        <Save size={18} color={C.muted} />
      </Pressable>
    </View>
  );
}

/** Un tramo por etapa y el contador de preguntas. */
function ChatProgress({
  flat,
  answers,
  stage,
  curIndex,
  total,
  remaining,
}: {
  flat: FlatNode[];
  answers: Record<string, string>;
  stage: number;
  curIndex: number;
  total: number;
  remaining: number;
}) {
  const { t } = useTranslation();
  const segments = SCREENS.map((_, si) => {
    const nodes = flat.filter((n) => n.si === si);
    const done = nodes.filter((n) => answers[n.key] !== undefined).length;
    const pct = nodes.length ? done / nodes.length : 0;
    return si === stage ? Math.max(pct, 0.08) : pct;
  });
  return (
    <>
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
    </>
  );
}

/** Las preguntas de la etapa hasta la actual, cada una con su respuesta o su "saltada". */
function ChatTurns({
  turns,
  answers,
  skipped,
  qText,
  onGoTo,
}: {
  turns: FlatNode[];
  answers: Record<string, string>;
  skipped: Record<string, true>;
  qText: (node: FlatNode) => string;
  onGoTo: (key: string) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView | null>(null);
  return (
    <ScrollView
      ref={scrollRef}
      className="mt-5 flex-1"
      contentContainerClassName="gap-3 pb-2"
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      keyboardShouldPersistTaps="handled"
    >
      {turns.map((n) => (
        <View key={n.key} className="gap-3">
          <View className="items-start">
            <View className="max-w-[85%] rounded-3xl bg-surface px-4 py-3">
              <Text className="text-sm leading-relaxed text-foreground">{qText(n)}</Text>
            </View>
          </View>
          {answers[n.key] !== undefined ? (
            <View className="items-end">
              <Pressable
                accessibilityRole="button"
                onPress={() => onGoTo(n.key)}
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
                accessibilityRole="button"
                onPress={() => onGoTo(n.key)}
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
  );
}

/** Tarjeta de fin de etapa: repasar o seguir con la siguiente (o ir al resumen). */
function StageEndCard({
  stage,
  isLastStage,
  onBack,
  onAdvanceStage,
}: {
  stage: number;
  isLastStage: boolean;
  onBack: () => void;
  onAdvanceStage: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="mb-2 gap-3.5 rounded-3xl bg-surface p-4">
      <Text className="text-sm leading-relaxed text-muted-foreground">
        {t("onboarding.chat.stageDone")}{" "}
        <Text className="font-sans-medium text-foreground">
          {t(screenSubtitleKey(SCREENS[stage]!)).toLowerCase()}
        </Text>
        .{" "}
        {isLastStage
          ? t("onboarding.chat.lastStage")
          : t("onboarding.chat.nextStage", {
              stage: t(screenSubtitleKey(SCREENS[stage + 1]!)).toLowerCase(),
            })}
      </Text>
      <View className="flex-row gap-2.5">
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          className="flex-row items-center justify-center gap-1.5 rounded-full bg-secondary px-4 py-3 active:opacity-80"
        >
          <ArrowLeft size={15} color={C.muted} />
          <Text className="text-[13.5px] font-sans-semibold text-muted-foreground">
            {t("onboarding.chat.review")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onAdvanceStage}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3 active:opacity-90"
        >
          <Text className="text-[13.5px] font-sans-semibold text-primary-foreground">
            {t(isLastStage ? "onboarding.index.seeSummary" : "onboarding.chat.continue")}
          </Text>
          <ArrowRight size={16} color={C.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/** Chips de la pregunta y el campo de texto con saltar, dictar y enviar. */
function Composer({
  currentQ,
  qHint,
  chipLabel,
  selectedChips,
  value,
  setValue,
  saving,
  onToggleChip,
  onCommit,
  onSkip,
}: {
  currentQ: Question;
  qHint: (q: Question) => string | null;
  chipLabel: (q: Question, chip: string) => string;
  selectedChips: Set<string>;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  saving: boolean;
  onToggleChip: (chip: string) => void;
  onCommit: (raw: string) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="mb-2 gap-2.5">
      {currentQ.chips?.length ? (
        <View className="flex-row flex-wrap gap-2">
          {currentQ.chips.map((c) => {
            const active = selectedChips.has(c);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={c}
                onPress={() => onToggleChip(c)}
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
              onSubmitEditing={currentQ.dateInput ? () => onCommit(value) : undefined}
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
              accessibilityRole="button"
              onPress={onSkip}
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
                  onText={(text) => setValue((v) => (v.trim() ? `${v.trim()} ${text}` : text))}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => onCommit(value)}
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
  );
}
