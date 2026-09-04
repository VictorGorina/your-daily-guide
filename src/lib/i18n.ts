import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import es from "@/locales/es.json";

/**
 * Infraestructura i18n de la web. La app móvil tiene su propia copia en
 * `mobile/lib/i18n.ts` con la misma forma de catálogo (no hay código compartido,
 * igual que la paleta de color).
 *
 * Regla transversal (ver el plan de país/idioma): SOLO el texto libre se traduce.
 * La salida estructurada de la IA (`DAY_NAMES`, slots de comida, categorías de
 * compra) se queda en español canónico porque está persistida en `monthly_plans`
 * y se cruza entre miembros de un hogar. La capa de render mapea esos enums a
 * etiquetas del idioma activo vía este catálogo (Fase 3).
 */

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

/** Normaliza cualquier etiqueta de idioma ("en-GB", "ES", undefined) a un locale soportado. */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const short = (raw ?? "").toLowerCase().split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(short)
    ? (short as Locale)
    : DEFAULT_LOCALE;
}

/** Idioma del navegador, para preseleccionar antes de conocer el perfil (pre-login y RegionStep). */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const nav = navigator as Navigator;
  return normalizeLocale(nav.language ?? nav.languages?.[0]);
}

/** Clave de `localStorage` donde se guarda la elección de idioma hecha en el dispositivo. */
export const LOCALE_STORAGE_KEY = "peppers.locale";

/**
 * Mejor apuesta de idioma sin perfil: elección guardada en el dispositivo →
 * idioma del navegador → `es`. La usan el toggle pre-login y el RegionStep para
 * preseleccionar (un perfil ya configurado siempre manda sobre esto).
 */
export function guessLocale(): Locale {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return normalizeLocale(stored);
  }
  return detectBrowserLocale();
}

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources: {
      es: { translation: es },
      en: { translation: en },
    },
    // SSR siempre arranca en `es` (no hay `navigator` en el servidor); el cliente
    // se autocorrige justo debajo antes del primer render de React. De ahí en
    // adelante `i18next.language` es la fuente viva — `useLocale` la respeta en
    // vez de recalcular la mejor apuesta en cada render (eso causaba una guerra
    // de idioma con cualquier cambio manual, p. ej. el toggle del RegionStep).
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  if (typeof window !== "undefined") {
    const guess = guessLocale();
    if (guess !== DEFAULT_LOCALE) void i18next.changeLanguage(guess);
  }
}

export default i18next;
