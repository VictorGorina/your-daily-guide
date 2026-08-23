import { Activity, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Sheet } from "./ui/sheet";

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

export function GuidedLogSheet({
  onSend,
  onSkip,
  disabled,
  open,
  onOpenChange,
  mode = "meal",
  contextNote,
}: {
  onSend: (text: string) => void;
  /** Se llama cuando el usuario pulsa "Me lo salté" dentro del sheet de comida. */
  onSkip?: () => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "meal" = comí distinto + me lo salté; "activity" = registro de actividad física. */
  mode?: "meal" | "activity";
  /** Línea de contexto opcional (p.ej. qué comida se está detallando). */
  contextNote?: string;
}) {
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

    if (mode === "activity") {
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
    onOpenChange(false);
  };

  const title = mode === "activity" ? "Registrar actividad" : "Comí distinto";
  const description =
    mode === "activity"
      ? "Apunta tu actividad física y ajusto los días futuros del plan."
      : "Cuéntame qué has comido y ajusto los días futuros del plan.";

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title={title}
      description={description}
    >
      <View className="gap-5 pb-8 pt-4">
        {contextNote ? (
          <Text className="text-xs font-sans-medium text-primary">{contextNote}</Text>
        ) : null}

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
              <Text className="text-xs text-muted-foreground">Minutos (5-360)</Text>
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
          </>
        ) : (
          <>
            {onSkip ? (
              <Pressable
                onPress={() => {
                  onSkip();
                  reset();
                  onOpenChange(false);
                }}
                className="flex-row items-center gap-3 rounded-2xl bg-secondary/60 px-4 py-3 active:opacity-80"
              >
                <X size={16} color="#83796c" />
                <View className="flex-1">
                  <Text className="text-sm font-sans-medium text-foreground">Me lo salté</Text>
                  <Text className="text-xs text-muted-foreground">
                    No he comido nada en esta comida
                  </Text>
                </View>
              </Pressable>
            ) : null}

            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">¿Qué has comido?</Text>
              <View className="flex-row flex-wrap gap-2">
                {EXCESS_PRESETS.map((p) => (
                  <Chip key={p} label={p} active={what === p} onPress={() => setWhat(p)} />
                ))}
              </View>
              <TextInput
                className="min-h-[80px] rounded-2xl bg-muted px-4 py-3 text-sm text-foreground"
                multiline
                textAlignVertical="top"
                value={what}
                onChangeText={setWhat}
                placeholder="Por ejemplo: he comido pizza y postre en una comida familiar"
                placeholderTextColor="#83796c"
              />
            </View>

            <View className="gap-2">
              <Text className="text-xs text-muted-foreground">
                Kcal extra aproximadas (opcional, 50-3000)
              </Text>
              <TextInput
                className="h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                keyboardType="numeric"
                value={kcal}
                onChangeText={setKcal}
                placeholder="Si no lo sabes, déjalo vacío"
                placeholderTextColor="#83796c"
              />
            </View>
          </>
        )}

        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

        <Pressable
          onPress={submit}
          disabled={disabled}
          className="w-full items-center rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-60"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            Enviar al coach y ajustar plan
          </Text>
        </Pressable>
        <Text className="text-center text-xs text-muted-foreground">
          Hoy queda fijado; solo cambian los días futuros y la lista de la compra no varía.
        </Text>
      </View>
    </Sheet>
  );
}
