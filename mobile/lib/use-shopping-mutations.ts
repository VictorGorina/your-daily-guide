import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { apiPost } from "./api";
import type { MonthlyPlanRow, PlannerShoppingRow } from "./daily";
import {
  withOwnedMark,
  withPantryExtra,
  withTripActual,
  type PantryExtra,
  type ShoppingList,
  type TripActuals,
  type TripReceipts,
} from "./plan-shared";
import { useMoney } from "./use-money";
import { useShoppingMutation } from "./use-shopping-mutation";

export type ReceiptScanResult = {
  trip_actuals: TripActuals;
  pantry_extras: PantryExtra[];
  trip_receipts: TripReceipts;
  total: number;
  added: string[];
  discarded: { name: string; reason: string }[];
};

type ShoppingRow = MonthlyPlanRow | PlannerShoppingRow;
type OwnedVars = { itemName: string; trip: number; source: "fridge" | "store" | null };
type ActualVars = { trip: number; amount: number | null };
type PantryVars = { name: string; qty?: string; remove?: boolean };
type ReceiptVars = { trip: number; imageBase64: string; mime: string };

/**
 * Las cuatro escrituras del estado de UNA lista de la compra (marca, gasto
 * real, despensa, tiquet), optimistas y en serie por mes (`useShoppingMutation`,
 * ticket 21). El cambio optimista es la misma función pura que aplica el
 * servidor sobre la fila más reciente. `pantryOf` solo cambia el texto del
 * aviso del tiquet; la fila objetivo la resuelve el servidor
 * (`resolveShoppingRow`).
 */
function useShoppingListMutations<Row extends ShoppingRow>({
  queryKey,
  month,
  pantryOf,
  onPantryChanged,
}: {
  queryKey: readonly unknown[];
  month: string;
  pantryOf: "own" | "house";
  onPantryChanged?: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const key = { queryKey, month };

  const receiptAlert = (res: ReceiptScanResult) => {
    const parts = [t("plan.receipt.saved", { amount: money(res.total) })];
    if (res.added.length) {
      const names = res.added.join(", ");
      parts.push(
        pantryOf === "house"
          ? t("plan.receipt.addedHouse", { names })
          : t("plan.receipt.addedOwn", { names }),
      );
    }
    if (res.discarded.length) {
      const names = res.discarded.map((d) => `${d.name} (${d.reason})`).join(", ");
      parts.push(t("plan.receipt.discarded", { names }));
    }
    Alert.alert(t("plan.receipt.title"), parts.join("\n"));
  };

  const owned = useShoppingMutation({
    ...key,
    kind: "owned",
    mutationFn: (vars: OwnedVars) =>
      apiPost<{ shopping: ShoppingList }>("plan/shopping-owned", { month, ...vars }),
    optimistic: (row: Row, v: OwnedVars): Row =>
      row.shopping
        ? { ...row, shopping: withOwnedMark(row.shopping, v.itemName, v.trip, v.source) }
        : row,
    settle: (row: Row, res: { shopping: ShoppingList }): Row => ({
      ...row,
      shopping: res.shopping,
    }),
    onError: () => Alert.alert(t("plan.errors.saveChange")),
  });
  const actual = useShoppingMutation({
    ...key,
    kind: "actual",
    mutationFn: (vars: ActualVars) =>
      apiPost<{ trip_actuals: TripActuals }>("plan/trip-actual", { month, ...vars }),
    optimistic: (row: Row, v: ActualVars): Row => ({
      ...row,
      trip_actuals: withTripActual(row.trip_actuals ?? {}, v.trip, v.amount),
    }),
    settle: (row: Row, res: { trip_actuals: TripActuals }): Row => ({
      ...row,
      trip_actuals: res.trip_actuals,
    }),
    onError: () => Alert.alert(t("plan.errors.saveSpend")),
  });
  const pantry = useShoppingMutation({
    ...key,
    kind: "pantry",
    mutationFn: (vars: PantryVars) =>
      apiPost<{ pantry_extras: PantryExtra[] }>("plan/pantry-extra", { month, ...vars }),
    optimistic: (row: Row, v: PantryVars): Row => ({
      ...row,
      pantry_extras: withPantryExtra(row.pantry_extras ?? [], v, new Date().toISOString()),
    }),
    settle: (row: Row, res: { pantry_extras: PantryExtra[] }): Row => ({
      ...row,
      pantry_extras: res.pantry_extras,
    }),
    onSuccess: () => onPantryChanged?.(),
    onError: () => Alert.alert(t("plan.errors.saveIngredient")),
  });
  const receipt = useShoppingMutation({
    ...key,
    kind: "receipt",
    mutationFn: (vars: ReceiptVars) =>
      apiPost<ReceiptScanResult>("plan/receipt", { month, ...vars }),
    settle: (row: Row, res: ReceiptScanResult): Row => ({
      ...row,
      trip_actuals: res.trip_actuals,
      trip_receipts: res.trip_receipts,
      pantry_extras: res.pantry_extras,
    }),
    onSuccess: (res) => {
      receiptAlert(res);
      if (res.added.length) onPantryChanged?.();
    },
    onError: (e: unknown) => Alert.alert(e instanceof Error ? e.message : t("plan.errors.receipt")),
  });

  return { owned, actual, pantry, receipt };
}

/**
 * Todas las escrituras del estado de la compra de la pantalla Plan (ticket 28
 * de la auditoría): las de la lista propia (`own`, caché `["plan", month]`) y
 * las de la compra de la casa que opera un no planificador (`house`, caché
 * `["planner-shopping", month]`, issue 06).
 *
 * `onOwnPantryChanged` avisa de que cambió la despensa PROPIA (a mano o por un
 * tiquet que añadió algo): la pantalla programa ahí el recálculo de platos. La
 * despensa de la casa no lo dispara: va a la fila del planificador y el
 * servidor no regenera el plan de otra persona.
 */
export function useShoppingMutations(
  month: string,
  { onOwnPantryChanged }: { onOwnPantryChanged: () => void },
) {
  const own = useShoppingListMutations<MonthlyPlanRow>({
    queryKey: ["plan", month],
    month,
    pantryOf: "own",
    onPantryChanged: onOwnPantryChanged,
  });
  const house = useShoppingListMutations<PlannerShoppingRow>({
    queryKey: ["planner-shopping", month],
    month,
    pantryOf: "house",
  });
  return { own, house };
}
