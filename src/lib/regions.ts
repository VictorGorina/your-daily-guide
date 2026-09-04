import type { Locale } from "@/lib/i18n";

/**
 * Lista corta y curada de países soportados (ampliable). Cada país deriva su
 * moneda y un idioma por defecto; el nombre visible sale del catálogo i18n
 * (`countries.<code>`). La app móvil mantiene su propia copia en
 * `mobile/lib/regions.ts` — misma forma, dos copias.
 */

export type Country = {
  /** ISO-3166 alpha-2. Se guarda en `profiles.country`. */
  code: string;
  /** ISO-4217. Se guarda en `profiles.currency`; `budget_month_eur` pasa a interpretarse en ella. */
  currency: string;
  /** Idioma que se preselecciona al elegir el país si el dispositivo no da una pista mejor. */
  defaultLocale: Locale;
};

export const SUPPORTED_COUNTRIES: Country[] = [
  { code: "ES", currency: "EUR", defaultLocale: "es" },
  { code: "MX", currency: "MXN", defaultLocale: "es" },
  { code: "GB", currency: "GBP", defaultLocale: "en" },
  { code: "IE", currency: "EUR", defaultLocale: "en" },
  { code: "US", currency: "USD", defaultLocale: "en" },
];

export const DEFAULT_COUNTRY = SUPPORTED_COUNTRIES[0]!;

export function findCountry(code: string | null | undefined): Country | undefined {
  return SUPPORTED_COUNTRIES.find((c) => c.code === code);
}

/** Moneda de un país soportado, con EUR de reserva para códigos desconocidos. */
export function currencyForCountry(code: string | null | undefined): string {
  return findCountry(code)?.currency ?? "EUR";
}
