import { AlertCircle, ArrowRight, Check, Info, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  type FlatNode,
  GAP_TYPE,
  gapHelpKey,
  gapLabelKey,
  type GapKey,
  KEY_FIELDS,
  SCREENS,
  screenTitleKey,
} from "@/lib/onboarding-script";

import { OverlayHeader, Shell } from "./shell";

type Props = {
  flat: FlatNode[];
  answers: Record<string, string>;
  skipped: Record<string, true>;
  answeredCount: number;
  total: number;
  /** Todas las obligatorias respondidas: se enseñan los datos clave y se puede confirmar. */
  canConfirm: boolean;
  requiredPendingCount: number;
  gapMissing: GapKey[];
  gapValues: Record<string, string>;
  onGapChange: (key: GapKey, text: string) => void;
  qText: (node: FlatNode) => string;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onGoTo: (key: string) => void;
  onConfirm: () => void;
};

/** Resumen: datos clave, preguntas aparcadas y las respuestas por etapa. */
export function SummaryPanel({
  flat,
  answers,
  skipped,
  answeredCount,
  total,
  canConfirm,
  requiredPendingCount,
  gapMissing,
  gapValues,
  onGapChange,
  qText,
  error,
  saving,
  onClose,
  onGoTo,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const pending = flat.filter((n) => skipped[n.key]);
  const sections = SCREENS.map((s, si) => ({
    id: s.id,
    title: t(screenTitleKey(s)),
    items: flat.filter((n) => n.si === si && answers[n.key] !== undefined),
  })).filter((s) => s.items.length);
  const emptyResumen = pending.length === 0 && sections.length === 0;

  return (
    <Shell>
      <OverlayHeader
        eyebrow={t("onboarding.summary.eyebrow", { done: answeredCount, total })}
        title={t("onboarding.summary.title")}
        closeLabel={t("onboarding.chat.close")}
        onClose={onClose}
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
                  onChange={(e) => onGapChange(key, e.target.value)}
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
                onClick={() => onGoTo(n.key)}
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
                onClick={() => onGoTo(n.key)}
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
      {!canConfirm && requiredPendingCount ? (
        <p className="mb-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-ink" />{" "}
          {t("onboarding.summary.remaining", { count: requiredPendingCount })}
        </p>
      ) : null}

      <button
        type="button"
        disabled={saving}
        onClick={() => (canConfirm ? onConfirm() : onClose())}
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
