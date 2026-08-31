import { Wallet } from "lucide-react-native";
import { Text, View } from "react-native";

import {
  eur,
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
        <Wallet size={16} color="#ff8a3d" />
        <Text className="text-sm font-sans-semibold text-foreground">Gasto en comida</Text>
      </View>

      <View className="mt-2 flex-row items-baseline gap-2">
        <Text className="font-heading text-4xl tabular-nums text-primary">
          {hasReal ? eur(real) : "—"}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {hasReal
            ? `real${trips.length > 1 ? ` · ${trips.length} compras` : ""}`
            : future
              ? "aún no has comprado"
              : "sin registrar todavía"}
        </Text>
      </View>

      {estimated > 0 ? (
        <Text className="mt-1.5 text-xs text-muted-foreground">
          Estimado del plan:{" "}
          <Text className="font-sans-medium text-foreground">{eur(estimated)}</Text>
          {hasReal && Math.abs(real - estimated) >= 0.5 ? (
            <Text className={real > estimated ? "text-destructive" : "text-success"}>
              {" "}
              ({real > estimated ? "+" : ""}
              {eur(real - estimated)})
            </Text>
          ) : null}
        </Text>
      ) : null}

      {periodBudget > 0 ? (
        <Text
          className={`mt-1 text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}
        >
          Presupuesto{partialMonth ? " del periodo" : " del mes"}: {eur(periodBudget)}
          {overBudget ? " · te has pasado" : hasReal ? " · dentro" : ""}
        </Text>
      ) : null}

      {trips.length > 1 ? (
        <View className="mt-3 flex-row flex-wrap gap-x-3.5 gap-y-1">
          {trips.map((t) => (
            <Text key={t} className="text-[11.5px] text-muted-foreground">
              Compra {t + 1}:{" "}
              <Text className="font-mono text-foreground">{eur(tripActuals[t]!)}</Text>
              {tripReceipts[t] ? " · tiquet" : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
