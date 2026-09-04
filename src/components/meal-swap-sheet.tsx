import { Loader2 } from "lucide-react";
import { useState } from "react";

import { DictateButton } from "@/components/dictate-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

/**
 * Mini-sheet que aparece al tocar "Comí otra cosa" en Hoy. Pide solo qué ha
 * comido (texto libre) y ofrece saltarse la comida. Nada de chips, de kcal, ni
 * de navegación al chat: el cambio se aplica directamente al plan.
 */
export function MealSwapSheet({
  open,
  onOpenChange,
  mealLabel,
  plannedDish,
  onSwap,
  onSkip,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre de la comida (e.g. "Cena"). */
  mealLabel: string;
  /** Plato que tenía el plan para ese momento. */
  plannedDish: string;
  /** Llamado con el texto libre que describe lo que ha comido. */
  onSwap: (dish: string) => void;
  /** Llamado al pulsar "Me lo salté". */
  onSkip: () => void;
  /** Bloquea el sheet mientras el swap está en curso. */
  disabled?: boolean;
}) {
  const [what, setWhat] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setWhat("");
    setError(null);
  };

  const submit = () => {
    const desc = what.trim();
    if (desc.length < 2) {
      setError("Escribe qué has comido.");
      return;
    }
    onSwap(desc);
    reset();
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            Comí distinto
          </SheetTitle>
          <SheetDescription>
            {plannedDish ? (
              <>
                En vez de <span className="line-through">{plannedDish}</span>, ¿qué has comido?
              </>
            ) : (
              `¿Qué has comido en ${mealLabel.toLowerCase()}?`
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          <div className="relative">
            <Textarea
              placeholder="Ej: Una pizza margarita con ensalada"
              value={what}
              onChange={(e) => {
                setWhat(e.target.value);
                if (error) setError(null);
              }}
              rows={2}
              className="pr-10 text-sm"
              disabled={disabled}
              autoFocus
            />
            <DictateButton
              onText={(t) => setWhat((prev) => (prev ? `${prev} ${t}` : t))}
              className="absolute right-2 top-2"
            />
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <Button onClick={submit} disabled={disabled || !what.trim()} className="w-full">
            {disabled ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cambiando…
              </>
            ) : (
              "Cambiar"
            )}
          </Button>

          <button
            type="button"
            onClick={() => {
              onSkip();
              reset();
              onOpenChange(false);
            }}
            disabled={disabled}
            className="w-full text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Me lo salté
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
