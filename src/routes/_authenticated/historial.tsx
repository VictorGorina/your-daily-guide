import { createFileRoute, redirect } from "@tanstack/react-router";

// Historial se fundió en la subpestaña Plan: el calendario del mes es ahora el
// navegador del historial (semáforo por día, detalle de día). Esta ruta se
// conserva solo para no romper enlaces y notificaciones antiguas a /historial.
export const Route = createFileRoute("/_authenticated/historial")({
  beforeLoad: () => {
    throw redirect({ to: "/plan" });
  },
});
