import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DictateButton } from "@/components/dictate-button";
import {
  AWAY_QUESTION,
  INTAKE_TEXT_QUESTIONS,
  intakeAnswerText,
  type AwayPreset,
  type IntakeAnswers,
  type IntakeTextAnswer,
} from "@/lib/month-intake";
import { daysInMonth, monthTitle } from "@/lib/plan-shared";
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
  const monthName = monthTitle(month).split(" de ")[0];
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
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No hemos podido guardar tus respuestas"),
  });
  const busy = submit.isPending || generating;

  const minDate = `${month}-01`;
  const maxDate = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const hasRange = preset != null && preset !== "no";
  const awayReady = preset === "no" || (hasRange && awayStart && awayEnd && awayStart <= awayEnd);

  const awayText =
    preset === "no"
      ? "No"
      : preset
        ? `${AWAY_QUESTION.chips.find((c) => c.key === preset)?.label}: del ${prettyDay(awayStart)} al ${prettyDay(awayEnd)}`
        : null;

  const setAnswer = (key: keyof IntakeAnswers, patch: Partial<IntakeTextAnswer>) =>
    setAnswers((prev) => {
      const current = prev[key] ?? { chip: null, text: "" };
      return { ...prev, [key]: { ...current, ...patch } };
    });

  return (
    <section className="surface-card animate-rise mt-8 space-y-5 p-6">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Preparemos {monthName}</h2>
          <p className="text-xs text-muted-foreground">
            Cinco preguntas y lo hago a tu medida. El plan del mes se crea una sola vez.
          </p>
        </div>
      </div>

      <CoachLine>{AWAY_QUESTION.ask(monthName)}</CoachLine>
      {step === 0 ? (
        <div className="space-y-3">
          <Chips
            options={AWAY_QUESTION.chips.map((c) => c.label)}
            value={AWAY_QUESTION.chips.find((c) => c.key === preset)?.label ?? null}
            disabled={busy}
            onPick={(label) => setPreset(AWAY_QUESTION.chips.find((c) => c.label === label)!.key)}
          />
          {hasRange ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Desde"
                value={awayStart}
                min={minDate}
                max={awayEnd || maxDate}
                onChange={(e) => setAwayStart(e.target.value)}
                className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none"
              />
              <span className="text-sm text-muted-foreground">a</span>
              <input
                type="date"
                aria-label="Hasta"
                value={awayEnd}
                min={awayStart || minDate}
                max={maxDate}
                onChange={(e) => setAwayEnd(e.target.value)}
                className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none"
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
            <CoachLine>{q.ask(monthName)}</CoachLine>
            {step === qStep ? (
              <>
                <Chips
                  options={q.chips}
                  value={answer?.chip ?? null}
                  disabled={busy}
                  onPick={(chip) => setAnswer(q.key, { chip: answer?.chip === chip ? null : chip })}
                />
                <div className="rounded-3xl bg-muted p-2">
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={answer?.text ?? ""}
                    onChange={(e) => setAnswer(q.key, { text: e.target.value })}
                    placeholder={q.placeholder}
                    className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
                  />
                  <div className="flex items-center px-1">
                    <DictateButton
                      onText={(t) =>
                        setAnswer(q.key, {
                          text: answer?.text ? `${answer.text.trim()} ${t}` : t,
                        })
                      }
                    />
                  </div>
                </div>
                <StepButtons onBack={() => setStep(qStep - 1)} onNext={() => setStep(qStep + 1)} />
              </>
            ) : (
              <UserLine>{intakeAnswerText(answer) ?? "Nada que contar"}</UserLine>
            )}
          </div>
        );
      })}

      {step === LAST_STEP ? (
        <div className="space-y-3">
          <CoachLine>
            Perfecto, con esto preparo tu plan de {monthName} y su lista de la compra. Tardo un par
            de minutos.
          </CoachLine>
          <button
            type="button"
            onClick={() => submit.mutate()}
            disabled={busy}
            className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "Preparando tu mes..." : `Generar mi plan de ${monthName}`}
          </button>
          {!busy ? (
            <button
              type="button"
              onClick={() => setStep(LAST_STEP - 1)}
              className="w-full py-1 text-xs font-medium text-muted-foreground"
            >
              Cambiar alguna respuesta
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
          Ahora no
        </button>
      ) : null}
      <div ref={endRef} />
    </section>
  );
}

/** "2026-10-12" → "12 de octubre". */
function prettyDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", {
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
    <div className="flex flex-wrap gap-2">
      {options.map((label) => {
        const active = value === label;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onPick(label)}
            aria-pressed={active}
            disabled={disabled}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-transform active:scale-95 ${
              active ? "bg-foreground font-semibold text-background" : "bg-muted text-foreground"
            }`}
          >
            {active ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : null}
            {label}
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
  return (
    <div className="flex gap-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-muted px-5 py-3 text-sm font-medium text-foreground"
        >
          Atrás
        </button>
      ) : null}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        Siguiente
      </button>
    </div>
  );
}
