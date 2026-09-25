import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EXERCISE_ACTIVITIES,
  EXERCISE_INTENSITY,
  EXERCISE_MINUTES_MAX,
  EXERCISE_MINUTES_MIN,
  estimateExerciseKcal,
  type DayExercise,
} from "@/lib/exercise";
import { logExercise } from "@/lib/exercise.functions";

const chipClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
  }`;

/**
 * "Registrar deporte" en Hoy: mismo formato que "Añadir picoteo"
 * (`snack-sheet.tsx`), pero la cifra se calcula al instante (tabla
 * determinista, sin llamada a IA) en vez de pedirse al servidor. Se guarda
 * directo en `daily_logs.exercise`, sin pasar por el chat.
 */
export function ExerciseSheet({
  open,
  onOpenChange,
  today,
  onSaved,
  showNumbers = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onSaved: (exercise: DayExercise) => void;
  /** `false` con la preferencia de no ver cifras (ticket 01). */
  showNumbers?: boolean;
}) {
  const logFn = useServerFn(logExercise);
  const [activity, setActivity] = useState(EXERCISE_ACTIVITIES[0]!.label);
  const [minutes, setMinutes] = useState("30");
  const [intensity, setIntensity] = useState(EXERCISE_INTENSITY[1]!.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setActivity(EXERCISE_ACTIVITIES[0]!.label);
    setMinutes("30");
    setIntensity(EXERCISE_INTENSITY[1]!.label);
    setBusy(false);
    setError(null);
  };

  const mins = Number(minutes.replace(",", "."));
  const validMinutes =
    Number.isFinite(mins) && mins >= EXERCISE_MINUTES_MIN && mins <= EXERCISE_MINUTES_MAX;
  const burn = validMinutes ? estimateExerciseKcal(activity, mins, intensity) : null;

  const save = async () => {
    if (!validMinutes) {
      setError(`Indica entre ${EXERCISE_MINUTES_MIN} y ${EXERCISE_MINUTES_MAX} minutos.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await logFn({ data: { today, activity, minutes: Math.round(mins), intensity } });
      onSaved(res.exercise);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No he podido guardar el deporte.");
      setBusy(false);
    }
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
            Registrar deporte
          </SheetTitle>
          <SheetDescription>
            {showNumbers
              ? "Apunta tu actividad. Calculo las kcal quemadas y, si hace falta, repongo energía en los próximos días."
              : "Apunta tu actividad. Si hace falta, repongo energía en los próximos días."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">¿Qué has hecho?</Label>
            <div className="flex flex-wrap gap-2">
              {EXERCISE_ACTIVITIES.map((a) => (
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
            <Label htmlFor="exercise-min" className="text-xs text-muted-foreground">
              Minutos ({EXERCISE_MINUTES_MIN}-{EXERCISE_MINUTES_MAX})
            </Label>
            <Input
              id="exercise-min"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                setError(null);
              }}
              placeholder="30"
              className="w-28"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Intensidad</Label>
            <div className="flex gap-2">
              {EXERCISE_INTENSITY.map((i) => (
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

          {showNumbers && burn != null ? (
            <div className="rounded-2xl bg-surface px-4 py-3.5">
              <p className="font-title text-2xl leading-7 text-foreground">
                ≈ {burn} kcal quemadas
              </p>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button className="w-full" onClick={() => void save()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Guardando…
              </>
            ) : (
              "Guardar deporte"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Hoy y la lista de la compra no cambian: si hace falta, repongo energía en los próximos
            días.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
