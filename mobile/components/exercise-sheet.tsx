import { useState } from "react";
import { useTranslation } from "react-i18next";
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
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
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
  showNumbers = true,
  weightKg,
  hasRoutine = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onSaved: (exercise: DayExercise) => void;
  /** `false` con la preferencia de no ver cifras (ticket 01). */
  showNumbers?: boolean;
  /** Peso de la persona: el gasto es neto y depende de él (ticket 16). */
  weightKg?: number | null;
  /** Tiene una rutina dentro de su objetivo (D9): sus sesiones no se compensan. */
  hasRoutine?: boolean;
}) {
  const { t } = useTranslation();
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
  const burn = validMinutes ? estimateExerciseKcal(activity, mins, intensity, weightKg) : null;

  const save = async () => {
    if (!validMinutes) {
      setError(
        t("exercise.minutesError", { min: EXERCISE_MINUTES_MIN, max: EXERCISE_MINUTES_MAX }),
      );
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
      setError(e instanceof Error ? e.message : t("exercise.saveFailed"));
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
      title={t("hoy.addExercise")}
      description={showNumbers ? t("exercise.descNumbers") : t("exercise.descPlain")}
    >
      <View className="gap-5 px-4 pb-8 pt-2">
        <View className="gap-2">
          <Text className="text-xs text-muted-foreground">{t("exercise.what")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {EXERCISE_ACTIVITIES.map((a) => (
              <Chip
                key={a.label}
                label={t(`exercise.activities.${a.label}`)}
                active={activity === a.label}
                onPress={() => setActivity(a.label)}
              />
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs text-muted-foreground">
            {t("exercise.minutes", { min: EXERCISE_MINUTES_MIN, max: EXERCISE_MINUTES_MAX })}
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
            placeholderTextColor="#6b6256"
          />
        </View>

        <View className="gap-2">
          <Text className="text-xs text-muted-foreground">{t("exercise.intensityLabel")}</Text>
          <View className="flex-row gap-2">
            {EXERCISE_INTENSITY.map((i) => (
              <Chip
                key={i.label}
                label={t(`exercise.intensity.${i.label}`)}
                active={intensity === i.label}
                onPress={() => setIntensity(i.label)}
              />
            ))}
          </View>
        </View>

        {showNumbers && burn != null ? (
          <View className="rounded-2xl bg-surface px-4 py-3.5">
            <Text className="font-heading text-foreground" style={{ fontSize: 24, lineHeight: 28 }}>
              {t("exercise.burned", { kcal: burn })}
            </Text>
            <Text className="mt-1 text-xs text-muted-foreground">{t("exercise.net")}</Text>
          </View>
        ) : null}

        {hasRoutine ? (
          <Text className="text-xs text-muted-foreground">{t("exercise.routineHint")}</Text>
        ) : null}

        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void save()}
          disabled={busy}
          className="w-full flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {busy ? t("common.saving") : t("exercise.save")}
          </Text>
        </Pressable>
        <Text className="text-center text-xs text-muted-foreground">{t("exercise.foot")}</Text>
      </View>
    </Sheet>
  );
}
