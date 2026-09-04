import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { fetchProfile, saveProfile } from "@/lib/daily";
import { LOCALE_STORAGE_KEY, normalizeLocale, type Locale } from "@/lib/i18n";

/**
 * Fuente única del idioma y la moneda activos. `i18next.language` ya arranca en
 * la mejor apuesta sin perfil (elección guardada en el dispositivo → idioma del
 * navegador → `es`, resuelto una vez en `i18n.ts`); aquí solo se antepone
 * `profile.locale` cuando hay sesión.
 *
 * OJO: `locale` NO debe recalcular esa apuesta en cada render — un cambio
 * manual de idioma (toggle pre-login, RegionStep) solo pasa por
 * `i18n.changeLanguage`, y si este hook recalculara desde `localStorage`/
 * `navigator` en cada render pisaría ese cambio antes de que `setLocale`
 * llegue a persistirlo (guerra de idioma).
 *
 * Mantiene `i18next` y `<html lang>` sincronizados con el locale resuelto y
 * expone `setLocale` para el toggle pre-login (guarda en el dispositivo y, si
 * hay sesión, también en el perfil).
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
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale, i18n]);

  const setLocale = useCallback(
    async (next: Locale) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, next);
      await i18n.changeLanguage(next);
      if (typeof document !== "undefined") document.documentElement.lang = next;
      // Persistir en el perfil solo si ya hay uno (post-login). Pre-login basta
      // con el dispositivo; el RegionStep lo fija en el perfil al completarse.
      if (profile) {
        try {
          await saveProfile({ locale: next });
          await qc.invalidateQueries({ queryKey: ["profile"] });
        } catch {
          // Sin conexión o sin sesión: la elección local se mantiene igualmente.
        }
      }
    },
    [i18n, profile, qc],
  );

  return { locale, currency, setLocale };
}
