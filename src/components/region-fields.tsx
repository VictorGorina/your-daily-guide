import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";
import { SUPPORTED_COUNTRIES } from "@/lib/regions";

type Props = {
  locale: Locale;
  country: string;
  timezone: string;
  onLocaleChange: (locale: Locale) => void;
  onCountryChange: (code: string) => void;
  /** Si se pasa, la zona horaria deja de ser solo lectura y ofrece un enlace "cambiar". */
  onTimezoneChange?: (tz: string) => void;
};

/** Comprueba que una cadena es una zona IANA que el runtime entiende. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clúster de controles de idioma / país / zona horaria. Lo comparten el
 * `RegionStep` del onboarding y la sección "Idioma y región" de Ajustes.
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

  const tzOptions = useMemo(() => {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    try {
      return supported ? supported("timeZone") : [];
    } catch {
      return [];
    }
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <span className="block text-xs font-medium text-muted-foreground">
          {t("region.languageLabel")}
        </span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SUPPORTED_LOCALES.map((l) => {
            const active = locale === l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => onLocaleChange(l)}
                aria-pressed={active}
                className={`rounded-2xl px-3 py-3 text-sm font-medium transition-colors ${
                  active ? "bg-foreground text-background" : "bg-secondary text-foreground"
                }`}
              >
                {t(`languages.${l}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="block text-xs font-medium text-muted-foreground">
          {t("region.countryLabel")}
        </span>
        <ul className="mt-2 space-y-2">
          {SUPPORTED_COUNTRIES.map((c) => {
            const active = country === c.code;
            return (
              <li key={c.code}>
                <button
                  type="button"
                  onClick={() => onCountryChange(c.code)}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm transition-colors ${
                    active ? "bg-primary-soft text-primary" : "bg-secondary text-foreground"
                  }`}
                >
                  <span className="font-medium">{t(`countries.${c.code}`)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.currency}
                    {active ? <Check className="h-4 w-4 text-primary" /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <span className="block text-xs font-medium text-muted-foreground">
          {t("region.timezoneLabel")}
        </span>
        {editingTz && onTimezoneChange ? (
          <div className="mt-2">
            <input
              autoFocus
              list="peppers-tz-list"
              value={tzDraft}
              onChange={(e) => setTzDraft(e.target.value)}
              onBlur={() => {
                const next = tzDraft.trim();
                if (next && isValidTimeZone(next)) onTimezoneChange(next);
                else setTzDraft(timezone);
                setEditingTz(false);
              }}
              className="h-11 w-full rounded-2xl bg-muted px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
            {tzOptions.length ? (
              <datalist id="peppers-tz-list">
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between rounded-2xl bg-secondary px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{timezone}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("region.timezoneAuto")}
              </span>
            </span>
            {onTimezoneChange ? (
              <button
                type="button"
                onClick={() => {
                  setTzDraft(timezone);
                  setEditingTz(true);
                }}
                className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("common.change")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
