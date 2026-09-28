import * as Sentry from "@sentry/react-native";

import { scrubSentryEvent, type SentryEventLike } from "./sentry-scrub";
import { supabase } from "./supabase";

/**
 * Errores y cierres de la app a Sentry (ticket 35 de la auditoría, región UE,
 * proyecto «react-native» de la organización peppers-41). Mismo criterio que la
 * web (`src/lib/sentry.client.ts`):
 *
 * - Solo con `EXPO_PUBLIC_SENTRY_DSN`; sin él, no se inicia nada.
 * - Solo errores: sin trazas de rendimiento, capturas de pantalla ni jerarquía
 *   de vistas (meterían datos personales).
 * - Todo evento pasa por `scrubSentryEvent` (copia de la web, vigilada por el
 *   drift check); de la persona va solo su id.
 *
 * Sin subida de source maps ni símbolos: el build lleva
 * `SENTRY_DISABLE_AUTO_UPLOAD=true` (ver mobile/AGENTS.md).
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const sentryEnabled = !!DSN;

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    environment: __DEV__ ? "development" : "production",
    beforeSend: (event) =>
      scrubSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event,
  });
  const setUser = (id: string | null | undefined) => Sentry.setUser(id ? { id } : null);
  void supabase.auth.getSession().then(({ data }) => setUser(data.session?.user.id));
  supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user.id));
}
