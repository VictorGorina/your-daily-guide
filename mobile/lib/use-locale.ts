import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { fetchProfile, saveProfile } from "./daily";
import { LOCALE_STORAGE_KEY, normalizeLocale, type Locale } from "./i18n";

/**
 * Fuente única del idioma y la moneda activos en la app nativa. Copia de
 * `src/lib/use-locale.ts` de la web. Orden de resolución: `profile.locale` (si
 * hay sesión) → idioma activo de i18next (dispositivo o elección guardada,
 * resuelto en `i18n.ts`) → `es`.
 *
 * `setLocale` es para el toggle pre-login: guarda en el dispositivo y, si ya hay
 * perfil, también en él. El RegionStep del onboarding lo fija en el perfil.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;

  const locale: Locale = normalizeLocale(profile?.locale ?? i18n.language);
  const currency = profile?.currency ?? "EUR";

  useEffect(() => {
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [locale, i18n]);

  const setLocale = useCallback(
    async (next: Locale) => {
      void AsyncStorage.setItem(LOCALE_STORAGE_KEY, next);
      await i18n.changeLanguage(next);
      if (profile) {
        try {
          await saveProfile({ locale: next });
          await qc.invalidateQueries({ queryKey: ["profile"] });
        } catch {
          // Sin conexión: la elección local se mantiene igualmente.
        }
      }
    },
    [i18n, profile, qc],
  );

  return { locale, currency, setLocale };
}
