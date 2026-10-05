import { Wallet } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useMoney } from "../lib/use-money";
import { Text, View } from "react-native";

import {
  shoppingTotal,
  tripActualsTotal,
  type PlanMonthStatus,
  type ShoppingList,
  type TripActuals,
  type TripReceipts,
} from "../lib/plan-shared";

/**
 * Gasto real en comida del mes seleccionado, para la vista de historial de la
 * subpestaña Plan. Sale de `trip_actuals` (importe por compra, a mano o leído
 * del tiquet). Copia de `src/components/month-spend-summary.tsx` de la web.
 */
export function MonthSpendSummary({
  shopping,
  tripActuals,
  tripReceipts,
  periodBudget,
  partialMonth,
  monthStatus,
}: {
  shopping: ShoppingList | null;
  tripActuals: TripActuals;
  tripReceipts: TripReceipts;
  periodBudget: number;
  partialMonth: boolean;
  monthStatus: PlanMonthStatus;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const trips = Object.keys(tripActuals)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (!trips.length && !shopping?.length) return null;

  const real = tripActualsTotal(tripActuals);
  const estimated = shoppingTotal(shopping);
  const hasReal = trips.length > 0;
  const overBudget = periodBudget > 0 && real > periodBudget;
  const future = monthStatus === "next-locked" || monthStatus === "next-unlocked";

  return (
    <View className="rounded-3xl bg-surface p-5">
      <View className="flex-row items-center gap-2">
        <Wallet size={16} color="#a84a17" />
        <Text className="text-sm font-sans-semibold text-foreground">{t("monthSpend.title")}</Text>
      </View>

      <View className="mt-2 flex-row items-baseline gap-2">
        <Text className="font-heading text-4xl tabular-nums text-primary-ink">
          {hasReal ? money(real) : "—"}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {hasReal
            ? trips.length > 1
              ? t("monthSpend.realTrips", { n: trips.length })
              : t("monthSpend.real")
            : future
              ? t("monthSpend.notBoughtYet")
              : t("monthSpend.notLogged")}
        </Text>
      </View>

      {estimated > 0 ? (
        <Text className="mt-1.5 text-xs text-muted-foreground">
          {t("monthSpend.estimated")}{" "}
          <Text className="font-sans-medium text-foreground">{money(estimated)}</Text>
          {hasReal && Math.abs(real - estimated) >= 0.5 ? (
            <Text className={real > estimated ? "text-destructive" : "text-success"}>
              {" "}
              ({real > estimated ? "+" : ""}
              {money(real - estimated)})
            </Text>
          ) : null}
        </Text>
      ) : null}

      {periodBudget > 0 ? (
        <Text
          className={`mt-1 text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}
        >
          {t(partialMonth ? "monthSpend.budgetPeriod" : "monthSpend.budgetMonth", {
            amount: money(periodBudget),
          })}
          {overBudget
            ? ` · ${t("monthSpend.over")}`
            : hasReal
              ? ` · ${t("monthSpend.within")}`
              : ""}
        </Text>
      ) : null}

      {trips.length > 1 ? (
        <View className="mt-3 flex-row flex-wrap gap-x-3.5 gap-y-1">
          {trips.map((trip) => (
            <Text key={trip} className="text-[11.5px] text-muted-foreground">
              {t("monthSpend.trip", { n: trip + 1 })}{" "}
              <Text className="font-mono text-foreground">{money(tripActuals[trip]!)}</Text>
              {tripReceipts[trip] ? ` · ${t("monthSpend.receipt")}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
