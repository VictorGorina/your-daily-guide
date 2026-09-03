import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { addChild, removeChild, updateChild, type HouseholdChild } from "../lib/household";
import { childPortion, type Appetite } from "../lib/household-shared";
import { Sheet } from "./ui/sheet";

const INPUT = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";
const FIELD = "text-[11px] font-sans-semibold uppercase tracking-[0.06em] text-muted-foreground";

const APPETITES: readonly [Appetite, string][] = [
  ["poco", "Poco"],
  ["normal", "Normal"],
  ["mucho", "Mucho"],
];

type Draft = {
  name: string;
  age: string;
  appetite: Appetite;
  allergies: string;
  notes: string;
};

const emptyDraft: Draft = { name: "", age: "", appetite: "normal", allergies: "", notes: "" };

const toDraft = (c: HouseholdChild): Draft => ({
  name: c.name,
  age: c.age != null ? String(c.age) : "",
  appetite: (c.appetite as Appetite) ?? "normal",
  allergies: c.allergies ?? "",
  notes: c.notes ?? "",
});

/**
 * Panel inferior para dar de alta o editar a un peque de la casa. Equivalente RN
 * de `src/components/child-sheet.tsx`. Solo escribe columnas que ya existen en
 * `household_children`; la ración se recalcula con `childPortion` al guardar.
 */
export function ChildSheet({
  open,
  child,
  householdId,
  onClose,
}: {
  open: boolean;
  child: HouseholdChild | null;
  householdId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (open) setDraft(child ? toDraft(child) : emptyDraft);
  }, [open, child]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const ageValue = () => {
    const n = Number(draft.age.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const age = ageValue();
      const payload = {
        name: draft.name.trim(),
        age,
        allergies: draft.allergies.trim() || null,
        appetite: draft.appetite,
        portion: childPortion(age, draft.appetite),
        notes: draft.notes.trim() || null,
      };
      if (child) await updateChild(child.id, payload);
      else await addChild(householdId, payload);
    },
    onSuccess: () => {
      Alert.alert(child ? "Peque actualizado" : "Peque añadido");
      refresh();
      onClose();
    },
    onError: () => Alert.alert("No hemos podido guardar"),
  });

  const drop = useMutation({
    mutationFn: () => removeChild(child!.id),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: () => Alert.alert("No hemos podido quitarlo"),
  });

  const confirmDrop = () =>
    Alert.alert(
      "¿Quitar de la familia?",
      `${child?.name ?? "Este peque"} dejará de estar en casa.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Quitar", style: "destructive", onPress: () => drop.mutate() },
      ],
    );

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={child ? draft.name || "Peque" : "Nuevo peque"}
      description="Sus datos ayudan a que los menús de casa le sirvan también."
    >
      <View className="mt-4 gap-4">
        <View className="flex-row gap-2.5">
          <View className="flex-1 gap-1.5">
            <Text className={FIELD}>Nombre</Text>
            <TextInput
              className={INPUT}
              value={draft.name}
              onChangeText={(t) => patch({ name: t })}
              placeholder="Nombre"
              placeholderTextColor="#a69d8f"
            />
          </View>
          <View className="w-24 gap-1.5">
            <Text className={FIELD}>Edad</Text>
            <TextInput
              className={INPUT}
              value={draft.age}
              onChangeText={(t) => patch({ age: t })}
              placeholder="—"
              placeholderTextColor="#a69d8f"
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View className="gap-1.5">
          <Text className={FIELD}>Apetito</Text>
          <View className="flex-row gap-1.5 rounded-full bg-muted p-1">
            {APPETITES.map(([key, label]) => {
              const active = draft.appetite === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => patch({ appetite: key })}
                  className={`flex-1 items-center rounded-full py-2 ${active ? "bg-surface" : ""}`}
                >
                  <Text
                    className={`text-[13px] font-sans-medium ${
                      active ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-1.5">
          <Text className={FIELD}>Alergias e intolerancias</Text>
          <TextInput
            className={INPUT}
            value={draft.allergies}
            onChangeText={(t) => patch({ allergies: t })}
            placeholder="Ninguna"
            placeholderTextColor="#a69d8f"
          />
        </View>

        <View className="gap-1.5">
          <Text className={FIELD}>Notas</Text>
          <TextInput
            className={`${INPUT} h-auto py-3`}
            value={draft.notes}
            onChangeText={(t) => patch({ notes: t })}
            placeholder="Ej. come en el cole de lunes a viernes"
            placeholderTextColor="#a69d8f"
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

      <Pressable
        onPress={() => save.mutate()}
        disabled={save.isPending || !draft.name.trim()}
        className="mt-5 items-center rounded-full bg-primary py-3.5 active:opacity-90"
        style={save.isPending || !draft.name.trim() ? { opacity: 0.6 } : undefined}
      >
        <Text className="text-sm font-sans-semibold text-primary-foreground">
          {save.isPending ? "Guardando..." : "Guardar"}
        </Text>
      </Pressable>

      {child ? (
        <Pressable
          onPress={confirmDrop}
          disabled={drop.isPending}
          className="mt-2 flex-row items-center justify-center gap-2 rounded-full py-3 active:opacity-70"
        >
          <Trash2 size={16} color="#83796c" />
          <Text className="text-[13px] font-sans-medium text-muted-foreground">
            Quitar de la familia
          </Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}
