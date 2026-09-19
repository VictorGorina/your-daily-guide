import { useMutation } from "@tanstack/react-query";
import { Check, Plane } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { DictateButton } from "./dictate-button";
import { apiPost } from "../lib/api";
import { monthTitle, type MonthConstraints } from "../lib/plan-shared";

type AwayPreset = "no" | "few" | "week";

const PRESETS: { key: AwayPreset; label: string }[] = [
  { key: "no", label: "No" },
  { key: "few", label: "Unos días" },
  { key: "week", label: "Una semana o más" },
];

// Tolera cualquier separador y ambos órdenes (DD/MM/AAAA o AAAA-MM-DD) — no
// hay selector nativo de fecha instalado, así que sigue el mismo patrón que
// el date-input de texto libre en onboarding.tsx.
const parseDatePretty = (pretty: string): string | null => {
  const parts = pretty.trim().split(/\D+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  const [y, mo, d] = a.length === 4 ? [a, b, c] : [c, b, a];
  if (y.length !== 4 || mo.length > 2 || d.length > 2) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

/**
 * Un par de preguntas rápidas antes de crear el plan de un mes: si la persona
 * va a estar fuera de casa (viaje, etc.) y cualquier otra cosa que convenga
 * saber, con texto libre y dictado. Se muestra una sola vez por mes — la fila
 * que guarda `setMonthConstraints` (aunque quede vacía si se pasa de largo)
 * es la marca de que ya se preguntó, y quien llama decide cuándo mostrar esto
 * (`needsConstraints` en la pantalla Plan). Réplica de
 * `src/components/month-constraints-gate.tsx` (web) sin selector nativo de
 * fecha: las fechas se escriben como texto, igual que la fecha de nacimiento
 * en el onboarding móvil.
 */
export function MonthConstraintsGate({ month, onDone }: { month: string; onDone: () => void }) {
  const [preset, setPreset] = useState<AwayPreset>("no");
  const [awayStartText, setAwayStartText] = useState("");
  const [awayEndText, setAwayEndText] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: (data: Pick<MonthConstraints, "awayStart" | "awayEnd" | "notes">) =>
      apiPost<MonthConstraints>("plan/constraints", { month, ...data }),
    onSuccess: onDone,
    onError: (e) =>
      Alert.alert(e instanceof Error ? e.message : "No hemos podido guardar esto ahora mismo"),
  });

  const hasRange = preset !== "no";

  const submit = () => {
    if (!hasRange) {
      mutation.mutate({ awayStart: null, awayEnd: null, notes: notes.trim() || null });
      return;
    }
    const awayStart = parseDatePretty(awayStartText);
    const awayEnd = parseDatePretty(awayEndText);
    if (!awayStart || !awayEnd || awayStart > awayEnd) {
      Alert.alert(
        "Revisa las fechas",
        "Escríbelas como DD/MM/AAAA, la de inicio antes que la de fin.",
      );
      return;
    }
    mutation.mutate({ awayStart, awayEnd, notes: notes.trim() || null });
  };

  const skip = () => mutation.mutate({ awayStart: null, awayEnd: null, notes: null });

  return (
    <View className="mt-8 gap-4 rounded-3xl bg-surface p-6">
      <View className="items-center">
        <Plane size={28} color="#ff8a3d" />
        <Text className="mt-3 text-sm font-sans-semibold text-foreground">
          Antes de crear el plan de {monthTitle(month)}
        </Text>
        <Text className="mt-1.5 text-center text-sm text-muted-foreground">
          Dos preguntas rápidas para que el plan lo tenga en cuenta.
        </Text>
      </View>

      <View>
        <Text className="mb-2 text-sm font-sans-medium text-foreground">
          ¿Vas a estar fuera de casa algún tramo?
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {PRESETS.map(({ key, label }) => {
            const active = preset === key;
            return (
              <Pressable
                key={key}
                onPress={() => setPreset(key)}
                disabled={mutation.isPending}
                className={`min-h-[44px] flex-row items-center gap-1.5 rounded-full px-4 active:opacity-80 ${
                  active ? "bg-foreground" : "bg-muted"
                }`}
              >
                {active ? <Check size={14} color="#fbfaf7" /> : null}
                <Text
                  className={`text-[13.5px] ${
                    active
                      ? "font-sans-semibold text-primary-foreground"
                      : "font-sans-medium text-foreground"
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {hasRange ? (
          <View className="mt-3 flex-row items-center gap-2">
            <TextInput
              editable={!mutation.isPending}
              value={awayStartText}
              onChangeText={setAwayStartText}
              keyboardType="numbers-and-punctuation"
              placeholder="Desde DD/MM/AAAA"
              placeholderTextColor="#83796c"
              className="min-h-[44px] flex-1 rounded-xl bg-muted px-3 text-sm text-foreground"
            />
            <Text className="text-sm text-muted-foreground">a</Text>
            <TextInput
              editable={!mutation.isPending}
              value={awayEndText}
              onChangeText={setAwayEndText}
              keyboardType="numbers-and-punctuation"
              placeholder="Hasta DD/MM/AAAA"
              placeholderTextColor="#83796c"
              className="min-h-[44px] flex-1 rounded-xl bg-muted px-3 text-sm text-foreground"
            />
          </View>
        ) : null}
      </View>

      <View>
        <Text className="mb-2 text-sm font-sans-medium text-foreground">
          ¿Algo más que debamos saber?
        </Text>
        <View className="rounded-3xl bg-muted p-2">
          <TextInput
            editable={!mutation.isPending}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Opcional: eventos, cambios de rutina..."
            placeholderTextColor="#83796c"
            className="min-h-[44px] px-2 py-2 text-sm text-foreground"
            textAlignVertical="top"
          />
          <View className="flex-row items-center px-1">
            <DictateButton onText={(t) => setNotes((v) => (v.trim() ? `${v.trim()} ${t}` : t))} />
          </View>
        </View>
      </View>

      <View className="gap-2">
        <Pressable
          onPress={submit}
          disabled={mutation.isPending}
          className="w-full items-center rounded-full bg-primary py-4 active:opacity-90"
          style={mutation.isPending ? { opacity: 0.6 } : undefined}
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {mutation.isPending ? "Guardando..." : "Continuar"}
          </Text>
        </Pressable>
        <Pressable
          onPress={skip}
          disabled={mutation.isPending}
          className="w-full items-center py-2 active:opacity-70"
        >
          <Text className="text-xs font-sans-medium text-muted-foreground">Ahora no</Text>
        </Pressable>
      </View>
    </View>
  );
}
