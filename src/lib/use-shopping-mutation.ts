import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Mutación del estado de la compra de un mes (marcas, gasto, tramos, despensa,
 * tiquet), optimista y en serie (ticket 21 de la auditoría). Copia en
 * `mobile/lib/use-shopping-mutation.ts`.
 *
 * - **En serie:** todas comparten `scope` por mes, así que TanStack Query manda
 *   las peticiones de una en una. El servidor ya reconstruye cada cambio sobre
 *   la fila más reciente (CAS); en serie, además, no compiten entre ellas.
 * - **Optimista:** `optimistic` aplica el cambio a la caché al tocar (corre al
 *   momento aunque la petición espere turno), con la misma función pura que usa
 *   el servidor (`withOwnedMark`, `withTripActual`…).
 * - **Solo la última escribe la respuesta:** la de un toque anterior no incluye
 *   los que aún esperan turno, y ponerla en la caché los borraría un instante.
 *   Mientras quede otra del mismo `kind` pendiente, se deja la caché como está.
 * - **Si falla, se relee:** con varios toques en cola, restaurar la copia del
 *   primero borraría también los demás; la verdad del servidor vale siempre.
 */
export function useShoppingMutation<Row, Vars, Res>(opts: {
  /** Caché que enseña esa lista: `["plan", month]` o `["planner-shopping", month]`. */
  queryKey: readonly unknown[];
  month: string;
  /** Tipo de cambio ("owned", "actual"…): agrupa "la última pendiente". */
  kind: string;
  mutationFn: (vars: Vars) => Promise<Res>;
  optimistic?: (row: Row, vars: Vars) => Row;
  /** Pone la respuesta del servidor en la caché. */
  settle: (row: Row, res: Res) => Row;
  onSuccess?: (res: Res) => void;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const mutationKey = ["shopping", opts.kind, ...opts.queryKey];
  const update = (fn: (row: Row) => Row) =>
    qc.setQueryData<Row>(opts.queryKey, (prev) => (prev ? fn(prev) : prev));

  return useMutation({
    mutationKey,
    scope: { id: `shopping-${opts.month}` },
    mutationFn: opts.mutationFn,
    onMutate: async (vars: Vars) => {
      if (!opts.optimistic) return;
      // Que una lectura en vuelo no pise el cambio optimista al llegar.
      await qc.cancelQueries({ queryKey: opts.queryKey });
      update((row) => opts.optimistic!(row, vars));
    },
    onSuccess: (res: Res) => {
      // Esta mutación sigue contando como pendiente mientras corre su onSuccess.
      if (qc.isMutating({ mutationKey }) <= 1) update((row) => opts.settle(row, res));
      opts.onSuccess?.(res);
    },
    onError: (error: unknown) => {
      void qc.invalidateQueries({ queryKey: opts.queryKey });
      opts.onError(error);
    },
  });
}
