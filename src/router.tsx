import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Un dato vale 30 s antes de volver a pedirlo al montar una pantalla (antes,
  // cada montaje lo repetía todo); cada escritura invalida lo que cambia, así
  // que esto solo retrasa ver un cambio hecho en OTRO dispositivo, y volver a
  // la pestaña lo refresca (ticket 36, PERF-07).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
