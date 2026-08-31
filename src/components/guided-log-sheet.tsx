import { Activity, ClipboardList, UtensilsCrossed, X } from "lucide-react";
import { useEffect, useState } from "react";

import { DictateButton } from "@/components/dictate-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type Mode = "actividad" | "exceso";

const ACTIVITIES = [
  { label: "Correr", kcalPerMin: 10 },
  { label: "Caminar", kcalPerMin: 4 },
  { label: "Bici", kcalPerMin: 8 },
  { label: "Gimnasio / pesas", kcalPerMin: 7 },
  { label: "Natación", kcalPerMin: 9 },
  { label: "Otra", kcalPerMin: 6 },
];

const INTENSITY: { label: string; factor: number }[] = [
  { label: "Suave", factor: 0.8 },
  { label: "Normal", factor: 1 },
  { label: "Fuerte", factor: 1.25 },
];

const EXCESS_PRESETS = [
  "Comida fuera de casa",
  "Postre o dulce",
  "Alcohol",
  "Picoteo entre horas",
  "Cena copiosa",
];

function chipClass(active: boolean) {
  return `rounded-full px-3 py-1.5 text-xs transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
  }`;
}

export function GuidedLogSheet({
  onSend,
  onSkip,
  disabled,
  open: openProp,
  onOpenChange,
  trigger = true,
  initialMode = "actividad",
  contextNote,
  mealLabel,
}: {
  onSend: (text: string) => void;
  /** Se llama al pulsar "Me lo salté" dentro del sheet de comida (modo exceso). */
  onSkip?: () => void;
  disabled?: boolean;
  /** Apertura controlada desde fuera (p.ej. hoy.tsx). Si se omite, el sheet gestiona su propio estado. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Oculta el botón "Registro guiado" propio cuando se controla desde fuera. */
  trigger?: boolean;
  initialMode?: Mode;
  /** Línea de contexto opcional (p.ej. qué comida se está detallando). */
  contextNote?: string;
  /**
   * Nombre de la comida concreta de HOY que se está registrando (p.ej. "Cena"),
   * cuando el sheet se abre desde "comí otra cosa" en Hoy. Al venir informado,
   * el mensaje enviado pide explícitamente cambiar ESE plato de hoy (además de
   * ajustar los días futuros), para que la pantalla de Hoy refleje lo que de
   * verdad se comió — ver `wasIdea` en daily.ts. Sin ella (registro genérico
   * desde el FAB del chat, sin comida asociada), hoy sigue quedando fijado.
   */
  mealLabel?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  // Actividad
  const [activity, setActivity] = useState(ACTIVITIES[0]!.label);
  const [minutes, setMinutes] = useState("30");
  const [intensity, setIntensity] = useState(INTENSITY[1]!.label);

  // Exceso / ajuste
  const [what, setWhat] = useState("");
  const [kcal, setKcal] = useState("");

  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMinutes("30");
    setIntensity(INTENSITY[1]!.label);
    setWhat("");
    setKcal("");
    setError(null);
  };

  const submit = () => {
    setError(null);

    if (mode === "actividad") {
      const mins = Number(minutes.replace(",", "."));
      if (!Number.isFinite(mins) || mins < 5 || mins > 360) {
        setError("Indica entre 5 y 360 minutos.");
        return;
      }
      const base = ACTIVITIES.find((a) => a.label === activity)?.kcalPerMin ?? 6;
      const factor = INTENSITY.find((i) => i.label === intensity)?.factor ?? 1;
      const burn = Math.round(mins * base * factor);
      onSend(
        `Registro de actividad: ${activity.toLowerCase()} ${Math.round(mins)} min, intensidad ${intensity.toLowerCase()}. ` +
          `Gasto extra estimado ~${burn} kcal (déficit). Ajusta solo los días futuros del plan compensando ese déficit ` +
          `(kcal_extra ≈ -${burn}) y dime cómo afecta a mi objetivo.`,
      );
    } else {
      const desc = what.trim();
      if (desc.length < 3) {
        setError("Cuéntame en pocas palabras qué ha pasado.");
        return;
      }
      let extra: number | null = null;
      if (kcal.trim()) {
        const n = Number(kcal.replace(",", "."));
        if (!Number.isFinite(n) || n < 50 || n > 3000) {
          setError("Las kcal extra deben estar entre 50 y 3000 (o déjalo vacío).");
          return;
        }
        extra = Math.round(n);
      }
      const kcalNote = extra ? ` Exceso estimado ~${extra} kcal (kcal_extra ≈ +${extra}).` : "";
      onSend(
        mealLabel
          ? `Esto es lo que de verdad he comido en ${mealLabel.toLowerCase()} de HOY, en vez de lo planeado: ${desc}.${kcalNote} ` +
              `Cambia el plato de ${mealLabel.toLowerCase()} de hoy a esto exacto y además corrige de forma suave los días futuros del plan (la compra no cambia) y dime cómo queda mi objetivo.`
          : `Registro de exceso/ajuste de hoy: ${desc}.${kcalNote} ` +
              `Corrige solo los días futuros del plan de forma suave (hoy queda fijado y la compra no cambia) y dime cómo queda mi objetivo.`,
      );
    }

    reset();
    setOpen(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      {trigger ? (
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="gap-1.5 text-muted-foreground"
          >
            <ClipboardList className="size-4" aria-hidden />
            Registro guiado
          </Button>
        </SheetTrigger>
      ) : null}

      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            {trigger
              ? "Registro guiado"
              : mode === "actividad"
                ? "Registrar actividad"
                : "Comí distinto"}
          </SheetTitle>
          <SheetDescription>
            {trigger
              ? "Cuéntame la actividad o el exceso del día y ajusto los días futuros del plan."
              : mode === "actividad"
                ? "Apunta tu actividad física y ajusto los días futuros del plan."
                : "Cuéntame qué has comido y ajusto los días futuros del plan."}
          </SheetDescription>
          {contextNote ? <p className="text-xs font-medium text-primary">{contextNote}</p> : null}
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {/* El selector de modo solo aparece en el registro guiado suelto (chat).
              Cuando el sheet se abre desde Hoy (comida o "Registrar deporte") el
              modo ya está fijado y se enseña solo ese formulario, como en móvil. */}
          {trigger ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("actividad")}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  mode === "actividad"
                    ? "bg-primary/10 text-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <Activity className="size-4" aria-hidden />
                Actividad
              </button>
              <button
                type="button"
                onClick={() => setMode("exceso")}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  mode === "exceso"
                    ? "bg-primary/10 text-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <UtensilsCrossed className="size-4" aria-hidden />
                Exceso o ajuste
              </button>
            </div>
          ) : null}

          {mode === "actividad" ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">¿Qué has hecho?</Label>
                <div className="flex flex-wrap gap-2">
                  {ACTIVITIES.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => setActivity(a.label)}
                      className={chipClass(activity === a.label)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="glog-min" className="text-xs text-muted-foreground">
                  Minutos (5-360)
                </Label>
                <Input
                  id="glog-min"
                  inputMode="numeric"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="30"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Intensidad</Label>
                <div className="flex gap-2">
                  {INTENSITY.map((i) => (
                    <button
                      key={i.label}
                      type="button"
                      onClick={() => setIntensity(i.label)}
                      className={chipClass(intensity === i.label)}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {onSkip ? (
                <button
                  type="button"
                  onClick={() => {
                    onSkip();
                    reset();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl bg-secondary/60 px-4 py-3 text-left transition-opacity active:opacity-80"
                >
                  <X className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Me lo salté</span>
                    <span className="block text-xs text-muted-foreground">
                      No he comido nada en esta comida
                    </span>
                  </span>
                </button>
              ) : null}

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  {trigger ? "¿Qué ha pasado?" : "¿Qué has comido?"}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {EXCESS_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setWhat(p)}
                      className={chipClass(what === p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={what}
                  onChange={(e) => setWhat(e.target.value)}
                  placeholder="Por ejemplo: he comido pizza y postre en una comida familiar"
                  rows={3}
                />
                <DictateButton
                  onText={(t) => setWhat((prev) => (prev ? `${prev.trim()} ${t}` : t))}
                  label="Dictar"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="glog-kcal" className="text-xs text-muted-foreground">
                  Kcal extra aproximadas (opcional, 50-3000)
                </Label>
                <Input
                  id="glog-kcal"
                  inputMode="numeric"
                  value={kcal}
                  onChange={(e) => setKcal(e.target.value)}
                  placeholder="Si no lo sabes, déjalo vacío"
                />
              </div>
            </>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button className="w-full" onClick={submit} disabled={disabled}>
            Enviar al coach y ajustar plan
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {mode === "exceso" && mealLabel
              ? `Cambio el plato de ${mealLabel.toLowerCase()} de hoy a lo que comiste de verdad; los demás días futuros se ajustan y la compra no varía.`
              : "Hoy queda fijado; solo cambian los días futuros y la lista de la compra no varía."}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
