import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AlertCircle, Check, ChevronLeft, Pencil, X } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ageFromDOB } from "../../lib/age";
import { fetchProfile, saveProfile, type Profile } from "../../lib/daily";
import { PROFILE_SECTIONS, type ProfileField as Field } from "../../lib/profile-fields";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(field: Field, raw: string): { error?: string; value?: unknown } {
  const text = raw.trim();
  if (field.kind === "number") {
    if (!text) return { value: null };
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? Infinity))
      return {
        error: `Indica un valor entre ${field.min} y ${field.max}${field.unit ? ` ${field.unit}` : ""}`,
      };
    return { value: n };
  }
  if (field.kind === "time") {
    if (!TIME_RE.test(text)) return { error: "Indica una hora válida (HH:MM)" };
    return { value: text };
  }
  if (field.kind === "date") {
    if (!text) return { value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: "Indica una fecha válida (AAAA-MM-DD)" };
    if (field.key === "date_of_birth") {
      const age = ageFromDOB(text);
      if (age === null || age < 12 || age > 110)
        return { error: "Indica una fecha de nacimiento real" };
    }
    return { value: text };
  }
  return { value: text || null };
}

function display(field: Field, profile: Profile | null | undefined) {
  const value = profile ? (profile[field.key] as unknown) : null;
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "time") return String(value).slice(0, 5);
  if (field.kind === "number") return `${value}${field.unit ? ` ${field.unit}` : ""}`;
  if (field.key === "date_of_birth") {
    const age = ageFromDOB(String(value));
    const [y, m, d] = String(value).split("-");
    return `${d}/${m}/${y}${age !== null ? ` · ${age} años` : ""}`;
  }
  return String(value);
}

export default function Perfil() {
  const router = useRouter();
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;

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
    onError: () => Alert.alert("No hemos podido guardar"),
  });

  const open = (field: Field) => {
    const value = profile ? (profile[field.key] as unknown) : null;
    setEditing(String(field.key));
    setError(undefined);
    setDraft(
      value === null || value === undefined
        ? ""
        : field.kind === "time"
          ? String(value).slice(0, 5)
          : String(value),
    );
  };

  const commit = (field: Field, raw?: string) => {
    const { error: err, value } = validate(field, raw ?? draft);
    if (err) {
      setError(err);
      return;
    }
    save.mutate({ [field.key]: value } as Partial<Profile>);
    setEditing(null);
  };

  const inputClass =
    "mt-2 h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground";

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
          <ChevronLeft size={16} color="#83796c" />
          <Text className="text-xs font-sans-medium text-muted-foreground">Ajustes</Text>
        </Pressable>

        <Text className="mt-3 text-3xl font-display text-foreground">Mis respuestas</Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          Toca cualquier respuesta para corregirla. No hace falta repetir el onboarding.
        </Text>

        {PROFILE_SECTIONS.map((section) => (
          <View
            key={section.title}
            className="mt-5 rounded-3xl border border-border bg-surface p-4"
          >
            <Text className="px-1 text-sm font-sans-semibold text-foreground">{section.title}</Text>
            <View className="mt-2">
              {section.fields.map((field, idx) => {
                const isEditing = editing === String(field.key);
                const shown = display(field, profile);
                return (
                  <View
                    key={String(field.key)}
                    className={`py-2 ${idx > 0 ? "border-t border-border" : ""}`}
                  >
                    {isEditing ? (
                      <View className="rounded-2xl bg-primary-soft/40 p-3">
                        <Text className="text-xs font-sans-medium text-foreground">
                          {field.label}
                        </Text>
                        {field.kind === "chips" ? (
                          <View className="mt-2 flex-row flex-wrap gap-2">
                            {field.options?.map((opt) => {
                              const active = draft === opt;
                              return (
                                <Pressable
                                  key={opt}
                                  onPress={() => commit(field, opt)}
                                  className={`rounded-full border px-3 py-2 active:opacity-80 ${
                                    active
                                      ? "border-primary bg-primary-soft"
                                      : "border-input bg-surface"
                                  }`}
                                >
                                  <Text
                                    className={`text-xs capitalize ${
                                      active ? "text-primary" : "text-muted-foreground"
                                    }`}
                                  >
                                    {opt}
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
                            className="mt-2 min-h-24 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm text-foreground"
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
                                  ? "AAAA-MM-DD"
                                  : ""
                            }
                            placeholderTextColor="#a69d8f"
                            className={inputClass}
                          />
                        )}

                        {error ? (
                          <View className="mt-2 flex-row items-start gap-1">
                            <AlertCircle size={12} color="#e2685f" style={{ marginTop: 2 }} />
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
                                Guardar
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setEditing(null)}
                              className="flex-row items-center justify-center gap-1.5 rounded-full border border-input px-4 py-2.5 active:opacity-80"
                            >
                              <X size={14} color="#83796c" />
                              <Text className="text-xs font-sans-medium text-muted-foreground">
                                Cancelar
                              </Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable onPress={() => setEditing(null)} className="mt-3">
                            <Text className="text-[11px] font-sans-medium text-muted-foreground">
                              Cancelar
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
                          <Text className="text-xs text-muted-foreground">{field.label}</Text>
                          <Text
                            className={`mt-0.5 text-sm ${
                              shown ? "text-foreground" : "italic text-muted-foreground"
                            }`}
                          >
                            {shown ?? "Sin responder — toca para añadir"}
                          </Text>
                        </View>
                        <Pencil size={14} color="#83796c" style={{ marginTop: 4 }} />
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
