import { Loader2 } from "lucide-react";
import { useState } from "react";

import { DictateButton } from "@/components/dictate-button";
import { BLOCKED_FOOD_MESSAGE, isCleanFood } from "@/lib/content-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

/** Lo que responde el cambio: si el texto es vago, la hoja pide concretar. */
export type MealSwapResult = { ok: true } | { ok: false; vague: boolean; message: string };

/**
 * Mini-sheet que aparece al tocar "Comí otra cosa" en Hoy. Pide solo qué ha
 * comido (texto libre) y ofrece saltarse la comida. Nada de chips ni de
 * navegación al chat: el cambio se aplica directamente al plan.
 *
 * Si el texto no dice qué se comió ("algo rápido"), el servidor no se lo
 * inventa (ticket 13 de `precision-nutricional`, D13): la hoja se queda
 * abierta, pide concretar con un ejemplo y ofrece apuntar las kcal a mano. Esa
 * cifra es de la persona, no un promedio.
 */
export function MealSwapSheet({
  open,
  onOpenChange,
  mealLabel,
  plannedDish,
  onSwap,
  onSkip,
  disabled,
  showNumbers = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre de la comida (e.g. "Cena"). */
  mealLabel: string;
  /** Plato que tenía el plan para ese momento. */
  plannedDish: string;
  /** Llamado con el texto libre que describe lo que ha comido. */
  onSwap: (dish: string, opts?: { manualKcal?: number }) => Promise<MealSwapResult>;
  /** Llamado al pulsar "Me lo salté". */
  onSkip: () => void;
  /** Bloquea el sheet mientras el swap está en curso. */
  disabled?: boolean;
  /**
   * `false` con la preferencia de no ver cifras (ticket 01): ante un texto vago
   * solo se pide concretar, sin ofrecer apuntar kcal a mano.
   */
  showNumbers?: boolean;
}) {
  const [what, setWhat] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** El servidor dijo que el texto es vago: se ofrece apuntar las kcal a mano. */
  const [vague, setVague] = useState(false);
  const [kcal, setKcal] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setWhat("");
    setError(null);
    setVague(false);
    setKcal("");
  };

  const send = async (desc: string, manualKcal?: number) => {
    setBusy(true);
    try {
      const result = await onSwap(desc, manualKcal != null ? { manualKcal } : undefined);
      if (result.ok) {
        reset();
        onOpenChange(false);
        return;
      }
      setVague(result.vague);
      setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const desc = what.trim();
    if (desc.length < 2) {
      setError("Escribe qué has comido.");
      return;
    }
    // Aviso inmediato, sin esperar al servidor. El rechazo de verdad lo hace el
    // `.validator()` de `setPlanMeal`, que es por donde pasan web, móvil y el
    // coach; esto solo evita la ida y vuelta.
    if (!isCleanFood(desc)) {
      setError(BLOCKED_FOOD_MESSAGE);
      return;
    }
    void send(desc);
  };

  const submitManual = () => {
    const desc = what.trim();
    const value = Number(kcal.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || value > 5000) {
      setError("Escribe las kcal aproximadas, entre 1 y 5000.");
      return;
    }
    void send(desc, Math.round(value));
  };

  const locked = disabled || busy;

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
                if (vague) setVague(false);
              }}
              rows={2}
              className="pr-10 text-sm"
              disabled={locked}
              autoFocus
            />
            <DictateButton
              onText={(t) => setWhat((prev) => (prev ? `${prev} ${t}` : t))}
              className="absolute right-2 top-2"
            />
          </div>

          {error ? (
            <p className={`text-xs ${vague ? "text-muted-foreground" : "text-destructive"}`}>
              {error}
            </p>
          ) : null}

          {vague && showNumbers ? (
            <div className="space-y-2 rounded-2xl bg-surface p-3">
              <p className="text-xs text-muted-foreground">
                ¿Prefieres apuntar las calorías tú? Cuentan tal cual las escribas.
              </p>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  placeholder="kcal aproximadas"
                  value={kcal}
                  onChange={(e) => setKcal(e.target.value)}
                  disabled={locked}
                  className="text-sm"
                />
                <Button
                  variant="secondary"
                  onClick={submitManual}
                  disabled={locked || !kcal.trim()}
                >
                  Apuntar
                </Button>
              </div>
            </div>
          ) : null}

          <Button onClick={submit} disabled={locked || !what.trim()} className="w-full">
            {locked ? (
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
            disabled={locked}
            className="w-full text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Me lo salté
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
