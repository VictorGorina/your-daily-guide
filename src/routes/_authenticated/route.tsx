import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { CoachFab } from "@/components/coach-fab";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
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
