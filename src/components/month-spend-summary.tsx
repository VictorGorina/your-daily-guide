import { Wallet } from "lucide-react";

import {
  eur,
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
        <Wallet className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Gasto en comida</h2>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-title text-4xl font-semibold tabular-nums tracking-tight text-primary">
          {hasReal ? eur(real) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">
          {hasReal
            ? `real${trips.length > 1 ? ` · ${trips.length} compras` : ""}`
            : future
              ? "aún no has comprado"
              : "sin registrar todavía"}
        </span>
      </div>

      {estimated > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Estimado del plan: <span className="font-medium text-foreground">{eur(estimated)}</span>
          {hasReal && Math.abs(real - estimated) >= 0.5 ? (
            <span className={real > estimated ? " text-destructive" : " text-success"}>
              {" "}
              ({real > estimated ? "+" : ""}
              {eur(real - estimated)})
            </span>
          ) : null}
        </p>
      ) : null}

      {periodBudget > 0 ? (
        <p className={`mt-1 text-xs ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
          Presupuesto{partialMonth ? " del periodo" : " del mes"}: {eur(periodBudget)}
          {overBudget ? " · te has pasado" : hasReal ? " · dentro" : ""}
        </p>
      ) : null}

      {trips.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted-foreground">
          {trips.map((t) => (
            <span key={t}>
              Compra {t + 1}:{" "}
              <span className="font-mono text-foreground">{eur(tripActuals[t]!)}</span>
              {tripReceipts[t] ? <span className="text-muted-foreground/70"> · tiquet</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
