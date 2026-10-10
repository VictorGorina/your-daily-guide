import { useEffect } from "react";

import { saveProfile, type Profile } from "./daily";
import { resolveDeviceTimeZone } from "./zoned-date";

/**
 * Mantiene `profiles.timezone` al día (viajes, o perfiles anteriores a la
 * feature) para que el push del servidor use la hora local. Solo escribe si
 * cambia.
 */
export function useTimezoneSync(profile: Profile | null | undefined) {
  const onboarded = profile?.onboarding_completed;
  const storedTz = profile?.timezone;
  useEffect(() => {
    if (!onboarded) return;
    const deviceTz = resolveDeviceTimeZone();
    if (deviceTz && storedTz !== deviceTz) {
      // Best-effort: si falla se reintenta en la siguiente carga del perfil.
      saveProfile({ timezone: deviceTz }).catch(() => {});
    }
  }, [onboarded, storedTz]);
}
