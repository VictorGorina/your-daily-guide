import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Profile } from "../lib/daily";
import { saveProfile } from "../lib/daily";
import { normalizeLocale, type Locale } from "../lib/i18n";
import { currencyForCountry, DEFAULT_COUNTRY } from "../lib/regions";
import { resolveDeviceTimeZone } from "../lib/zoned-date";
import { RegionFields } from "./region-fields";

type Props = {
  profile: Profile | null | undefined;
  onDone: () => void;
};

/**
 * Primer paso del onboarding, antes del chat guionizado. Copia RN de
 * `region-step.tsx` de la web — mismo comportamiento: se persiste al instante y
 * solo aparece mientras `profile.country` no esté fijado.
 */
export function RegionStep({ profile, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  // El dispositivo (o una elección guardada) ya lo resolvió i18next al arrancar
  // — ver `lib/i18n.ts`. Un perfil recién creado trae `locale: "es"` por defecto
  // de servidor, así que no nos fiamos de `profile` aquí.
  const [locale, setLocale] = useState<Locale>(normalizeLocale(i18n.language));
  const [country, setCountry] = useState<string>(profile?.country ?? "");
  const [timezone, setTimezone] = useState<string>(profile?.timezone || resolveDeviceTimeZone());
  const [saving, setSaving] = useState(false);

  const save = useMutation({ mutationFn: (patch: Partial<Profile>) => saveProfile(patch) });

  const pickLocale = (next: Locale) => {
    setLocale(next);
    void i18n.changeLanguage(next);
  };

  const confirm = async () => {
    const code = country || DEFAULT_COUNTRY.code;
    setSaving(true);
    try {
      await save.mutateAsync({
        locale,
        country: code,
        currency: currencyForCountry(code),
        timezone,
      });
      await qc.refetchQueries({ queryKey: ["profile"] });
      onDone();
    } catch {
      Alert.alert(t("region.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="px-5 pb-6 pt-6" keyboardShouldPersistTaps="handled">
        <View className="w-fit flex-row items-center gap-2 self-start rounded-full bg-primary-soft px-3 py-1">
          <Globe size={14} color="#6dbe7b" />
          <Text className="text-xs font-sans-medium text-primary">Peppers</Text>
        </View>
        <Text className="mt-5 font-heading text-[28px] leading-tight text-foreground">
          {t("region.onboardingTitle")}
        </Text>
        <Text className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("region.onboardingSubtitle")}
        </Text>

        <View className="mt-8">
          <RegionFields
            locale={locale}
            country={country}
            timezone={timezone}
            onLocaleChange={pickLocale}
            onCountryChange={setCountry}
            onTimezoneChange={setTimezone}
          />
        </View>

        <Pressable
          onPress={confirm}
          disabled={saving}
          className="mt-8 items-center rounded-full bg-primary py-4 active:opacity-80 disabled:opacity-60"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {saving ? t("common.loading") : t("region.continue")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
