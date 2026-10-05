import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { addChild, removeChild, updateChild, type HouseholdChild } from "../lib/household";
import {
  childRation,
  cleanFeedingStage,
  type Appetite,
  type FeedingStage,
} from "../lib/household-shared";
import { Sheet } from "./ui/sheet";

const INPUT = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";
const FIELD = "text-[11px] font-sans-semibold uppercase tracking-[0.06em] text-muted-foreground";

const APPETITES: readonly Appetite[] = ["poco", "normal", "mucho"];

const STAGES: readonly FeedingStage[] = ["pecho", "triturados", "mesa"];

type Draft = {
  name: string;
  age: string;
  appetite: Appetite;
  stage: FeedingStage;
  allergies: string;
  notes: string;
};

const emptyDraft: Draft = {
  name: "",
  age: "",
  appetite: "normal",
  stage: "mesa",
  allergies: "",
  notes: "",
};

const toDraft = (c: HouseholdChild): Draft => ({
  name: c.name,
  age: c.age != null ? String(c.age) : "",
  appetite: (c.appetite as Appetite) ?? "normal",
  stage: cleanFeedingStage(c.feeding_stage),
  allergies: c.allergies ?? "",
  notes: c.notes ?? "",
});

/**
 * Panel inferior para dar de alta o editar a un peque de la casa. Equivalente RN
 * de `src/components/child-sheet.tsx`. Solo escribe columnas que ya existen en
 * `household_children`; la ración se recalcula con `childRation` al guardar.
 */
export function ChildSheet({
  open,
  child,
  householdId,
  onClose,
  onChanged,
}: {
  open: boolean;
  child: HouseholdChild | null;
  householdId: string;
  onClose: () => void;
  /** Se llama tras guardar o quitar un peque, para programar el recálculo del plan (issue 05). */
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
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
        feeding_stage: draft.stage,
        portion: childRation(draft.stage, age, draft.appetite),
        notes: draft.notes.trim() || null,
      };
      if (child) await updateChild(child.id, payload);
      else await addChild(householdId, payload);
    },
    onSuccess: () => {
      Alert.alert(child ? t("childSheet.updated") : t("childSheet.added"));
      refresh();
      onChanged?.();
      onClose();
    },
    onError: () => Alert.alert(t("childSheet.saveFailed")),
  });

  const drop = useMutation({
    mutationFn: () => removeChild(child!.id),
    onSuccess: () => {
      refresh();
      onChanged?.();
      onClose();
    },
    onError: () => Alert.alert(t("childSheet.removeFailed")),
  });

  const confirmDrop = () =>
    Alert.alert(
      t("childSheet.confirmTitle"),
      t("childSheet.confirmText", { name: child?.name ?? t("childSheet.thisChild") }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("hogar.roster.remove"), style: "destructive", onPress: () => drop.mutate() },
      ],
    );

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={child ? draft.name || t("childSheet.fallbackName") : t("childSheet.newTitle")}
      description={t("childSheet.description")}
    >
      <View className="mt-4 gap-4">
        <View className="flex-row gap-2.5">
          <View className="flex-1 gap-1.5">
            <Text className={FIELD}>{t("childSheet.name")}</Text>
            <TextInput
              className={INPUT}
              value={draft.name}
              onChangeText={(v) => patch({ name: v })}
              placeholder={t("childSheet.name")}
              placeholderTextColor="#a69d8f"
            />
          </View>
          <View className="w-24 gap-1.5">
            <Text className={FIELD}>{t("childSheet.age")}</Text>
            <TextInput
              className={INPUT}
              value={draft.age}
              onChangeText={(v) => patch({ age: v })}
              placeholder="—"
              placeholderTextColor="#a69d8f"
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View className="gap-1.5">
          <Text className={FIELD}>{t("childSheet.stage")}</Text>
          <View className="gap-1.5">
            {STAGES.map((key) => {
              const active = draft.stage === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => patch({ stage: key })}
                  className={`rounded-2xl px-4 py-2.5 ${active ? "bg-primary-soft" : "bg-muted"}`}
                >
                  <Text
                    className={`text-[13px] font-sans-medium ${
                      active ? "text-primary-ink" : "text-muted-foreground"
                    }`}
                  >
                    {t(`feedingStage.${key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {draft.stage !== "mesa" ? (
            <Text className="text-[11.5px] leading-relaxed text-muted-foreground">
              {t(`childSheet.stageHint.${draft.stage}`)}
            </Text>
          ) : null}
        </View>

        {draft.stage === "mesa" ? (
          <View className="gap-1.5">
            <Text className={FIELD}>{t("childSheet.appetite")}</Text>
            <View className="flex-row gap-1.5 rounded-full bg-muted p-1">
              {APPETITES.map((key) => {
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
                      {t(`appetite.${key}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View className="gap-1.5">
          <Text className={FIELD}>{t("childSheet.allergies")}</Text>
          <TextInput
            className={INPUT}
            value={draft.allergies}
            onChangeText={(v) => patch({ allergies: v })}
            placeholder={t("childSheet.allergiesNone")}
            placeholderTextColor="#a69d8f"
          />
        </View>

        <View className="gap-1.5">
          <Text className={FIELD}>{t("childSheet.notes")}</Text>
          <TextInput
            className={`${INPUT} h-auto py-3`}
            value={draft.notes}
            onChangeText={(v) => patch({ notes: v })}
            placeholder={t("childSheet.notesPlaceholder")}
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
          {save.isPending ? t("childSheet.saving") : t("common.save")}
        </Text>
      </Pressable>

      {child ? (
        <Pressable
          onPress={confirmDrop}
          disabled={drop.isPending}
          className="mt-2 flex-row items-center justify-center gap-2 rounded-full py-3 active:opacity-70"
        >
          <Trash2 size={16} color="#6b6256" />
          <Text className="text-[13px] font-sans-medium text-muted-foreground">
            {t("childSheet.remove")}
          </Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}
