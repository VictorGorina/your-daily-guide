import { Mic } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

// El dictado está desactivado temporalmente: transcribía audio a través de un
// gateway de IA (Whisper) que ya no usamos, y no tenemos otro proveedor de
// voz-a-texto conectado todavía. El botón queda visible pero inactivo hasta
// que se elija uno nuevo.
export function DictateButton({
  className,
  label = "Dictar",
}: {
  onText: (text: string) => void;
  className?: string;
  label?: string;
}) {
  const handle = () => {
    toast.info("El dictado por voz no está disponible por ahora");
  };

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={`${label} (no disponible por ahora)`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-input bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60 transition-colors",
        className,
      )}
    >
      <Mic className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
