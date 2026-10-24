/**
 * Consentimiento explícito para los datos de salud (RGPD art. 9.2.a; ticket 30
 * de la auditoría). Sin él, ningún dato de salud se pregunta, se guarda ni
 * llega a la IA: el plan se hace sin ellos. Puro y sin imports: copia idéntica
 * en `mobile/lib/health-consent.ts` (drift check).
 *
 * La base de datos tiene la misma lista de columnas en su guarda
 * (`profiles_require_health_consent`, supabase/pending/ hasta que se aplique) y
 * un test comprueba que coinciden. La fecha del consentimiento la pone la base
 * de datos (`profiles_stamp_health_consent`), no el reloj del dispositivo.
 */

/**
 * Versión del texto que se acepta. Al cambiar el texto (la revisión legal), se
 * sube: a quien guarda datos de salud se le vuelve a pedir al abrir la app.
 */
export const HEALTH_CONSENT_VERSION = "2026-10";

/** Las columnas de `profiles` que son datos de salud. */
export const HEALTH_PROFILE_FIELDS = [
  "medical_conditions",
  "medications",
  "supplements",
  "pregnancy_status",
  "menstrual_cycle",
  "ed_history",
  "food_relationship",
  "past_struggles",
  "allergy_severity",
  "alcohol",
  "smoking",
] as const;

export type HealthField = (typeof HEALTH_PROFILE_FIELDS)[number];

const HEALTH_FIELD_SET: ReadonlySet<string> = new Set(HEALTH_PROFILE_FIELDS);

export const isHealthField = (key: string): key is HealthField => HEALTH_FIELD_SET.has(key);

/** Lo que estas funciones leen del perfil (vale el `Profile` de cada app). */
export type ConsentState = {
  health_consent_at?: string | null;
  health_consent_version?: string | null;
} & Partial<Record<HealthField, unknown>>;

export const hasHealthConsent = (p: ConsentState | null | undefined): boolean =>
  !!p?.health_consent_at;

const filled = (value: unknown) =>
  typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;

export const hasHealthData = (p: ConsentState | null | undefined): boolean =>
  !!p && HEALTH_PROFILE_FIELDS.some((key) => filled(p[key]));

/**
 * ¿Se le pide el consentimiento al abrir la app? A quien guarda datos de salud
 * sin él (las cuentas de antes de 2026-10) o con el de un texto anterior.
 */
export const needsHealthConsent = (p: ConsentState | null | undefined): boolean =>
  hasHealthData(p) &&
  (!hasHealthConsent(p) || p?.health_consent_version !== HEALTH_CONSENT_VERSION);

/** Lo que se guarda al aceptar (la fecha que vale la pone la base de datos). */
export const healthConsentPatch = (now: Date = new Date()) => ({
  health_consent_at: now.toISOString(),
  health_consent_version: HEALTH_CONSENT_VERSION,
});

type WithdrawalPatch = Record<HealthField | "health_consent_at" | "health_consent_version", null>;

/**
 * Lo que se guarda al retirarlo (Ajustes) o al no aceptarlo (cuentas de
 * antes): sin consentimiento y sin ningún dato de salud.
 */
export const healthWithdrawalPatch = (): WithdrawalPatch =>
  Object.fromEntries(
    [...HEALTH_PROFILE_FIELDS, "health_consent_at", "health_consent_version"].map((key) => [
      key,
      null,
    ]),
  ) as WithdrawalPatch;

/** El parche sin datos de salud: lo que se guarda sin consentimiento. */
export const withoutHealthData = <T extends object>(patch: T): Omit<T, HealthField> =>
  Object.fromEntries(Object.entries(patch).filter(([key]) => !isHealthField(key))) as Omit<
    T,
    HealthField
  >;
