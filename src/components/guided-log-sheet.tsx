import { Activity, ClipboardList, UtensilsCrossed } from "lucide-react";
import { useState } from "react";

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
  return `rounded-full border px-3 py-1.5 text-xs transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border/70 bg-card/70 text-muted-foreground"
  }`;
}

export function GuidedLogSheet({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("actividad");

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
      onSend(
        `Registro de exceso/ajuste de hoy: ${desc}.` +
          (extra ? ` Exceso estimado ~${extra} kcal (kcal_extra ≈ +${extra}).` : "") +
          ` Corrige solo los días futuros del plan de forma suave (hoy queda fijado y la compra no cambia) y dime cómo queda mi objetivo.`,
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

      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display">Registro guiado</SheetTitle>
          <SheetDescription>
            Cuéntame la actividad o el exceso del día y ajusto los días futuros del plan.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("actividad")}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                mode === "actividad"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground"
              }`}
            >
              <Activity className="size-4" aria-hidden />
              Actividad
            </button>
            <button
              type="button"
              onClick={() => setMode("exceso")}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                mode === "exceso"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground"
              }`}
            >
              <UtensilsCrossed className="size-4" aria-hidden />
              Exceso o ajuste
            </button>
          </div>

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
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">¿Qué ha pasado?</Label>
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
            Hoy queda fijado; solo cambian los días futuros y la lista de la compra no varía.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
