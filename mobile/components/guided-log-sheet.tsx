import { Activity, Cookie } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setError(
        t("exercise.minutesError", { min: EXERCISE_MINUTES_MIN, max: EXERCISE_MINUTES_MAX }),
      );
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
      setError(e instanceof Error ? e.message : t("exercise.saveFailed"));
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
      title={t("chat.guided.title")}
      description={mode === "activity" ? t("chat.guided.descActivity") : t("chat.guided.descSnack")}
    >
      <View className="gap-5 pb-8 pt-4">
        <View className="flex-row gap-2">
          {(
            [
              { value: "activity", label: t("chat.guided.tabActivity"), Icon: Activity },
              { value: "snack", label: t("chat.guided.tabSnack"), Icon: Cookie },
            ] as const
          ).map(({ value, label, Icon }) => {
            const active = mode === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={value}
                onPress={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2 active:opacity-80 ${
                  active ? "bg-primary/10" : "bg-secondary"
                }`}
              >
                <Icon size={16} color={active ? "#3e3d39" : "#6b6256"} />
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
              <Text className="text-xs text-muted-foreground">{t("exercise.what")}</Text>
              <View className="flex-row flex-wrap gap-2">
                {ACTIVITIES.map((a) => (
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
                className="h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                keyboardType="numeric"
                value={minutes}
                onChangeText={setMinutes}
                placeholder="30"
                placeholderTextColor="#6b6256"
              />
            </View>

            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">{t("exercise.intensityLabel")}</Text>
              <View className="flex-row gap-2">
                {INTENSITY.map((i) => (
                  <Chip
                    key={i.label}
                    label={t(`exercise.intensity.${i.label}`)}
                    active={intensity === i.label}
                    onPress={() => setIntensity(i.label)}
                  />
                ))}
              </View>
            </View>

            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => void saveActivity()}
              disabled={disabled || saving}
              className="w-full flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
            >
              {saving ? <ActivityIndicator size="small" color="#3e3d39" /> : null}
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {saving ? t("common.saving") : t("exercise.save")}
              </Text>
            </Pressable>
            <Text className="text-center text-xs text-muted-foreground">{t("exercise.foot")}</Text>
          </>
        ) : (
          <>
            <Text className="rounded-2xl bg-secondary/60 px-4 py-3 text-xs leading-snug text-muted-foreground">
              {t("chat.guided.swapHint")}
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
