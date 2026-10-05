import { Mic } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useDictationField } from "@/lib/dictation-context";
import { useDictation } from "@/lib/use-dictation";
import { cn } from "@/lib/utils";

export function DictateButton({
  onText,
  className,
  label: labelProp,
}: {
  onText: (text: string) => void;
  className?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  const label = labelProp ?? t("dictation.label");
  const { state, supported, start, stop, level } = useDictation(onText);
  const listening = state === "listening";

  // Va siempre dentro de un `DictationField`: la onda del campo sale de aquí.
  const report = useDictationField()?.report;
  useEffect(() => {
    report?.(listening, level);
  }, [report, listening, level]);

  if (!supported) {
    return (
      <button
        type="button"
        onClick={() => toast.info(t("dictation.unavailable"))}
        aria-label={t("dictation.unavailableLabel", { label })}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60 transition-colors",
          className,
        )}
      >
        <Mic className="h-3.5 w-3.5" />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      aria-pressed={listening}
      aria-label={t("dictation.holdTo", { action: label.toLowerCase() })}
      className={cn(
        "z-10 inline-flex touch-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors select-none",
        listening ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
        className,
      )}
    >
      <Mic className="h-3.5 w-3.5" />
      {listening ? t("dictation.listening") : label}
    </button>
  );
}
