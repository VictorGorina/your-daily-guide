import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * `render` de Testing Library con lo que cualquier pantalla de la app da por
 * hecho: un `QueryClient`. Las consultas se SIEMBRAN (`queries`) en vez de
 * pedirse: con `staleTime: Infinity` un dato sembrado no dispara su `queryFn`,
 * así el test decide qué ve el componente y no hay red. `["profile"]` va
 * sembrado a `null` por defecto porque lo lee el dictado, que está en casi
 * todos los campos de texto. Devuelve también el cliente, para comprobar qué
 * consultas se invalidan tras una acción.
 */
export function renderApp(
  ui: ReactElement,
  { queries = [] }: { queries?: [QueryKey, unknown][] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["profile"], null);
  for (const [key, data] of queries) queryClient.setQueryData(key, data);
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}
