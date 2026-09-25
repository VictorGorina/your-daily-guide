import { Activity, Cookie } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { apiPost } from "../lib/api";
import { todayISO } from "../lib/daily";
import {
  EXERCISE_ACTIVITIES as ACTIVITIES,
  EXERCISE_INTENSITY as INTENSITY,
  EXERCISE_MINUTES_MAX,
  EXERCISE_MINUTES_MIN,
  type DayExercise,
  type ExerciseEntry,
} from "../lib/exercise";
import type { SnackEntry } from "../lib/snacks";
import { SnackForm } from "./snack-sheet";
import { Sheet } from "./ui/sheet";

type Mode = "activity" | "snack";

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1.5 active:opacity-80 ${
        active ? "bg-primary" : "bg-secondary"
      }`}
    >
      <Text className={`text-xs ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Registro guiado del chat. Las dos pestañas guardan en el día lo mismo que Hoy
 * —"Registrar deporte" (`/api/v1/exercise/log`) y "Añadir picoteo"
 * (`SnackForm`)— y NO le piden al coach que lo compense: quien lo abre programa
 * el asentamiento del día (`scheduleDaySettle`), que suma el día entero una
 * sola vez. Antes las dos acababan en `ajustar_plan_mensual` con una cifra
 * estimada por el modelo, que decidía por origen (ver `day-log-ack.ts`).
 *
 * "Picoteo o extra" es lo que se come ENCIMA del plan. Una comida del plan
 * cambiada por otra no va aquí: apuntarla entera como extra contaría también la
 * comida planeada que sustituyó. Esa va por "Comí otra cosa" en Hoy o por el
 * coach (`cambiar_plato`), que miden la diferencia con lo planeado. Mismo
 * criterio que la web (src/components/guided-log-sheet.tsx).
 */
export function GuidedLogSheet({
  open,
  onOpenChange,
  onExerciseLogged,
  onSnackLogged,
  disabled,
  showNumbers = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExerciseLogged: (entry: ExerciseEntry) => void;
  onSnackLogged: (entry: SnackEntry) => void;
  disabled?: boolean;
  /** Preferencia de ver cifras (ticket 01), para la pestaña de picoteo. */
  showNumbers?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("activity");

  // Actividad
  const [activity, setActivity] = useState(ACTIVITIES[0]!.label);
  const [minutes, setMinutes] = useState("30");
  const [intensity, setIntensity] = useState(INTENSITY[1]!.label);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Al cerrar se vuelve a la primera pestaña, como al abrirlo la primera vez.
  const reset = () => {
    setMode("activity");
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
      setError(`Indica entre ${EXERCISE_MINUTES_MIN} y ${EXERCISE_MINUTES_MAX} minutos.`);
      return;
    }
    setSaving(true);
    try {
      const { entry } = await apiPost<{ exercise: DayExercise; entry: ExerciseEntry }>(
        "exercise/log",
        { today: todayISO(), activity, minutes: Math.round(mins), intensity },
      );
      onExerciseLogged(entry);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No he podido guardar el deporte.");
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Registro guiado"
      description={
        mode === "activity"
          ? "Apunta tu actividad física. Queda en tu día, como en «Registrar deporte», y si hace falta repongo energía en los próximos días."
          : "Apunta lo que has comido fuera del plan. Queda en tu día, como en «Añadir picoteo», y si hace falta ajusto los próximos días."
      }
    >
      <View className="gap-5 pb-8 pt-4">
        <View className="flex-row gap-2">
          {(
            [
              { value: "activity", label: "Actividad", Icon: Activity },
              { value: "snack", label: "Picoteo o extra", Icon: Cookie },
            ] as const
          ).map(({ value, label, Icon }) => {
            const active = mode === value;
            return (
              <Pressable
                key={value}
                onPress={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2 active:opacity-80 ${
                  active ? "bg-primary/10" : "bg-secondary"
                }`}
              >
                <Icon size={16} color={active ? "#3e3d39" : "#83796c"} />
                <Text className={`text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "activity" ? (
          <>
            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">¿Qué has hecho?</Text>
              <View className="flex-row flex-wrap gap-2">
                {ACTIVITIES.map((a) => (
                  <Chip
                    key={a.label}
                    label={a.label}
                    active={activity === a.label}
                    onPress={() => setActivity(a.label)}
                  />
                ))}
              </View>
            </View>

            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">
                Minutos ({EXERCISE_MINUTES_MIN}-{EXERCISE_MINUTES_MAX})
              </Text>
              <TextInput
                className="h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                keyboardType="numeric"
                value={minutes}
                onChangeText={setMinutes}
                placeholder="30"
                placeholderTextColor="#83796c"
              />
            </View>

            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">Intensidad</Text>
              <View className="flex-row gap-2">
                {INTENSITY.map((i) => (
                  <Chip
                    key={i.label}
                    label={i.label}
                    active={intensity === i.label}
                    onPress={() => setIntensity(i.label)}
                  />
                ))}
              </View>
            </View>

            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

            <Pressable
              onPress={() => void saveActivity()}
              disabled={disabled || saving}
              className="w-full flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
            >
              {saving ? <ActivityIndicator size="small" color="#3e3d39" /> : null}
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {saving ? "Guardando…" : "Guardar deporte"}
              </Text>
            </Pressable>
            <Text className="text-center text-xs text-muted-foreground">
              Hoy y la lista de la compra no cambian: si hace falta, repongo energía en los próximos
              días.
            </Text>
          </>
        ) : (
          <>
            <Text className="rounded-2xl bg-secondary/60 px-4 py-3 text-xs leading-snug text-muted-foreground">
              ¿Comiste otra cosa en lugar de una comida del plan? Cámbiala en Hoy con «Comí otra
              cosa» o cuéntamelo en el chat: así cuento solo la diferencia con lo planeado.
            </Text>
            <SnackForm
              today={todayISO()}
              showNumbers={showNumbers}
              onSaved={(_snacks, entry) => {
                onSnackLogged(entry);
                reset();
                onOpenChange(false);
              }}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}
