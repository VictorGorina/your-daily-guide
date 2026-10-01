import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import es from "../locales/es.json";

/**
 * Infraestructura i18n de la app nativa. Copia de `src/lib/i18n.ts` de la web
 * (no hay código compartido, igual que la paleta de color). El catálogo
 * `locales/{es,en}.json` tiene exactamente las mismas claves que el de la web
 * — lo comprueba `scripts/check-shared-drift.sh`.
 *
 * Regla transversal: SOLO el texto libre se traduce. Los enums estructurales de
 * la IA (`DAY_NAMES`, slots de comida, categorías de compra) se quedan en
 * español canónico porque están persistidos en `monthly_plans` y se cruzan entre
 * miembros de un hogar.
 */

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

/** Clave de AsyncStorage donde se guarda la elección de idioma hecha en la app. */
export const LOCALE_STORAGE_KEY = "peppers.locale";

/** Normaliza cualquier etiqueta de idioma ("en-GB", "ES", undefined) a un locale soportado. */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const short = (raw ?? "").toLowerCase().split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(short)
    ? (short as Locale)
    : DEFAULT_LOCALE;
}

/**
 * B0 del ticket 34: la interfaz está casi toda en español, así que el inglés
 * solo se ofrece con la variable encendida (cuando la traducción esté
 * completa). Quien ya lo tenga elegido lo conserva y puede volver a español.
 */
export const ENGLISH_ENABLED = process.env.EXPO_PUBLIC_I18N_EN === "1";

export function offeredLocales(englishEnabled: boolean, current: Locale): readonly Locale[] {
  return englishEnabled || current === "en" ? SUPPORTED_LOCALES : [DEFAULT_LOCALE];
}

/** `lang` del documento: la lengua real del texto (español mientras no esté traducido). */
export function htmlLang(locale: Locale, englishEnabled: boolean): Locale {
  return englishEnabled ? locale : DEFAULT_LOCALE;
}

/** Idioma detectado del navegador o del dispositivo, sin colar el inglés antes de tiempo. */
export function detectedLocale(raw: string | null | undefined, englishEnabled: boolean): Locale {
  return englishEnabled ? normalizeLocale(raw) : DEFAULT_LOCALE;
}

/**
 * Idioma del reconocimiento de voz (ticket 34): el de la persona y, si el país
 * tiene variante propia, la suya (el acento de México se reconoce mejor con
 * `es-MX`). Sin dato, español de España, como antes.
 */
export function dictationLang(
  locale: string | null | undefined,
  country: string | null | undefined,
): string {
  const lang = normalizeLocale(locale);
  const c = (country ?? "").toUpperCase();
  if (lang === "en") return c === "GB" || c === "IE" ? `en-${c}` : "en-US";
  return c === "MX" || c === "US" ? `es-${c}` : "es-ES";
}

/** Idioma del dispositivo (síncrono en expo-localization), para el arranque y el RegionStep. */
export function detectDeviceLocale(): Locale {
  try {
    const first = getLocales()[0];
    return detectedLocale(first?.languageTag ?? first?.languageCode, ENGLISH_ENABLED);
  } catch {
    return DEFAULT_LOCALE;
  }
}

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources: {
      es: { translation: es },
      en: { translation: en },
    },
    // El idioma del dispositivo ya en el primer frame; una elección previa
    // guardada en la app lo pisa en cuanto AsyncStorage responde (abajo).
    lng: detectDeviceLocale(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  void AsyncStorage.getItem(LOCALE_STORAGE_KEY).then((stored) => {
    if (stored && stored !== i18next.language) void i18next.changeLanguage(normalizeLocale(stored));
  });
}

export default i18next;
