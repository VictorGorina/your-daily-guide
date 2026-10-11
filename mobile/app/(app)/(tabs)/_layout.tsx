import { useQueryClient } from "@tanstack/react-query";
import { Tabs } from "expo-router";

/**
 * Las pestañas de primer nivel (ticket 40 de la auditoría, MOB-13). Antes
 * colgaban del `Stack` de `(app)/` y cada toque en la barra apilaba una
 * pantalla más; ahora cambiar de pestaña no apila nada. `chat`, `perfil` y
 * `onboarding` siguen en el `Stack` de arriba: entran por encima y se vuelve
 * con el gesto de atrás.
 *
 * Sin barra propia (`tabBar` vacío): la sigue pintando cada pantalla con
 * `BottomNav`, porque no siempre va (el modo compra de Plan ocupa toda la
 * pantalla sin ella).
 *
 * Una pestaña ya no se desmonta al salir de ella. Lo que dependía de montarse
 * de nuevo va al foco: aquí, volver a pedir lo caducado (lo que React Query
 * hacía al montar); en cada pantalla, lo suyo (`useFocusEffect`).
 */
export default function TabsLayout() {
  const qc = useQueryClient();
  return (
    <Tabs
      backBehavior="none"
      tabBar={() => null}
      screenOptions={{ headerShown: false }}
      screenListeners={{
        // `cancelRefetch: false`: en el primer foco la pantalla ya está pidiendo
        // lo suyo, y no se corta para pedirlo otra vez.
        focus: () =>
          void qc.refetchQueries({ type: "active", stale: true }, { cancelRefetch: false }),
      }}
    />
  );
}
