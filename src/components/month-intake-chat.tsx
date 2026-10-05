import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DictateButton } from "@/components/dictate-button";
import { DictationField, DictationWave } from "@/components/dictation-field";
import {
  AWAY_PRESETS,
  INTAKE_TEXT_QUESTIONS,
  intakeAnswerText,
  type AwayPreset,
  type IntakeAnswers,
  type IntakeTextAnswer,
  type IntakeTextQuestion,
} from "@/lib/month-intake";
import { dateInMonth, daysInMonth } from "@/lib/dates";
import { dateLocale } from "@/lib/i18n";
import { monthParts } from "@/lib/plan-shared";
import { setMonthConstraints } from "@/lib/plan.functions";

/** Paso 0: ausencia. 1..4: preguntas de texto. 5: resumen y generar. */
const LAST_STEP = INTAKE_TEXT_QUESTIONS.length + 1;

/**
 * La conversación con el coach antes de generar el plan de un mes (cinco
 * preguntas, `month-intake.ts`; copia en `mobile/components/month-intake-chat.tsx`).
 * Un mes se genera una sola vez, así que esto es lo que lo personaliza: al
 * final guarda las respuestas (`setMonthConstraints`) y llama a `onGenerate`,
 * que genera el plan con ellas.
 */
export function MonthIntakeChat({
  month,
  generating,
  onGenerate,
  onCancel,
}: {
  month: string;
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const monthName = monthParts(month, locale).monthName;
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<AwayPreset | null>(null);
  const [awayStart, setAwayStart] = useState("");
  const [awayEnd, setAwayEnd] = useState("");
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [step]);

  const save = useServerFn(setMonthConstraints);
  const submit = useMutation({
    mutationFn: () => {
      const away = preset && preset !== "no";
      return save({
        data: {
          month,
          awayStart: away ? awayStart : null,
          awayEnd: away ? awayEnd : null,
          answers,
        },
      });
    },
    onSuccess: onGenerate,
    onError: (e) => toast.error(e instanceof Error ? e.message : t("monthIntake.saveError")),
  });
  const busy = submit.isPending || generating;

  const minDate = `${month}-01`;
  const maxDate = dateInMonth(month, daysInMonth(month));
  const hasRange = preset != null && preset !== "no";
  const awayReady = preset === "no" || (hasRange && awayStart && awayEnd && awayStart <= awayEnd);

  const awayText =
    preset === "no"
      ? t("monthIntake.away.chips.no")
      : preset
        ? t("monthIntake.away.range", {
            preset: t(`monthIntake.away.chips.${preset}`),
            from: prettyDay(awayStart, locale),
            to: prettyDay(awayEnd, locale),
          })
        : null;

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
    <section className="surface-card animate-rise mt-8 space-y-5 p-6">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{t("monthIntake.title", { month: monthName })}</h2>
          <p className="text-xs text-muted-foreground">{t("monthIntake.subtitle")}</p>
        </div>
      </div>

      <CoachLine>{t("monthIntake.away.ask", { month: monthName })}</CoachLine>
      {step === 0 ? (
        <div className="space-y-3">
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
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label={t("monthIntake.away.from")}
                value={awayStart}
                min={minDate}
                max={awayEnd || maxDate}
                onChange={(e) => setAwayStart(e.target.value)}
                className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
              <span className="text-sm text-muted-foreground">{t("monthIntake.away.sep")}</span>
              <input
                type="date"
                aria-label={t("monthIntake.away.to")}
                value={awayEnd}
                min={awayStart || minDate}
                max={maxDate}
                onChange={(e) => setAwayEnd(e.target.value)}
                className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          ) : null}
          <StepButtons onNext={() => setStep(1)} nextDisabled={!awayReady} />
        </div>
      ) : (
        <UserLine>{awayText}</UserLine>
      )}

      {INTAKE_TEXT_QUESTIONS.map((q, i) => {
        const qStep = i + 1;
        if (step < qStep) return null;
        const answer = answers[q.key];
        return (
          <div key={q.key} className="space-y-3">
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
                  <div className="rounded-3xl bg-muted p-2 focus-within:ring-2 focus-within:ring-ring/40">
                    <div className="relative rounded-2xl">
                      <textarea
                        rows={2}
                        maxLength={200}
                        value={answer?.text ?? ""}
                        onChange={(e) => setAnswer(q.key, { text: e.target.value })}
                        placeholder={t(`monthIntake.q.${q.key}.placeholder`)}
                        aria-label={t(`monthIntake.q.${q.key}.ask`)}
                        className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
                      />
                      <DictationWave />
                    </div>
                    <div className="flex items-center px-1">
                      <DictateButton
                        onText={(spoken) =>
                          setAnswer(q.key, {
                            text: answer?.text ? `${answer.text.trim()} ${spoken}` : spoken,
                          })
                        }
                      />
                    </div>
                  </div>
                </DictationField>
                <StepButtons onBack={() => setStep(qStep - 1)} onNext={() => setStep(qStep + 1)} />
              </>
            ) : (
              <UserLine>
                {intakeAnswerText(answer, (chip) => chipLabel(q, chip)) ?? t("monthIntake.nothing")}
              </UserLine>
            )}
          </div>
        );
      })}

      {step === LAST_STEP ? (
        <div className="space-y-3">
          <CoachLine>{t("monthIntake.ready", { month: monthName })}</CoachLine>
          <button
            type="button"
            onClick={() => submit.mutate()}
            disabled={busy}
            className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? t("plan.create.preparing") : t("monthIntake.generate", { month: monthName })}
          </button>
          {!busy ? (
            <button
              type="button"
              onClick={() => setStep(LAST_STEP - 1)}
              className="w-full py-1 text-xs font-medium text-muted-foreground"
            >
              {t("monthIntake.change")}
            </button>
          ) : null}
        </div>
      ) : null}

      {step === 0 ? (
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-1 text-xs font-medium text-muted-foreground"
        >
          {t("monthIntake.notNow")}
        </button>
      ) : null}
      <div ref={endRef} />
    </section>
  );
}

/** "2026-10-12" → "12 de octubre". */
function prettyDay(iso: string, locale: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
  });
}

function CoachLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground">{children}</p>;
}

function UserLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 text-sm text-foreground">
      {children}
    </p>
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
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onPick(option.value)}
            aria-pressed={active}
            disabled={disabled}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-transform active:scale-95 ${
              active ? "bg-foreground font-semibold text-background" : "bg-muted text-foreground"
            }`}
          >
            {active ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
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
    <div className="flex gap-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-muted px-5 py-3 text-sm font-medium text-foreground"
        >
          {t("common.back")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {t("monthIntake.next")}
      </button>
    </div>
  );
}
