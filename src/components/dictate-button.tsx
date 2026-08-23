import { Mic } from "lucide-react";
import { toast } from "sonner";

import { useDictation } from "@/lib/use-dictation";
import { cn } from "@/lib/utils";

export function DictateButton({
  onText,
  className,
  label = "Dictar",
}: {
  onText: (text: string) => void;
  className?: string;
  label?: string;
}) {
  const { state, supported, start, stop } = useDictation(onText);
  const listening = state === "listening";

  if (!supported) {
    return (
      <button
        type="button"
        onClick={() => toast.info("El dictado por voz no está disponible en este navegador")}
        aria-label={`${label} (no disponible en este navegador)`}
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
      aria-label={`Mantén pulsado para ${label.toLowerCase()}`}
      className={cn(
        "inline-flex touch-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors select-none",
        listening ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
        className,
      )}
    >
      <Mic className="h-3.5 w-3.5" />
      {listening ? "Escuchando…" : label}
    </button>
  );
}
