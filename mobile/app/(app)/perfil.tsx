import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AlertCircle, Check, ChevronLeft, Pencil, X } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ageFromDOB } from "../../lib/age";
import { fetchProfile, saveProfile, type Profile } from "../../lib/daily";
import { energyExplanation, energyTargets } from "../../lib/energy";
import { dateLocale } from "../../lib/i18n";
import { portionExplanation, portionFactors } from "../../lib/portion";
import { showsNutritionNumbers } from "../../lib/macros";
import {
  PROFILE_SECTIONS,
  chipToValue,
  valueToChip,
  type ProfileField as Field,
} from "../../lib/profile-fields";
import { useCurrencySymbol } from "../../lib/use-money";
import type { Translate } from "../../lib/week-nav";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** La moneda del presupuesto es la del perfil; el resto de unidades, las del campo. */
const fieldUnit = (field: Field, currency: string) =>
  field.key === "budget_month_eur" ? currency : field.unit;

/** Un chip se guarda en español canónico y se pinta por su posición en la lista. */
function chipLabel(field: Field, chip: string, t: Translate) {
  const index = field.options?.indexOf(chip) ?? -1;
  return index < 0 ? chip : t(`profileFields.${String(field.key)}.options.${index}`);
}

function validate(
  field: Field,
  raw: string,
  t: Translate,
  unit: string | undefined,
): { error?: string; value?: unknown } {
  const text = raw.trim();
  if (field.kind === "number") {
    if (!text) return { value: null };
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? Infinity))
      return {
        error: `${t("perfil.errors.range", { min: field.min ?? 0, max: field.max ?? 0 })}${unit ? ` ${unit}` : ""}`,
      };
    return { value: n };
  }
  if (field.kind === "time") {
    if (!TIME_RE.test(text)) return { error: t("perfil.errors.time") };
    return { value: text };
  }
  if (field.kind === "date") {
    if (!text) return { value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: t("perfil.errors.dateFormat") };
    if (field.key === "date_of_birth") {
      const age = ageFromDOB(text);
      if (age === null || age < 12 || age > 110) return { error: t("perfil.errors.dob") };
    }
    return { value: text };
  }
  // Para chips con valueMap, convertir la etiqueta UI al valor interno.
  if (field.kind === "chips" && text) return { value: chipToValue(field, text) };
  return { value: text || null };
}

function display(
  field: Field,
  profile: Profile | null | undefined,
  t: Translate,
  unit: string | undefined,
) {
  const value = profile ? (profile[field.key] as unknown) : null;
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "time") return String(value).slice(0, 5);
  if (field.kind === "number") return `${value}${unit ? ` ${unit}` : ""}`;
  if (field.key === "date_of_birth") {
    const age = ageFromDOB(String(value));
    const [y, m, d] = String(value).split("-");
    return `${d}/${m}/${y}${age !== null ? ` · ${t("perfil.age", { count: age })}` : ""}`;
  }
  // Chips: la etiqueta de la pantalla, no el valor guardado.
  if (field.kind === "chips") return chipLabel(field, valueToChip(field, String(value)), t);
  return String(value);
}

export default function Perfil() {
  const router = useRouter();
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  // Ticket 07: de dónde sale su cifra, a la vista (solo si quiere ver cifras).
  const showNumbers = showsNutritionNumbers(profile);
  const energy = energyTargets(profile);

  const { t, i18n } = useTranslation();
  const numberLocale = dateLocale(i18n.language);
  const currency = useCurrencySymbol();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["profile"] });
      // El día de hoy depende del perfil (guía, cantidades): que se rehaga.
      qc.removeQueries({ queryKey: ["today"] });
    },
    onError: () => Alert.alert(t("common.saveError")),
  });

  const open = (field: Field) => {
    const value = profile ? (profile[field.key] as unknown) : null;
    setEditing(String(field.key));
    setError(undefined);
    const str =
      value === null || value === undefined
        ? ""
        : field.kind === "time"
          ? String(value).slice(0, 5)
          : String(value);
    // Para chips con valueMap, el draft debe ser la etiqueta UI.
    setDraft(field.kind === "chips" && field.valueMap ? valueToChip(field, str) : str);
  };

  const commit = (field: Field, raw?: string) => {
    const { error: err, value } = validate(field, raw ?? draft, t, fieldUnit(field, currency));
    if (err) {
      setError(err);
      return;
    }
    save.mutate({ [field.key]: value } as Partial<Profile>);
    setEditing(null);
  };

  const inputClass = "mt-2 h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-28 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/ajustes"))}
          className="flex-row items-center gap-1 self-start active:opacity-70"
          hitSlop={8}
        >
          <ChevronLeft size={16} color="#6b6256" />
          <Text className="text-xs font-sans-medium text-muted-foreground">
            {t("ajustes.title")}
          </Text>
        </Pressable>

        <Text className="mt-3 font-heading text-3xl text-foreground">{t("perfil.title")}</Text>
        <Text className="mt-1 text-sm text-muted-foreground">{t("perfil.intro")}</Text>

        {showNumbers && energy ? (
          <View className="mt-5 rounded-3xl bg-surface p-4">
            <Text className="px-1 text-sm font-sans-semibold text-foreground">
              {t("perfil.target.title")}
            </Text>
            <Text className="mt-2 px-1 text-sm text-foreground">
              {energyExplanation(energy, t, numberLocale)}
            </Text>
            <Text className="mt-1 px-1 text-sm text-foreground">
              {portionExplanation(portionFactors(energy, profile), t, numberLocale)}
            </Text>
            <Text className="mt-2 px-1 text-[11px] leading-4 text-muted-foreground">
              {t("perfil.target.note")}
            </Text>
          </View>
        ) : null}

        {PROFILE_SECTIONS.map((section, sectionIndex) => (
          <View key={section.title} className="mt-5 rounded-3xl bg-surface p-4">
            <Text className="px-1 text-sm font-sans-semibold text-foreground">
              {t(`perfil.sections.${sectionIndex}`)}
            </Text>
            <View className="mt-2">
              {section.fields.map((field, idx) => {
                const isEditing = editing === String(field.key);
                const shown = display(field, profile, t, fieldUnit(field, currency));
                return (
                  <View
                    key={String(field.key)}
                    className={`py-2 ${idx > 0 ? "border-t border-border" : ""}`}
                  >
                    {isEditing ? (
                      <View className="rounded-2xl bg-primary-soft/40 p-3">
                        <Text className="text-xs font-sans-medium text-foreground">
                          {t(`profileFields.${String(field.key)}.label`)}
                        </Text>
                        {field.kind === "chips" ? (
                          <View className="mt-2 flex-row flex-wrap gap-2">
                            {field.options?.map((opt) => {
                              const active = draft === opt;
                              return (
                                <Pressable
                                  key={opt}
                                  onPress={() => commit(field, opt)}
                                  className={`rounded-full px-3 py-2 active:opacity-80 ${
                                    active ? "bg-primary-soft" : "bg-surface"
                                  }`}
                                >
                                  <Text
                                    className={`text-xs capitalize ${
                                      active ? "text-primary-ink" : "text-muted-foreground"
                                    }`}
                                  >
                                    {chipLabel(field, opt, t)}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : field.kind === "long" ? (
                          <TextInput
                            autoFocus
                            multiline
                            numberOfLines={3}
                            value={draft}
                            onChangeText={setDraft}
                            placeholderTextColor="#a69d8f"
                            className="mt-2 min-h-24 w-full rounded-2xl bg-surface px-4 py-3 text-sm text-foreground"
                          />
                        ) : (
                          <TextInput
                            autoFocus
                            value={draft}
                            onChangeText={setDraft}
                            onSubmitEditing={() => commit(field)}
                            keyboardType={
                              field.kind === "number"
                                ? "decimal-pad"
                                : field.kind === "time" || field.kind === "date"
                                  ? "numbers-and-punctuation"
                                  : "default"
                            }
                            placeholder={
                              field.kind === "time"
                                ? "HH:MM"
                                : field.kind === "date"
                                  ? t("perfil.datePlaceholder")
                                  : ""
                            }
                            placeholderTextColor="#a69d8f"
                            className={inputClass}
                          />
                        )}

                        {field.help ? (
                          <Text className="mt-2 text-[11px] leading-4 text-muted-foreground">
                            {t(`profileFields.${String(field.key)}.help`)}
                          </Text>
                        ) : null}

                        {error ? (
                          <View className="mt-2 flex-row items-start gap-1">
                            <AlertCircle size={12} color="#b8433b" style={{ marginTop: 2 }} />
                            <Text className="flex-1 text-[11px] text-destructive">{error}</Text>
                          </View>
                        ) : null}

                        {field.kind !== "chips" ? (
                          <View className="mt-3 flex-row gap-2">
                            <Pressable
                              onPress={() => commit(field)}
                              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-primary py-2.5 active:opacity-90"
                            >
                              <Check size={14} color="#3e3d39" />
                              <Text className="text-xs font-sans-semibold text-primary-foreground">
                                {t("common.save")}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setEditing(null)}
                              className="flex-row items-center justify-center gap-1.5 rounded-full bg-surface px-4 py-2.5 active:opacity-80"
                            >
                              <X size={14} color="#6b6256" />
                              <Text className="text-xs font-sans-medium text-muted-foreground">
                                {t("common.cancel")}
                              </Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable onPress={() => setEditing(null)} className="mt-3">
                            <Text className="text-[11px] font-sans-medium text-muted-foreground">
                              {t("common.cancel")}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => open(field)}
                        className="flex-row items-start gap-3 rounded-2xl px-1 py-2 active:opacity-70"
                      >
                        <View className="min-w-0 flex-1">
                          <Text className="text-xs text-muted-foreground">
                            {t(`profileFields.${String(field.key)}.label`)}
                          </Text>
                          <Text
                            className={`mt-0.5 text-sm ${
                              shown ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {shown ?? t("perfil.empty")}
                          </Text>
                        </View>
                        <Pencil size={14} color="#6b6256" style={{ marginTop: 4 }} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
