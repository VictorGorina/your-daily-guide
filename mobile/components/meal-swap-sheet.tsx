import { BLOCKED_FOOD_MESSAGE, isCleanFood } from "../lib/content-guard";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import {
  PORTION_SIZE_LABEL,
  PORTION_SIZES,
  textMentionsQuantity,
  type PortionSize,
} from "../lib/portion";
import { DictateButton } from "./dictate-button";
import { Sheet } from "./ui/sheet";

/** Lo que responde el cambio: si el texto es vago, la hoja pide concretar. */
export type MealSwapResult = { ok: true } | { ok: false; vague: boolean; message: string };

/**
 * Mini-sheet de "Comí otra cosa" en Hoy. Pide solo qué ha comido (texto libre)
 * y ofrece saltarse la comida; el cambio se aplica directamente al plan, sin
 * pasar por el chat. Copia nativa de `src/components/meal-swap-sheet.tsx`.
 *
 * Si el texto no dice qué se comió ("algo rápido"), la hoja se queda abierta,
 * pide concretar y ofrece apuntar las kcal a mano (ticket 13, D13).
 */
export function MealSwapSheet({
  open,
  onOpenChange,
  mealLabel,
  plannedDish,
  onSwap,
  onSkip,
  disabled,
  showNumbers = true,
  defaultSize = "normal",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mealLabel: string;
  plannedDish: string;
  onSwap: (
    dish: string,
    opts?: { manualKcal?: number; size?: PortionSize },
  ) => Promise<MealSwapResult>;
  onSkip: () => void;
  /** Bloquea solo mientras se guarda ESTA comida. */
  disabled?: boolean;
  /** `false` con la preferencia de no ver cifras: sin la opción de kcal a mano. */
  showNumbers?: boolean;
  /** El tamaño que suele elegir (`learnedPortionSize`): viene preseleccionado. */
  defaultSize?: PortionSize;
}) {
  const [what, setWhat] = useState("");
  const [size, setSize] = useState<PortionSize>(defaultSize);
  const [error, setError] = useState<string | null>(null);
  /** El servidor dijo que el texto es vago: se ofrece apuntar las kcal a mano. */
  const [vague, setVague] = useState(false);
  const [kcal, setKcal] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setWhat("");
    setError(null);
    setVague(false);
    setKcal("");
    setSize(defaultSize);
  };

  const send = async (desc: string, manualKcal?: number) => {
    setBusy(true);
    try {
      const result = await onSwap(
        desc,
        manualKcal != null ? { manualKcal } : textMentionsQuantity(desc) ? undefined : { size },
      );
      if (result.ok) {
        reset();
        onOpenChange(false);
        return;
      }
      setVague(result.vague);
      setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const desc = what.trim();
    if (desc.length < 2) {
      setError("Escribe qué has comido.");
      return;
    }
    if (!isCleanFood(desc)) {
      setError(BLOCKED_FOOD_MESSAGE);
      return;
    }
    void send(desc);
  };

  const submitManual = () => {
    const value = Number(kcal.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || value > 5000) {
      setError("Escribe las kcal aproximadas, entre 1 y 5000.");
      return;
    }
    void send(what.trim(), Math.round(value));
  };

  const locked = !!disabled || busy;

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
              if (vague) setVague(false);
            }}
            multiline
            editable={!locked}
            className="min-h-[64px] rounded-2xl bg-secondary px-3.5 py-3 pr-11 text-sm text-foreground"
          />
          <DictateButton
            onText={(t) => setWhat((prev) => (prev ? `${prev} ${t}` : t))}
            className="absolute right-2 top-2"
          />
        </View>

        {!textMentionsQuantity(what) ? (
          <View className="gap-1.5">
            <View className="flex-row gap-2" accessibilityRole="radiogroup">
              {PORTION_SIZES.map((s) => (
                <Pressable
                  key={s}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: size === s }}
                  onPress={() => setSize(s)}
                  disabled={locked}
                  className={`rounded-full px-3 py-1.5 ${size === s ? "bg-primary" : "bg-secondary"}`}
                >
                  <Text
                    className={`text-xs ${
                      size === s ? "text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {PORTION_SIZE_LABEL[s]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-[11px] text-muted-foreground">
              {defaultSize === "grande"
                ? "Sueles servirte más: lo he dejado en grande."
                : defaultSize === "pequena"
                  ? "Sueles servirte menos: lo he dejado en pequeño."
                  : "Sobre tu ración de siempre."}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text className={`text-xs ${vague ? "text-muted-foreground" : "text-destructive"}`}>
            {error}
          </Text>
        ) : null}

        {vague && showNumbers ? (
          <View className="gap-2 rounded-2xl bg-surface p-3">
            <Text className="text-xs text-muted-foreground">
              ¿Prefieres apuntar las calorías tú? Cuentan tal cual las escribas.
            </Text>
            <View className="flex-row gap-2">
              <TextInput
                keyboardType="number-pad"
                placeholder="kcal aproximadas"
                placeholderTextColor="#a8a096"
                value={kcal}
                onChangeText={setKcal}
                editable={!locked}
                className="h-11 flex-1 rounded-xl bg-secondary px-3 text-sm text-foreground"
              />
              <Pressable
                onPress={submitManual}
                disabled={locked || !kcal.trim()}
                className={`h-11 items-center justify-center rounded-xl bg-secondary px-4 active:opacity-80 ${
                  locked || !kcal.trim() ? "opacity-60" : ""
                }`}
              >
                <Text className="text-sm font-semibold text-foreground">Apuntar</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={locked || !what.trim()}
          className={`h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary active:opacity-90 ${
            locked || !what.trim() ? "opacity-60" : ""
          }`}
        >
          {locked ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-sm font-semibold text-primary-foreground">
            {locked ? "Cambiando…" : "Cambiar"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            onSkip();
            reset();
            onOpenChange(false);
          }}
          disabled={locked}
          className="items-center py-1 active:opacity-70"
        >
          <Text className="text-sm font-medium text-muted-foreground">Me lo salté</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
