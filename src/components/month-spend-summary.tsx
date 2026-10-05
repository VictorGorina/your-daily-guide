import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMoney } from "@/lib/use-money";

import {
  shoppingTotal,
  tripActualsTotal,
  type PlanMonthStatus,
  type ShoppingList,
  type TripActuals,
  type TripReceipts,
} from "@/lib/plan-shared";

/**
 * Gasto real en comida del mes seleccionado, para la vista de historial de la
 * subpestaña Plan. El dato sale de `trip_actuals` (importe por compra, a mano o
 * leído del tiquet); `trip_receipts` solo aporta la marca de "leído de un
 * tiquet". Para meses pasados es el registro histórico; para el mes en curso va
 * subiendo según se registran compras.
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

  // Sin ningún gasto registrado y sin plan del mes: no hay nada que enseñar.
  if (!trips.length && !shopping?.length) return null;

  const real = tripActualsTotal(tripActuals);
  const estimated = shoppingTotal(shopping);
  const hasReal = trips.length > 0;
  const overBudget = periodBudget > 0 && real > periodBudget;
  const future = monthStatus === "next-locked" || monthStatus === "next-unlocked";

  return (
    <div className="surface-card p-5">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-primary-ink" />
        <h2 className="text-sm font-semibold">{t("monthSpend.title")}</h2>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-title text-4xl font-semibold tabular-nums tracking-tight text-primary-ink">
          {hasReal ? money(real) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">
          {hasReal
            ? trips.length > 1
              ? t("monthSpend.realTrips", { n: trips.length })
              : t("monthSpend.real")
            : future
              ? t("monthSpend.notBoughtYet")
              : t("monthSpend.notLogged")}
        </span>
      </div>

      {estimated > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("monthSpend.estimated")}{" "}
          <span className="font-medium text-foreground">{money(estimated)}</span>
          {hasReal && Math.abs(real - estimated) >= 0.5 ? (
            <span className={real > estimated ? " text-destructive" : " text-success"}>
              {" "}
              ({real > estimated ? "+" : ""}
              {money(real - estimated)})
            </span>
          ) : null}
        </p>
      ) : null}

      {periodBudget > 0 ? (
        <p className={`mt-1 text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
          {t(partialMonth ? "monthSpend.budgetPeriod" : "monthSpend.budgetMonth", {
            amount: money(periodBudget),
          })}
          {overBudget
            ? ` · ${t("monthSpend.over")}`
            : hasReal
              ? ` · ${t("monthSpend.within")}`
              : ""}
        </p>
      ) : null}

      {trips.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted-foreground">
          {trips.map((trip) => (
            <span key={trip}>
              {t("monthSpend.trip", { n: trip + 1 })}{" "}
              <span className="font-mono text-foreground">{money(tripActuals[trip]!)}</span>
              {tripReceipts[trip] ? (
                <span className="text-muted-foreground/70"> · {t("monthSpend.receipt")}</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
