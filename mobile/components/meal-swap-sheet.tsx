import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { DictateButton } from "./dictate-button";
import { Sheet } from "./ui/sheet";

/**
 * Mini-sheet de "Comí otra cosa" en Hoy. Pide solo qué ha comido (texto libre)
 * y ofrece saltarse la comida; el cambio se aplica directamente al plan, sin
 * pasar por el chat. Copia nativa de `src/components/meal-swap-sheet.tsx`.
 */
export function MealSwapSheet({
  open,
  onOpenChange,
  mealLabel,
  plannedDish,
  onSwap,
  onSkip,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mealLabel: string;
  plannedDish: string;
  onSwap: (dish: string) => void;
  onSkip: () => void;
  /** Bloquea solo mientras se guarda ESTA comida. */
  disabled?: boolean;
}) {
  const [what, setWhat] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setWhat("");
    setError(null);
  };

  const submit = () => {
    const desc = what.trim();
    if (desc.length < 2) {
      setError("Escribe qué has comido.");
      return;
    }
    onSwap(desc);
    reset();
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Comí distinto"
    >
      <View className="gap-4 px-4 pb-8">
        {plannedDish ? (
          <Text className="text-sm text-muted-foreground">
            En vez de <Text className="line-through">{plannedDish}</Text>, ¿qué has comido?
          </Text>
        ) : (
          <Text className="text-sm text-muted-foreground">
            ¿Qué has comido en {mealLabel.toLowerCase()}?
          </Text>
        )}

        <View className="relative">
          <TextInput
            placeholder="Ej: Una pizza margarita con ensalada"
            placeholderTextColor="#a8a096"
            value={what}
            onChangeText={(t) => {
              setWhat(t);
              if (error) setError(null);
            }}
            multiline
            editable={!disabled}
            className="min-h-[64px] rounded-2xl bg-secondary px-3.5 py-3 pr-11 text-sm text-foreground"
          />
          <DictateButton
            onText={(t) => setWhat((prev) => (prev ? `${prev} ${t}` : t))}
            className="absolute right-2 top-2"
          />
        </View>

        {error ? <Text className="text-xs text-destructive">{error}</Text> : null}

        <Pressable
          onPress={submit}
          disabled={disabled || !what.trim()}
          className={`h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary active:opacity-90 ${
            disabled || !what.trim() ? "opacity-60" : ""
          }`}
        >
          {disabled ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-sm font-semibold text-primary-foreground">
            {disabled ? "Cambiando…" : "Cambiar"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            onSkip();
            reset();
            onOpenChange(false);
          }}
          disabled={disabled}
          className="items-center py-1 active:opacity-70"
        >
          <Text className="text-sm font-medium text-muted-foreground">Me lo salté</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
