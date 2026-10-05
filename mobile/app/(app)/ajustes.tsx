import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AlertCircle, ChevronRight, Download, Info, Pencil, Users } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { RegionFields } from "../../components/region-fields";
import { apiPost } from "../../lib/api";
import { fetchAllLogs, fetchProfile, saveProfile, todayISO, type Profile } from "../../lib/daily";
import { buildHistoryCsv, historyFileName } from "../../lib/history-export";
import { clearLocalUserData } from "../../lib/local-user-data";
import { showsNutritionNumbers } from "../../lib/macros";
import { currencyForCountry, DEFAULT_COUNTRY } from "../../lib/regions";
import { supabase } from "../../lib/supabase";
import { useLocale } from "../../lib/use-locale";
import { resolveDeviceTimeZone } from "../../lib/zoned-date";

// Nota de portado (ver AGENTS.md de mobile/): respecto a la pantalla web se
// omiten dos secciones que aún no aplican en nativo:
//  - "Notificaciones" (Web Push VAPID): el push nativo va con expo-notifications,
//    diferido en el plan; se añadirá al enganchar una pantalla autenticada.
//  - "Apariencia / Tema": la app nativa usa una paleta fija (no hay theming en
//    runtime como en la web). El campo `theme` del perfil se deja intacto.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function Ajustes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const { locale, setLocale } = useLocale();

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
    onError: () => Alert.alert(t("common.saveError")),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = (key: string, message?: string) =>
    setErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const commitNumber = (
    key: "current_weight_kg" | "height_cm" | "target_weight_kg",
    raw: string,
    min: number,
    max: number,
    message: string,
    required: boolean,
  ) => {
    const text = raw.trim();
    if (!text) {
      if (required) {
        setError(key, t("ajustes.errors.required"));
        return;
      }
      setError(key);
      save.mutate({ [key]: null } as Partial<Profile>);
      return;
    }
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) {
      setError(key, message);
      return;
    }
    setError(key);
    save.mutate({ [key]: n } as Partial<Profile>);
  };

  const commitTime = (key: "morning_time" | "evening_time", raw: string) => {
    if (!TIME_RE.test(raw)) {
      setError(key, t("ajustes.errors.time"));
      return;
    }
    setError(key);
    save.mutate({ [key]: raw } as Partial<Profile>);
  };

  const missing = [
    profile && !profile.current_weight_kg ? t("ajustes.missing.weight") : null,
    profile && !profile.height_cm ? t("ajustes.missing.height") : null,
    profile && !profile.morning_time ? t("ajustes.missing.morning") : null,
    profile && !profile.evening_time ? t("ajustes.missing.evening") : null,
  ].filter(Boolean) as string[];

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    // El guardia de (app)/_layout redirige a /auth al quedarse sin sesión.
  };

  const confirmSignOut = () =>
    Alert.alert(t("ajustes.signOut.title"), t("ajustes.signOut.desc"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("ajustes.signOut.button"), style: "destructive", onPress: () => void signOut() },
    ]);

  // El historial se arma en el dispositivo con lo que la persona ya puede leer
  // (RLS: solo sus filas) y se entrega por la hoja de compartir de iOS.
  const [exporting, setExporting] = useState(false);
  const exportHistory = async () => {
    setExporting(true);
    try {
      const logs = await fetchAllLogs();
      if (!logs.length) {
        Alert.alert(t("ajustes.history.title"), t("ajustes.history.emptyBody"));
        return;
      }
      const csv = buildHistoryCsv(logs, { numbers: showsNutritionNumbers(profile) });
      // Módulo nativo: en un build anterior a su prebuild el `import()` falla,
      // y se avisa en vez de romper la pantalla (ver AGENTS.md).
      let uri: string;
      try {
        const { File, Paths } = await import("expo-file-system");
        const file = new File(Paths.cache, historyFileName(todayISO()));
        if (file.exists) file.delete();
        file.create();
        file.write(csv);
        uri = file.uri;
      } catch (error) {
        console.warn("ajustes: escribir el archivo del historial", error);
        Alert.alert(t("ajustes.history.title"), t("ajustes.history.nextVersion"));
        return;
      }
      await Share.share({ url: uri });
    } catch (error) {
      console.warn("ajustes: exportar el historial", error);
      Alert.alert(t("ajustes.history.title"), t("ajustes.history.errorBody"));
    } finally {
      setExporting(false);
    }
  };

  const [deleting, setDeleting] = useState(false);
  const removeAccount = async () => {
    setDeleting(true);
    try {
      await apiPost<{ ok: true }>("account/delete");
      await qc.cancelQueries();
      qc.clear();
      // También lo hace el listener de sesión con SIGNED_OUT; aquí, por si no llega.
      await clearLocalUserData();
      await supabase.auth.signOut();
    } catch (error) {
      Alert.alert(error instanceof Error ? error.message : t("ajustes.deleteAccount.error"));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(t("ajustes.deleteAccount.title"), t("ajustes.deleteAccount.desc"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("ajustes.deleteAccount.confirm"),
        style: "destructive",
        onPress: () => void removeAccount(),
      },
    ]);

  const inputClass = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";
  // `key` fuerza a remontar los inputs no controlados cuando llega el perfil,
  // para que `defaultValue` refleje el dato guardado y no quede en blanco.
  const seed = profile?.id ?? "loading";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-6"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="font-heading text-3xl text-foreground">{t("ajustes.title")}</Text>

        {missing.length ? (
          <View className="mt-4 flex-row items-start gap-2 rounded-2xl bg-primary-soft px-4 py-3">
            <Info size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-xs text-foreground">
              {t("ajustes.missing.text", { list: missing.join(", ") })}
            </Text>
          </View>
        ) : null}

        {/* Cuenta */}
        <Text className="mt-6 px-1 text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
          {t("ajustes.sections.account")}
        </Text>
        <View className="mt-2 overflow-hidden rounded-3xl bg-surface">
          <Pressable
            onPress={() => router.navigate("/hogar")}
            className="flex-row items-center gap-3 border-b border-border px-4 py-4 active:opacity-70"
          >
            <Users size={16} color="#6dbe7b" />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-sans-medium text-foreground">
                {t("ajustes.home.title")}
              </Text>
              <Text className="text-xs text-muted-foreground">{t("ajustes.home.desc")}</Text>
            </View>
            <ChevronRight size={16} color="#6b6256" />
          </Pressable>
          <Pressable
            onPress={() => router.navigate("/perfil")}
            className="flex-row items-center gap-3 px-4 py-4 active:opacity-70"
          >
            <Pencil size={16} color="#6dbe7b" />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-sans-medium text-foreground">
                {t("ajustes.answers.title")}
              </Text>
              <Text className="text-xs text-muted-foreground">{t("ajustes.answers.desc")}</Text>
            </View>
            <ChevronRight size={16} color="#6b6256" />
          </Pressable>
        </View>

        {/* Perfil — datos básicos */}
        <Text className="mt-6 px-1 text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
          {t("ajustes.sections.profile")}
        </Text>
        <View className="mt-2 gap-4 rounded-3xl bg-surface p-5">
          <Text className="text-sm font-sans-semibold text-foreground">
            {t("ajustes.basics.title")}
          </Text>
          <TextInput
            key={`name-${seed}`}
            defaultValue={profile?.display_name ?? ""}
            placeholder={t("ajustes.basics.name")}
            placeholderTextColor="#a69d8f"
            onEndEditing={(e) => save.mutate({ display_name: e.nativeEvent.text || null })}
            className={inputClass}
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <TextInput
                key={`weight-${seed}`}
                defaultValue={profile?.current_weight_kg?.toString() ?? ""}
                placeholder={t("ajustes.basics.weightKg")}
                placeholderTextColor="#a69d8f"
                keyboardType="decimal-pad"
                onEndEditing={(e) =>
                  commitNumber(
                    "current_weight_kg",
                    e.nativeEvent.text,
                    25,
                    350,
                    t("ajustes.errors.weight"),
                    true,
                  )
                }
                className={inputClass}
              />
              <FieldNote
                error={errors["current_weight_kg"]}
                help={t("ajustes.basics.weightHelpShort")}
              />
            </View>
            <View className="flex-1">
              <TextInput
                key={`height-${seed}`}
                defaultValue={profile?.height_cm?.toString() ?? ""}
                placeholder={t("ajustes.basics.heightCm")}
                placeholderTextColor="#a69d8f"
                keyboardType="decimal-pad"
                onEndEditing={(e) =>
                  commitNumber(
                    "height_cm",
                    e.nativeEvent.text,
                    100,
                    250,
                    t("ajustes.errors.height"),
                    true,
                  )
                }
                className={inputClass}
              />
              <FieldNote error={errors["height_cm"]} help={t("ajustes.basics.heightHelp")} />
            </View>
          </View>
          <View>
            <TextInput
              key={`target-${seed}`}
              defaultValue={profile?.target_weight_kg?.toString() ?? ""}
              placeholder={t("ajustes.basics.targetWeightKg")}
              placeholderTextColor="#a69d8f"
              keyboardType="decimal-pad"
              onEndEditing={(e) =>
                commitNumber(
                  "target_weight_kg",
                  e.nativeEvent.text,
                  30,
                  300,
                  t("ajustes.errors.targetWeight"),
                  false,
                )
              }
              className={inputClass}
            />
            <FieldNote
              error={errors["target_weight_kg"]}
              help={t("ajustes.basics.targetHelpAuto")}
            />
          </View>
        </View>

        {/* Coach */}
        <Text className="mt-6 px-1 text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
          {t("ajustes.sections.coach")}
        </Text>
        <View className="mt-2 gap-4 rounded-3xl bg-surface p-5">
          <View>
            <Text className="text-sm font-sans-semibold text-foreground">
              {t("ajustes.tone.title")}
            </Text>
            <View className="mt-3 flex-row gap-2">
              {["relajado", "neutro", "exigente"].map((tone) => {
                const active = profile?.tone === tone;
                return (
                  <Pressable
                    key={tone}
                    onPress={() => save.mutate({ tone })}
                    className={`flex-1 items-center rounded-2xl px-3 py-3 active:opacity-80 ${
                      active ? "bg-primary-soft" : "bg-secondary"
                    }`}
                  >
                    <Text
                      className={`text-sm capitalize ${active ? "text-primary-ink" : "text-foreground"}`}
                    >
                      {t(`ajustes.tone.${tone}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="pt-4">
            <Text className="text-sm font-sans-semibold text-foreground">
              {t("ajustes.reminders.title")}
            </Text>
            <View className="mt-3 flex-row gap-3">
              <View className="flex-1">
                <Text className="text-xs text-muted-foreground">
                  {t("ajustes.reminders.morning")}
                </Text>
                <TextInput
                  key={`morning-${seed}`}
                  defaultValue={profile?.morning_time?.slice(0, 5) ?? "08:00"}
                  placeholder="HH:MM"
                  placeholderTextColor="#a69d8f"
                  keyboardType="numbers-and-punctuation"
                  onEndEditing={(e) => commitTime("morning_time", e.nativeEvent.text)}
                  className={`${inputClass} mt-1`}
                />
                <FieldNote
                  error={errors["morning_time"]}
                  help={t("ajustes.reminders.morningHelp")}
                />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-muted-foreground">
                  {t("ajustes.reminders.evening")}
                </Text>
                <TextInput
                  key={`evening-${seed}`}
                  defaultValue={profile?.evening_time?.slice(0, 5) ?? "21:30"}
                  placeholder="HH:MM"
                  placeholderTextColor="#a69d8f"
                  keyboardType="numbers-and-punctuation"
                  onEndEditing={(e) => commitTime("evening_time", e.nativeEvent.text)}
                  className={`${inputClass} mt-1`}
                />
                <FieldNote
                  error={errors["evening_time"]}
                  help={t("ajustes.reminders.eveningHelp")}
                />
              </View>
            </View>
          </View>
        </View>

        {/* Idioma y región */}
        <Text className="mt-6 px-1 text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
          {t("region.settingsTitle")}
        </Text>
        <View className="mt-2 rounded-3xl bg-surface p-5">
          <Text className="text-xs text-muted-foreground">{t("region.settingsSubtitle")}</Text>
          <View className="mt-4">
            <RegionFields
              locale={locale}
              country={profile?.country ?? DEFAULT_COUNTRY.code}
              timezone={profile?.timezone ?? resolveDeviceTimeZone()}
              onLocaleChange={(next) => void setLocale(next)}
              onCountryChange={(code) =>
                save.mutate({ country: code, currency: currencyForCountry(code) })
              }
              onTimezoneChange={(tz) => save.mutate({ timezone: tz })}
            />
          </View>
        </View>

        {/* Datos y cuenta */}
        <Text className="mt-6 px-1 text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
          {t("ajustes.sections.data")}
        </Text>
        <View className="mt-2 rounded-3xl bg-surface p-5">
          <Text className="text-sm font-sans-semibold text-foreground">
            {t("ajustes.history.title")}
          </Text>
          <Text className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("ajustes.history.desc")}
          </Text>
          <Pressable
            onPress={() => void exportHistory()}
            disabled={exporting}
            className="mt-4 w-full flex-row items-center justify-center gap-2 rounded-full bg-secondary py-3 active:opacity-80"
            style={exporting ? { opacity: 0.6 } : undefined}
          >
            <Download size={16} color="#3e3d39" />
            <Text className="text-sm font-sans-medium text-foreground">
              {exporting ? t("ajustes.history.preparing") : t("ajustes.history.download")}
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={confirmSignOut}
          className="mt-3 w-full items-center rounded-full bg-surface py-4 active:opacity-80"
        >
          <Text className="text-sm font-sans-medium text-muted-foreground">
            {t("ajustes.signOut.button")}
          </Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={deleting}
          className="mt-3 w-full items-center rounded-full bg-destructive/10 py-4 active:opacity-80"
        >
          <Text className="text-sm font-sans-medium text-destructive">
            {deleting ? t("ajustes.deleteAccount.deleting") : t("ajustes.deleteAccount.button")}
          </Text>
        </Pressable>
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

function FieldNote({ error, help }: { error?: string; help: string }) {
  if (error)
    return (
      <View className="mt-1 flex-row items-start gap-1">
        <AlertCircle size={12} color="#b8433b" style={{ marginTop: 2 }} />
        <Text className="flex-1 text-[11px] text-destructive">{error}</Text>
      </View>
    );
  return <Text className="mt-1 text-[11px] text-muted-foreground">{help}</Text>;
}
