import * as Sentry from "@sentry/react";

import { supabase } from "@/integrations/supabase/client";
import { scrubSentryEvent, type SentryEventLike } from "@/lib/sentry-scrub";

/**
 * Errores del navegador a Sentry (ticket 35 de la auditoría, región UE). Se
 * carga con `import()` desde `__root.tsx` y solo si hay `VITE_SENTRY_DSN`: sin
 * DSN, este chunk ni se descarga.
 *
 * Solo errores: sin trazas de rendimiento ni grabación de sesiones (no hacen
 * falta y meterían datos personales). Todo evento pasa por `scrubSentryEvent`;
 * de la persona va solo su id.
 */
export function initSentry(dsn: string): void {
  Sentry.init({
    dsn,
    // Nada de la persona por defecto (primera red); `scrubSentryEvent`, la segunda.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    environment: import.meta.env.MODE,
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event,
  });
  const setUser = (id: string | null | undefined) => Sentry.setUser(id ? { id } : null);
  void supabase.auth.getSession().then(({ data }) => setUser(data.session?.user.id));
  supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user.id));
}
