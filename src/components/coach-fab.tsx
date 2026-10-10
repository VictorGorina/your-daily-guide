import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Loader2, MessageCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchProfile } from "@/lib/daily";

// El panel del coach (SDK de IA, streamdown, las herramientas)
// pesa más que la pantalla que lo lleva: va en su propio chunk y se monta cuando
// el navegador queda libre o al primer toque, no antes del primer pintado
// (ticket 17, PERF-06). Montado ya no se desmonta: la conversación y una
// herramienta a medio aplicar sobreviven a cerrar el panel o a ir a /chat.
const CoachPanel = lazy(() => import("./coach-panel"));

// Posición y forma del botón flotante, compartidas con el de coach-panel.tsx
// para que el cambio del marcador al botón real no se note.
export const FAB_CLASS =
  "fixed bottom-[calc(6.5rem+max(1rem,env(safe-area-inset-bottom)))] right-4 z-50 grid h-14 w-14 place-items-center rounded-full shadow-[0_6px_18px_-6px_rgba(0,0,0,.35)] transition-all duration-300 active:scale-90";

export function CoachFab() {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [openOnMount, setOpenOnMount] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  // La pantalla /chat ya es una conversación a pantalla completa: mostrar la
  // burbuja encima sería duplicar la misma interfaz dos veces.
  const hidden = !profileQ.data?.onboarding_completed || pathname.startsWith("/chat");

  useEffect(() => {
    const mount = () => setMounted(true);
    // Safari no tiene requestIdleCallback.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(mount, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(mount, 1500);
    return () => window.clearTimeout(id);
  }, []);

  // Mismo aspecto que el botón en reposo; un toque antes de que llegue el panel
  // lo monta ya abierto.
  const placeholder = hidden ? null : (
    <button
      type="button"
      onClick={() => {
        setOpenOnMount(true);
        setMounted(true);
      }}
      aria-label={t("chat.fab.open")}
      className={`${FAB_CLASS} bg-primary text-primary-foreground hover:scale-105`}
    >
      {openOnMount ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <>
          <span className="animate-fab-ring pointer-events-none absolute inset-0 rounded-full bg-primary/40" />
          <MessageCircle className="h-6 w-6" />
        </>
      )}
    </button>
  );

  if (!mounted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <CoachPanel hidden={hidden} defaultOpen={openOnMount} />
    </Suspense>
  );
}
