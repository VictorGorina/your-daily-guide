import { createFileRoute, redirect } from "@tanstack/react-router";

// Historial vive ahora como tercera sub-pestaña de Plan (ver plan.tsx). Esta
// ruta se conserva solo para no romper enlaces y notificaciones antiguas que
// apuntan a /historial.
export const Route = createFileRoute("/_authenticated/historial")({
  beforeLoad: () => {
    throw redirect({ to: "/plan", search: { tab: "historial" } });
  },
});
