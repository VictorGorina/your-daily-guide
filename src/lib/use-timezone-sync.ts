import { useEffect } from "react";

import { saveProfile, type Profile } from "@/lib/daily";
import { resolveDeviceTimeZone } from "@/lib/zoned-date";

/**
 * Si la persona ha viajado (o el perfil trae la zona por defecto de antes de
 * esta feature), se actualiza `profiles.timezone` en silencio para que el push
 * del servidor siga usando su hora local. Barato: solo escribe si cambia.
 */
export function useTimezoneSync(profile: Profile | null | undefined) {
  const onboarded = profile?.onboarding_completed;
  const storedTz = profile?.timezone;
  useEffect(() => {
    if (!onboarded) return;
    const deviceTz = resolveDeviceTimeZone();
    if (deviceTz && storedTz !== deviceTz) {
      // Best-effort: si la escritura falla no pasa nada, se reintenta en la
      // siguiente carga de Hoy.
      saveProfile({ timezone: deviceTz }).catch((error) =>
        console.warn("hoy: guardar zona horaria", error),
      );
    }
  }, [onboarded, storedTz]);
}
