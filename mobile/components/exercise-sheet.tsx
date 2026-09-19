import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { apiPost } from "../lib/api";
import {
  EXERCISE_ACTIVITIES,
  EXERCISE_INTENSITY,
  EXERCISE_MINUTES_MAX,
  EXERCISE_MINUTES_MIN,
  estimateExerciseKcal,
  type DayExercise,
} from "../lib/exercise";
import { Sheet } from "./ui/sheet";

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
 * "Registrar deporte" en Hoy: mismo formato que "Añadir picoteo"
 * (`snack-sheet.tsx`), pero la cifra se calcula al instante (tabla
 * determinista, sin llamada a IA) en vez de pedirse al servidor. Se guarda
 * directo en `daily_logs.exercise`, sin pasar por el chat. Copia nativa de
 * `src/components/exercise-sheet.tsx`.
 */
export function ExerciseSheet({
  open,
  onOpenChange,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onSaved: (exercise: DayExercise) => void;
}) {
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
      const res = await apiPost<{ exercise: DayExercise }>("exercise/log", {
        today,
        activity,
        minutes: Math.round(mins),
        intensity,
      });
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
      title="Registrar deporte"
      description="Apunta tu actividad. Calculo las kcal quemadas y, si hace falta, repongo energía en los próximos días."
    >
      <View className="gap-5 px-4 pb-8 pt-2">
        <View className="gap-2">
          <Text className="text-xs text-muted-foreground">¿Qué has hecho?</Text>
          <View className="flex-row flex-wrap gap-2">
            {EXERCISE_ACTIVITIES.map((a) => (
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
            className="h-12 w-28 rounded-2xl bg-muted px-4 text-sm text-foreground"
            keyboardType="numeric"
            value={minutes}
            onChangeText={(v) => {
              setMinutes(v);
              setError(null);
            }}
            placeholder="30"
            placeholderTextColor="#83796c"
          />
        </View>

        <View className="gap-2">
          <Text className="text-xs text-muted-foreground">Intensidad</Text>
          <View className="flex-row gap-2">
            {EXERCISE_INTENSITY.map((i) => (
              <Chip
                key={i.label}
                label={i.label}
                active={intensity === i.label}
                onPress={() => setIntensity(i.label)}
              />
            ))}
          </View>
        </View>

        {burn != null ? (
          <View className="rounded-2xl bg-surface px-4 py-3.5">
            <Text className="font-heading text-foreground" style={{ fontSize: 24, lineHeight: 28 }}>
              ≈ {burn} kcal quemadas
            </Text>
          </View>
        ) : null}

        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

        <Pressable
          onPress={() => void save()}
          disabled={busy}
          className="w-full flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {busy ? "Guardando…" : "Guardar deporte"}
          </Text>
        </Pressable>
        <Text className="text-center text-xs text-muted-foreground">
          Hoy y la lista de la compra no cambian: si hace falta, repongo energía en los próximos
          días.
        </Text>
      </View>
    </Sheet>
  );
}
