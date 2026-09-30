import * as Sentry from "@sentry/react-native";
import { router, type ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

import i18n from "../lib/i18n";
import { sentryEnabled } from "../lib/sentry";

/**
 * Pantalla de un error de render (ticket 27 de la auditoría, MOB-10). Sin ella,
 * un error pintando una pantalla la dejaba en blanco. Mismo texto que la de la
 * web (`errorComponent` en src/routes/__root.tsx).
 *
 * La exportan como `ErrorBoundary` el layout raíz y el de `(app)`. Aquí se
 * avisa a Sentry a mano: el error ya lo ha parado el boundary de expo-router, así
 * que no sube hasta el `Sentry.wrap` de la raíz.
 *
 * El del layout raíz se pinta EN LUGAR de ese layout, sin sus providers
 * (i18next, safe area, React Query): por eso `i18n.t` directo, márgenes fijos y
 * sin botón «Inicio», que no tendría navegación a la que ir.
 */
export function ErrorFallback({
  error,
  retry,
  showHome,
}: ErrorBoundaryProps & { showHome: boolean }) {
  useEffect(() => {
    console.error(error);
    if (sentryEnabled) Sentry.captureException(error);
  }, [error]);

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-center font-heading text-2xl text-foreground">
        {i18n.t("errorScreen.title")}
      </Text>
      <Text className="mt-2 text-center text-sm text-muted-foreground">
        {i18n.t(showHome ? "errorScreen.body" : "errorScreen.bodyRoot")}
      </Text>
      <View className="mt-6 flex-row flex-wrap justify-center gap-2">
        <Pressable
          onPress={() => void retry()}
          accessibilityRole="button"
          className="rounded-full bg-primary px-5 py-2.5 active:opacity-80"
        >
          <Text className="text-sm font-sans-medium text-primary-foreground">
            {i18n.t("errorScreen.retry")}
          </Text>
        </Pressable>
        {showHome ? (
          <Pressable
            onPress={() => {
              router.replace("/");
              void retry();
            }}
            accessibilityRole="button"
            className="rounded-full bg-secondary px-5 py-2.5 active:opacity-80"
          >
            <Text className="text-sm font-sans-medium text-foreground">
              {i18n.t("errorScreen.home")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
