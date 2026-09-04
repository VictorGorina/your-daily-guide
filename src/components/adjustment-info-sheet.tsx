import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MealChange } from "@/lib/plan-shared";

const weekdayShort = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * Bottom sheet que muestra qué cambió en el plan futuro tras un swap de plato.
 * Se abre al tocar el badge "i" del plato modificado en Hoy.
 */
export function AdjustmentInfoSheet({
  open,
  onOpenChange,
  changes,
  dish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: MealChange[];
  /** El plato que comió la persona (para el título). */
  dish: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            Ajuste del plan
          </SheetTitle>
          <SheetDescription>
            Tras comer <span className="font-medium text-foreground">{dish}</span>, se han
            recolocado estos platos futuros para compensar:
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4 pb-8">
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No se han cambiado platos futuros — el plan ya estaba equilibrado.
            </p>
          ) : (
            changes.map((c) => (
              <div key={`${c.date}-${c.slot}`} className="rounded-xl bg-secondary/60 px-3.5 py-3">
                <span className="font-num text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  {weekdayShort(c.date)} · {c.slotLabel}
                </span>
                <div className="mt-1.5 flex items-start gap-2 text-sm leading-snug">
                  <span className="text-muted-foreground line-through">{c.before}</span>
                  <span className="shrink-0 text-muted-foreground">→</span>
                  <span className="font-medium text-foreground">{c.after}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
