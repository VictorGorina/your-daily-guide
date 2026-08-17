import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CoachFab } from "@/components/coach-fab";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Sesión LOCAL, sin llamada de red: getUser() revalidaba el token contra el
    // servidor de Auth en cada navegación, y en el arranque en frío justo tras
    // el registro (token aún no adjunto) esa carrera dejaba la pantalla en
    // blanco. getSession() lee el JWT ya almacenado; RLS sigue protegiendo cada
    // consulta en el servidor.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw redirect({ to: "/auth" });
    return { user: data.session.user };
  },
  component: () => (
    <>
      <Outlet />
      {/* Burbuja flotante del coach: visible en toda la app autenticada.
          Se oculta a sí misma (ver coach-fab.tsx) mientras el onboarding
          no esté completo, así que no aparece durante /onboarding. */}
      <CoachFab />
    </>
  ),
});
