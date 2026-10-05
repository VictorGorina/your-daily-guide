import { useServerFn } from "@tanstack/react-start";
import { Activity, ClipboardList, Cookie, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SnackForm } from "@/components/snack-sheet";
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
import { todayISO } from "@/lib/daily";
import {
  EXERCISE_ACTIVITIES as ACTIVITIES,
  EXERCISE_INTENSITY as INTENSITY,
  EXERCISE_MINUTES_MAX,
  EXERCISE_MINUTES_MIN,
  type ExerciseEntry,
} from "@/lib/exercise";
import { logExercise } from "@/lib/exercise.functions";
import type { SnackEntry } from "@/lib/snacks";

type Mode = "actividad" | "picoteo";

function chipClass(active: boolean) {
  return `rounded-full px-3 py-1.5 text-xs transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
  }`;
}

/**
 * Registro guiado del chat. Las dos pestañas guardan en el día lo mismo que Hoy
 * —"Registrar deporte" (`logExercise`) y "Añadir picoteo" (`SnackForm`)— y NO le
 * piden al coach que lo compense: quien lo abre programa el asentamiento del
 * día (`scheduleDaySettle`), que suma el día entero una sola vez. Antes las dos
 * acababan en `ajustar_plan_mensual` con una cifra estimada por el modelo, que
 * decidía por origen (ver `day-log-ack.ts`).
 *
 * "Picoteo o extra" es lo que se come ENCIMA del plan. Una comida del plan
 * cambiada por otra no va aquí: apuntarla entera como extra contaría también la
 * comida planeada que sustituyó. Esa va por "Comí otra cosa" en Hoy o por el
 * coach (`cambiar_plato`), que miden la diferencia con lo planeado.
 */
export function GuidedLogSheet({
  onExerciseLogged,
  onSnackLogged,
  disabled,
  showNumbers = true,
}: {
  onExerciseLogged: (entry: ExerciseEntry) => void;
  onSnackLogged: (entry: SnackEntry) => void;
  disabled?: boolean;
  /** Preferencia de ver cifras (ticket 01), para la pestaña de picoteo. */
  showNumbers?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("actividad");

  // Actividad
  const [activity, setActivity] = useState(ACTIVITIES[0]!.label);
  const [minutes, setMinutes] = useState("30");
  const [intensity, setIntensity] = useState(INTENSITY[1]!.label);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const logFn = useServerFn(logExercise);

  // Al cerrar se vuelve a la primera pestaña, como al abrirlo la primera vez.
  const reset = () => {
    setMode("actividad");
    setMinutes("30");
    setIntensity(INTENSITY[1]!.label);
    setError(null);
    setSaving(false);
  };

  // Mismo camino que "Registrar deporte" en Hoy (`exercise-sheet.tsx`): el
  // servidor calcula las kcal y decide qué parte es extra; el cliente no manda
  // ninguna cifra.
  const saveActivity = async () => {
    setError(null);
    const mins = Number(minutes.replace(",", "."));
    if (!Number.isFinite(mins) || mins < EXERCISE_MINUTES_MIN || mins > EXERCISE_MINUTES_MAX) {
      setError(
        t("exercise.minutesError", { min: EXERCISE_MINUTES_MIN, max: EXERCISE_MINUTES_MAX }),
      );
      return;
    }
    setSaving(true);
    try {
      const { entry } = await logFn({
        data: { today: todayISO(), activity, minutes: Math.round(mins), intensity },
      });
      onExerciseLogged(entry);
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("exercise.saveFailed"));
      setSaving(false);
    }
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
          {t("chat.guided.title")}
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            {t("chat.guided.title")}
          </SheetTitle>
          <SheetDescription>
            {mode === "actividad" ? t("chat.guided.descActivity") : t("chat.guided.descSnack")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("actividad");
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm ${
                mode === "actividad"
                  ? "bg-primary/10 text-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              <Activity className="size-4" aria-hidden />
              {t("chat.guided.tabActivity")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("picoteo");
                setError(null);
              }}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm ${
                mode === "picoteo"
                  ? "bg-primary/10 text-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              <Cookie className="size-4" aria-hidden />
              {t("chat.guided.tabSnack")}
            </button>
          </div>

          {mode === "actividad" ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t("exercise.what")}</Label>
                <div className="flex flex-wrap gap-2">
                  {ACTIVITIES.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => setActivity(a.label)}
                      className={chipClass(activity === a.label)}
                    >
                      {t(`exercise.activities.${a.label}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="glog-min" className="text-xs text-muted-foreground">
                  {t("exercise.minutes", { min: EXERCISE_MINUTES_MIN, max: EXERCISE_MINUTES_MAX })}
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
                <Label className="text-xs text-muted-foreground">
                  {t("exercise.intensityLabel")}
                </Label>
                <div className="flex gap-2">
                  {INTENSITY.map((i) => (
                    <button
                      key={i.label}
                      type="button"
                      onClick={() => setIntensity(i.label)}
                      className={chipClass(intensity === i.label)}
                    >
                      {t(`exercise.intensity.${i.label}`)}
                    </button>
                  ))}
                </div>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <Button
                className="w-full"
                onClick={() => void saveActivity()}
                disabled={disabled || saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    {t("common.saving")}
                  </>
                ) : (
                  t("exercise.save")
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("exercise.foot")}</p>
            </>
          ) : (
            <>
              <p className="rounded-2xl bg-secondary/60 px-4 py-3 text-xs leading-snug text-muted-foreground">
                {t("chat.guided.swapHint")}
              </p>
              <SnackForm
                today={todayISO()}
                showNumbers={showNumbers}
                onSaved={(_snacks, entry) => {
                  onSnackLogged(entry);
                  reset();
                  setOpen(false);
                }}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
