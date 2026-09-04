import { Check } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";

import { SUPPORTED_LOCALES, type Locale } from "../lib/i18n";
import { SUPPORTED_COUNTRIES } from "../lib/regions";

type Props = {
  locale: Locale;
  country: string;
  timezone: string;
  onLocaleChange: (locale: Locale) => void;
  onCountryChange: (code: string) => void;
  /** Si se pasa, la zona horaria deja de ser solo lectura y ofrece un enlace "cambiar". */
  onTimezoneChange?: (tz: string) => void;
};

/** Comprueba que una cadena es una zona IANA que Hermes entiende. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clúster de controles de idioma / país / zona horaria. Copia RN del
 * `region-fields.tsx` de la web — lo comparten el `RegionStep` del onboarding y
 * la sección "Idioma y región" de Ajustes.
 */
export function RegionFields({
  locale,
  country,
  timezone,
  onLocaleChange,
  onCountryChange,
  onTimezoneChange,
}: Props) {
  const { t } = useTranslation();
  const [editingTz, setEditingTz] = useState(false);
  const [tzDraft, setTzDraft] = useState(timezone);

  return (
    <View className="gap-5">
      <View>
        <Text className="text-xs font-sans-medium text-muted-foreground">
          {t("region.languageLabel")}
        </Text>
        <View className="mt-2 flex-row gap-2">
          {SUPPORTED_LOCALES.map((l) => {
            const active = locale === l;
            return (
              <Pressable
                key={l}
                onPress={() => onLocaleChange(l)}
                className={`flex-1 items-center rounded-2xl px-3 py-3 active:opacity-80 ${
                  active ? "bg-foreground" : "bg-secondary"
                }`}
              >
                <Text
                  className={`text-sm font-sans-medium ${active ? "text-background" : "text-foreground"}`}
                >
                  {t(`languages.${l}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <Text className="text-xs font-sans-medium text-muted-foreground">
          {t("region.countryLabel")}
        </Text>
        <View className="mt-2 gap-2">
          {SUPPORTED_COUNTRIES.map((c) => {
            const active = country === c.code;
            return (
              <Pressable
                key={c.code}
                onPress={() => onCountryChange(c.code)}
                className={`flex-row items-center justify-between rounded-2xl px-4 py-3 active:opacity-80 ${
                  active ? "bg-primary-soft" : "bg-secondary"
                }`}
              >
                <Text
                  className={`text-sm font-sans-medium ${active ? "text-primary" : "text-foreground"}`}
                >
                  {t(`countries.${c.code}`)}
                </Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs text-muted-foreground">{c.currency}</Text>
                  {active ? <Check size={16} color="#6dbe7b" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        <Text className="text-xs font-sans-medium text-muted-foreground">
          {t("region.timezoneLabel")}
        </Text>
        {editingTz && onTimezoneChange ? (
          <TextInput
            autoFocus
            value={tzDraft}
            onChangeText={setTzDraft}
            onBlur={() => {
              const next = tzDraft.trim();
              if (next && isValidTimeZone(next)) onTimezoneChange(next);
              else setTzDraft(timezone);
              setEditingTz(false);
            }}
            className="mt-2 h-11 rounded-2xl bg-muted px-4 text-sm text-foreground"
          />
        ) : (
          <View className="mt-2 flex-row items-center justify-between rounded-2xl bg-secondary px-4 py-3">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={1} className="text-sm font-sans-medium text-foreground">
                {timezone}
              </Text>
              <Text className="text-[11px] text-muted-foreground">{t("region.timezoneAuto")}</Text>
            </View>
            {onTimezoneChange ? (
              <Pressable
                onPress={() => {
                  setTzDraft(timezone);
                  setEditingTz(true);
                }}
              >
                <Text className="text-xs font-sans-medium text-primary">{t("common.change")}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
