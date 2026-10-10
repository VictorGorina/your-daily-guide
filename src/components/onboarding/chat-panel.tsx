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
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { DictateButton } from "@/components/dictate-button";
import { DictationField, DictationWave } from "@/components/dictation-field";
import { localISODate } from "@/lib/dates";
import {
  type FlatNode,
  type Question,
  SCREENS,
  screenSubtitleKey,
  screenTitleKey,
} from "@/lib/onboarding-script";

import { Shell } from "./shell";

// Fechas locales: `toISOString()` es la de UTC, y por la noche en América ya es mañana.
const DOB_MAX = localISODate(new Date());
const DOB_MIN = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 110);
  return localISODate(d);
})();

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
  /** El final de la lista de turnos y el campo: la pantalla baja hasta uno y enfoca el otro. */
  endRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
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
  endRef,
  inputRef,
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
    <Shell>
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
        endRef={endRef}
        onGoTo={onGoTo}
      />

      {error ? (
        <div className="animate-rise mb-2 flex items-start gap-2 rounded-2xl bg-primary-soft px-3.5 py-2.5 text-xs text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-ink" />
          <span>{error}</span>
        </div>
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
          inputRef={inputRef}
          onToggleChip={onToggleChip}
          onCommit={onCommit}
          onSkip={onSkip}
        />
      )}
    </Shell>
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("onboarding.chat.back")}
        disabled={backDisabled}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-transform active:scale-95 disabled:opacity-40"
      >
        <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={onOpenIndex}
        className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-surface px-4 text-left transition-transform active:scale-[0.99]"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-num text-[9.5px] uppercase tracking-[0.09em] text-muted-foreground">
            {t("onboarding.chat.stage", { n: stage + 1, total: SCREENS.length })}
          </span>
          <span className="truncate text-[13.5px] font-semibold tracking-tight">
            {t(screenTitleKey(SCREENS[stage]))}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.4} />
      </button>
      <button
        type="button"
        onClick={onSaveAndExit}
        aria-label={t("onboarding.chat.saveAndExit")}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground transition-transform active:scale-95"
      >
        <Save className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
    </div>
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
    </>
  );
}

/** Las preguntas de la etapa hasta la actual, cada una con su respuesta o su "saltada". */
function ChatTurns({
  turns,
  answers,
  skipped,
  qText,
  endRef,
  onGoTo,
}: {
  turns: FlatNode[];
  answers: Record<string, string>;
  skipped: Record<string, true>;
  qText: (node: FlatNode) => string;
  endRef: RefObject<HTMLDivElement | null>;
  onGoTo: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
      {turns.map((n) => (
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
                onClick={() => onGoTo(n.key)}
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
                onClick={() => onGoTo(n.key)}
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
    <div className="animate-rise space-y-3.5 rounded-3xl bg-surface p-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("onboarding.chat.stageDone")}{" "}
        <span className="font-medium text-foreground">
          {t(screenSubtitleKey(SCREENS[stage])).toLowerCase()}
        </span>
        .{" "}
        {isLastStage
          ? t("onboarding.chat.lastStage")
          : t("onboarding.chat.nextStage", {
              stage: t(screenSubtitleKey(SCREENS[stage + 1])).toLowerCase(),
            })}
      </p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center gap-1.5 rounded-full bg-secondary px-4 py-3 text-[13.5px] font-semibold text-muted-foreground transition-transform active:scale-95"
        >
          <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={2.2} />
          {t("onboarding.chat.review")}
        </button>
        <button
          type="button"
          onClick={onAdvanceStage}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-[13.5px] font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          {t(isLastStage ? "onboarding.index.seeSummary" : "onboarding.chat.continue")}
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

/** Chips de la pregunta y el campo (texto o fecha) con dictar, saltar y enviar. */
function Composer({
  currentQ,
  qHint,
  chipLabel,
  selectedChips,
  value,
  setValue,
  saving,
  inputRef,
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
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onToggleChip: (chip: string) => void;
  onCommit: (raw: string) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCommit(value);
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
                onClick={() => onToggleChip(c)}
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
                    onCommit(value);
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
                  onText={(text) => setValue((v) => (v ? `${v.trim()} ${text}` : text))}
                  label={t("onboarding.chat.dictate")}
                />
              )}
              <button
                type="button"
                onClick={onSkip}
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
  );
}
