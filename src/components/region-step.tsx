import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { RegionFields } from "@/components/region-fields";
import { saveProfile, type Profile } from "@/lib/daily";
import { currencyForCountry, DEFAULT_COUNTRY } from "@/lib/regions";
import { useLocale } from "@/lib/use-locale";
import { resolveDeviceTimeZone } from "@/lib/zoned-date";

type Props = {
  profile: Profile | null | undefined;
  onDone: () => void;
};

/**
 * Primer paso del onboarding, antes del chat guionizado: idioma, país (deriva la
 * moneda) y zona horaria (autodetectada). Se persiste al instante para que el
 * resto del onboarding ya salga traducido y un reload conserve la elección.
 * Solo aparece mientras `profile.country` no esté fijado.
 */
export function RegionStep({ profile, onDone }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Sin perfil (o sin país fijado) `useLocale` ya expone la mejor apuesta
  // resuelta en `i18n.ts` (dispositivo / elección pre-login); no nos fiamos del
  // `profile.locale` recién creado aquí, que trae "es" por defecto de servidor.
  const { locale, setLocale: pickLocale } = useLocale();
  const [country, setCountry] = useState<string>(profile?.country ?? "");
  const [timezone, setTimezone] = useState<string>(profile?.timezone || resolveDeviceTimeZone());

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onError: () => toast.error(t("region.saveError")),
  });

  const confirm = async () => {
    const code = country || DEFAULT_COUNTRY.code;
    await save.mutateAsync({
      locale,
      country: code,
      currency: currencyForCountry(code),
      timezone,
    });
    await qc.refetchQueries({ queryKey: ["profile"] });
    onDone();
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-5 pb-6 pt-14">
      <span className="inline-flex w-fit items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
        <Globe className="h-3.5 w-3.5" /> Peppers
      </span>
      <h1 className="mt-5 font-title text-[30px] font-semibold leading-tight tracking-[-0.03em]">
        {t("region.onboardingTitle")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("region.onboardingSubtitle")}
      </p>

      <div className="mt-8 flex-1">
        <RegionFields
          locale={locale}
          country={country}
          timezone={timezone}
          onLocaleChange={pickLocale}
          onCountryChange={setCountry}
          onTimezoneChange={setTimezone}
        />
      </div>

      <button
        type="button"
        onClick={confirm}
        disabled={save.isPending}
        className="mt-8 h-13 w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {save.isPending ? t("common.loading") : t("region.continue")}
      </button>
    </main>
  );
}
