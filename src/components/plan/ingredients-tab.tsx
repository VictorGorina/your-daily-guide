import { useMoney } from "@/lib/use-money";
import {
  CalendarSync,
  Carrot,
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Plus,
  Receipt,
  ShoppingCart,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { PlanUpdatedBanner } from "@/components/plan-updated-banner";
import { isCleanFood } from "@/lib/content-guard";
import {
  boughtTotal,
  CADENCES,
  daysInMonth,
  homeTotal,
  pendingTotal,
  tripDayRange,
  tripSpendBars,
  tripTiming,
  shoppingTotal,
  type PantryExtra,
  type PlanMonthStatus,
  type ShoppingCadence,
  type ShoppingItem,
} from "@/lib/plan-shared";
import { freshRisksForTrip, freshRiskText } from "@/lib/perishability";
import { clearPlanUpdatedNotice, hasPlanUpdatedNotice, onPlanRecalcDone } from "@/lib/plan-recalc";
import { CategoryIcon } from "./shopping-bits";

/**
 * Tarjeta "Ya lo tengo en casa (fuera del plan)": la persona añade ingredientes
 * que ya tiene y que la lista de la compra no incluye. El planificador los
 * cuenta como disponibles al recolocar (no se añaden a la compra).
 */
function PantryExtrasCard({
  extras,
  pantry,
}: {
  extras: PantryExtra[];
  pantry: {
    isPending: boolean;
    mutate: (v: { name: string; qty?: string; remove?: boolean }) => void;
  };
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  // Esta tarjeta no enseña el error de la mutación, así que sin este aviso un
  // ingrediente rechazado por el servidor desaparecía sin decir nada.
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || pantry.isPending) return;
    if (!isCleanFood(trimmed)) {
      setError(t("food.blocked"));
      return;
    }
    setError(null);
    pantry.mutate({ name: trimmed });
    setName("");
  };
  return (
    <div className="surface-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Carrot className="h-[15px] w-[15px] shrink-0 text-primary-ink" />
        <h3 className="flex-1 text-[12.5px] font-semibold">{t("shopping.pantry.title")}</h3>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        {t("shopping.pantry.body")}
      </p>
      <div className="mt-2.5 flex gap-1.5">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={t("shopping.pantry.placeholder")}
          aria-label={t("shopping.pantry.inputLabel")}
          className="min-w-0 flex-1 rounded-full bg-secondary px-3.5 py-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/40"
        />
        <button
          type="button"
          onClick={add}
          disabled={pantry.isPending || !name.trim()}
          aria-label={t("shopping.pantry.add")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {error ? <p className="mt-2 text-[11.5px] text-destructive">{error}</p> : null}
      {extras.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {extras.map((e) => (
            <span
              key={e.name}
              className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11.5px]"
            >
              <span>{e.name}</span>
              {e.source === "receipt" ? (
                <Receipt className="h-3 w-3 text-muted-foreground" />
              ) : null}
              <button
                type="button"
                onClick={() => pantry.mutate({ name: e.name, remove: true })}
                disabled={pantry.isPending}
                aria-label={t("common.removeNamed", { what: e.name })}
                className="text-muted-foreground disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pestaña Ingredientes — nueva versión con una compra a la vez,
// un solo gesto por ingrediente y filtros por chip.
// ---------------------------------------------------------------------------
export function IngredientsTab({
  shopping,
  trips,
  tripsTotal,
  activeCadence,
  coverage,
  todayDayOfMonth,
  selectedTrip,
  setSelectedTrip,
  filter,
  setFilter,
  recadence,
  pendingCadence,
  setPendingCadence,
  owned,
  tripActuals,
  pantryExtras,
  pantry,
  onEnterShopMode,
  month,
  monthStatus,
  readOnly,
  periodBudget,
  overBudget,
  plannerLocked = false,
  plannerName,
  inlineCta = false,
}: {
  shopping: { category: string; items: ShoppingItem[] }[] | null;
  trips: { trip: number; groups: { category: string; items: ShoppingItem[] }[] }[];
  tripsTotal: number;
  activeCadence: ShoppingCadence;
  pendingCadence: ShoppingCadence | null;
  coverage: { fromDay: number; toDay: number } | undefined;
  todayDayOfMonth: number;
  selectedTrip: number;
  setSelectedTrip: (t: number) => void;
  filter: "need" | "have" | "all";
  setFilter: (f: "need" | "have" | "all") => void;
  recadence: { isPending: boolean; mutate: (c: ShoppingCadence) => void };
  setPendingCadence: (c: ShoppingCadence) => void;
  owned: {
    mutate: (v: { itemName: string; trip: number; source: "fridge" | "store" | null }) => void;
  };
  tripActuals: Record<number, number>;
  pantryExtras: PantryExtra[];
  pantry: {
    isPending: boolean;
    mutate: (v: { name: string; qty?: string; remove?: boolean }) => void;
  };
  onEnterShopMode: () => void;
  month: string;
  monthStatus: PlanMonthStatus;
  readOnly: boolean;
  periodBudget: number;
  overBudget: boolean;
  /** Lista de la casa vista por un no planificador (issue 06): se puede marcar
   *  y comprar, pero no regenerar ni cambiar la cadencia. */
  plannerLocked?: boolean;
  plannerName?: string;
  /** El CTA "Ir a comprar" va en línea, no fijo al fondo — para cuando hay dos
   *  listas apiladas en la pantalla (compra de la casa + compra en solitario). */
  inlineCta?: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const currentTrip = trips[selectedTrip] ?? trips[0];
  const timing = tripTiming(tripsTotal, selectedTrip, todayDayOfMonth, coverage);

  // Aviso de "hemos actualizado tus cantidades" tras un cambio en la mesa. Se
  // suscribe aquí y no en el componente de arriba porque `onPlanRecalcDone` es
  // una suscripción de módulo: evita bajar dos props por los tres sitios donde
  // se usa esta pestaña.
  const [planUpdated, setPlanUpdated] = useState(() => hasPlanUpdatedNotice(month));
  useEffect(() => {
    setPlanUpdated(hasPlanUpdatedNotice(month));
    return onPlanRecalcDone((done) => {
      if (done === month) setPlanUpdated(hasPlanUpdatedNotice(month));
    });
  }, [month]);
  const dismissPlanUpdated = () => {
    clearPlanUpdatedNotice(month);
    setPlanUpdated(false);
  };
  // Mes que viene desbloqueado: la compra se hace entera ahora, así que todas
  // las compras son accionables a la vez. Mes pasado: solo lectura. Mes en
  // curso: cualquier compra que no haya pasado ya (puedes auditar la nevera para
  // la compra de la semana que viene por adelantado); las compras ya pasadas
  // quedan bloqueadas.
  const editable = readOnly
    ? false
    : monthStatus === "next-unlocked" || (monthStatus === "current" && timing !== "past");

  // Cifras de la tarjeta "Te falta comprar": de la compra seleccionada, no del
  // mes (diseño 1c: "el número con el que sales de casa").
  const tripGroups = currentTrip?.groups ?? [];
  const total = shoppingTotal(tripGroups);
  const alreadyHome = homeTotal(tripGroups);
  const alreadyBought = boughtTotal(tripGroups);
  const stillPending = pendingTotal(tripGroups);
  const tripActual: number | undefined = tripActuals[selectedTrip];

  // Items de esta compra, filtrados por el chip activo
  const filteredGroups = useMemo(() => {
    if (!currentTrip) return [];
    return currentTrip.groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter((i) => {
          if (filter === "need") return !i.owned;
          if (filter === "have") return !!i.owned;
          return true; // "all"
        }),
      }))
      .filter((g) => g.items.length);
  }, [currentTrip, filter]);

  // Contadores para los chips
  const totalItems = currentTrip?.groups.reduce((s, g) => s + g.items.length, 0) ?? 0;
  const needCount =
    currentTrip?.groups.reduce((s, g) => s + g.items.filter((i) => !i.owned).length, 0) ?? 0;
  const haveCount = totalItems - needCount;
  const pctResolved = totalItems > 0 ? Math.round((haveCount / totalItems) * 100) : 0;

  // Rango de días de la compra seleccionada
  const covOrFull = coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const tripRange = tripDayRange(covOrFull, tripsTotal, selectedTrip);
  const monthShort = t(`monthsShort.${Number(month.slice(5, 7)) - 1}`);
  const tripLabel =
    activeCadence === "mensual"
      ? t("shopping.tripSingle")
      : t("shopping.tripOf", { n: selectedTrip + 1, total: tripsTotal });

  // Frescos que esta compra no cubre sin que se estropeen: no cambia la lista,
  // solo avisa de comprarlos más cerca de cuando se cocinan.
  const freshRisks = freshRisksForTrip(tripGroups, covOrFull, tripsTotal, selectedTrip);

  // Barras de progreso del resumen
  const barHome = total > 0 ? (alreadyHome / total) * 100 : 0;
  const barBought = total > 0 ? (alreadyBought / total) * 100 : 0;

  // La cadencia que enseña el selector: la recién pulsada mientras se guarda.
  const shownCadence =
    CADENCES.find((c) => c.key === (pendingCadence ?? activeCadence)) ?? CADENCES[0];
  const spendBars = tripSpendBars(trips, covOrFull);

  return (
    <section className="mt-5 space-y-3 pb-40">
      {/* "Tus ingredientes se han actualizado": la mesa cambió y el recálculo
          automático ya rehizo las cantidades. Va aquí y no en Familia porque
          es aquí donde se ven los números distintos. */}
      {planUpdated ? <PlanUpdatedBanner onDismiss={dismissPlanUpdated} /> : null}
      {readOnly ? (
        <div className="rounded-[20px] bg-secondary/60 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{t("shopping.readOnly")}</p>
        </div>
      ) : plannerLocked ? null : (
        /* Cadencia */
        <div className="surface-card p-4">
          <div className="flex items-center gap-2 px-0.5">
            <CalendarSync className="h-[15px] w-[15px] shrink-0 text-primary-ink" />
            <h3 className="flex-1 text-sm font-semibold">{t("shopping.cadenceTitle")}</h3>
          </div>
          <div className="mt-2.5 flex gap-0.5 rounded-full bg-secondary p-[3px]">
            {CADENCES.map((c) => {
              const selected = shownCadence.key === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (recadence.isPending || c.key === activeCadence) return;
                    setPendingCadence(c.key);
                    recadence.mutate(c.key);
                  }}
                  disabled={recadence.isPending}
                  className={`min-w-0 flex-1 truncate rounded-full py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                    selected
                      ? "bg-surface text-primary-ink shadow-[0_1px_2px_rgba(62,61,57,0.12)]"
                      : "text-muted-foreground"
                  }`}
                >
                  {t(`cadence.${c.key}.short`)}
                </button>
              );
            })}
          </div>
          {/* Reparto del mes: una barra por compra, tan ancha como los días
              que cubre y tan alta como los euros que cuesta. */}
          <div className="mt-3 flex items-center gap-3 px-0.5">
            <div className="flex h-[30px] w-16 shrink-0 items-end gap-[3px]" aria-hidden="true">
              {spendBars.map((bar, i) => (
                <div
                  key={i}
                  className="min-h-1 rounded bg-primary"
                  style={{ flex: bar.days, height: `${bar.pct}%` }}
                />
              ))}
            </div>
            <p className="flex-1 text-[12.5px] leading-[18px] text-pretty text-muted-foreground">
              {recadence.isPending ? (
                t("shopping.updating")
              ) : (
                <>
                  <span className="font-semibold text-foreground">
                    {t("shopping.trips", { count: tripsTotal })}
                  </span>{" "}
                  {t(`cadence.${shownCadence.key}.desc`)}
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Aviso de presupuesto: es del mes entero, no de una compra. */}
      {overBudget ? (
        <div className="rounded-[20px] bg-destructive/10 px-4 py-3">
          <p className="text-xs leading-relaxed text-destructive">
            {t("shopping.overBudget", { budget: money(periodBudget) })}
          </p>
        </div>
      ) : null}

      {/* Navegador de compra ← → */}
      {tripsTotal > 1 ? (
        <div className="flex items-center gap-2 overflow-hidden rounded-full bg-secondary/55 p-1">
          <button
            type="button"
            onClick={() => setSelectedTrip(Math.max(0, selectedTrip - 1))}
            disabled={selectedTrip === 0}
            aria-label={t("shopping.previousTrip")}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-surface text-muted-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[12.5px] font-semibold">
              {monthStatus === "current" && timing === "current"
                ? t("shopping.thisWeek", { trip: tripLabel })
                : tripLabel}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {tripRange.from} – {tripRange.to} {monthShort}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedTrip(Math.min(tripsTotal - 1, selectedTrip + 1))}
            disabled={selectedTrip === tripsTotal - 1}
            aria-label={t("shopping.nextTrip")}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-surface text-muted-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Resumen "Te falta comprar" */}
      <div className="surface-card p-5">
        <p className="text-xs font-semibold text-muted-foreground">{t("shopping.pending")}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-title text-4xl font-semibold tabular-nums tracking-tight text-primary-ink">
            {money(stillPending)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("shopping.items", { count: needCount })}
          </span>
        </div>
        <div className="mt-3.5 flex h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-success transition-[width] duration-500"
            style={{ width: `${barHome}%` }}
          />
          <div
            className="h-full bg-success/50 transition-[width] duration-500"
            style={{ width: `${barBought}%` }}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-success" />
            {t("shopping.atHome")} {money(alreadyHome)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-success/50" />
            {t("shopping.bought")} {money(alreadyBought)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-secondary" />
            {t("shopping.total")} {money(total)}
          </span>
        </div>
        {tripActual != null ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("shopping.spentOnTrip")} <span className="font-semibold">{money(tripActual)}</span>{" "}
            {tripActual !== total ? (
              <span className={tripActual > total ? "text-destructive" : "text-success"}>
                {t("shopping.vsEstimate", {
                  diff: `${tripActual > total ? "+" : ""}${money(tripActual - total)}`,
                })}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Aviso de frescura: frescos que no aguantan los días de esta compra. */}
      {freshRisks.length ? (
        <div className="rounded-[20px] bg-warning/20 px-4 py-3">
          <p className="text-xs leading-relaxed text-foreground">
            {freshRiskText(freshRisks, tripRange.to - tripRange.from + 1, activeCadence, t)}
          </p>
        </div>
      ) : null}

      {/* Cabecera + filtros */}
      <div className="flex items-center justify-between gap-2.5 px-0.5">
        <h2 className="font-title text-xl font-semibold tracking-[-0.02em]">
          {t("shopping.title")}
        </h2>
        <span className="text-[11.5px] text-muted-foreground">
          {t("shopping.resolved", { pct: pctResolved })}
        </span>
      </div>
      <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
        <Trans
          i18nKey="shopping.help"
          components={{ b: <span className="font-semibold text-foreground" /> }}
        />
      </p>

      <div className="flex gap-1.5">
        {(
          [
            ["all", t("shopping.filters.all"), totalItems],
            ["need", t("shopping.filters.need"), needCount],
            ["have", t("shopping.filters.have"), haveCount],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
              filter === key
                ? "bg-foreground text-background"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {label} <span className="font-mono text-[11px] opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {/* Grupos de categoría */}
      <div className="flex flex-col gap-2.5">
        {filteredGroups.map((g) => (
          <div key={g.category} className="surface-card px-4 pb-1.5 pt-3.5">
            <div className="flex items-center gap-2 pb-1.5">
              <CategoryIcon category={g.category} className="h-[15px] w-[15px] text-primary-ink" />
              <h3 className="flex-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {g.category}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">{g.items.length}</span>
            </div>
            <ul className="m-0 list-none p-0">
              {g.items.map((item, i) => {
                const have = !!item.owned;
                // Un solo gesto: toca (o Espacio/Intro con teclado) para alternar "ya lo tengo en casa"
                const toggle = () => {
                  if (!editable) return;
                  owned.mutate({
                    itemName: item.name,
                    trip: selectedTrip,
                    source: item.owned ? null : "fridge",
                  });
                };
                return (
                  <li
                    key={`${item.name}-${i}`}
                    role="checkbox"
                    aria-checked={have}
                    aria-disabled={!editable}
                    tabIndex={editable ? 0 : -1}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault(); // sin esto, Espacio hace scroll
                        toggle();
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-3 border-t border-secondary/90 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${editable ? "active:bg-secondary/40" : "cursor-default"}`}
                  >
                    {/* Checkbox circular */}
                    <span
                      className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full transition-colors ${
                        have
                          ? "bg-success text-success-foreground"
                          : "border-[1.5px] border-border text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {/* Nombre y cantidad */}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[14.5px] font-medium ${have ? "text-muted-foreground line-through" : ""}`}
                      >
                        {item.name}
                      </span>
                      <span className="block font-mono text-[10.5px] text-muted-foreground">
                        {item.qty}
                      </span>
                    </span>
                    {/* Precio y etiqueta */}
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-xs text-muted-foreground">
                        {money(item.price_eur)}
                      </span>
                      {have ? (
                        <span className="block text-[10px] font-semibold text-success">
                          {item.owned === "store" ? t("shopping.bought") : t("shopping.atHome")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!shopping?.length ? (
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? t("shopping.empty.past")
              : plannerLocked
                ? t("shopping.empty.house", {
                    name: plannerName ?? t("shopping.plannerFallback"),
                  })
                : t("shopping.empty.own")}
          </p>
        ) : filteredGroups.length === 0 ? (
          <p className="px-0.5 text-sm text-muted-foreground">
            {t(`shopping.emptyFilter.${filter}`)}
          </p>
        ) : null}
      </div>

      {/* Ya tengo en casa fuera del plan */}
      {readOnly ? null : <PantryExtrasCard extras={pantryExtras} pantry={pantry} />}

      {/* Tip de persistencia */}
      {readOnly ? null : (
        <div className="flex items-start gap-2.5 rounded-[20px] bg-primary/10 px-4 py-3.5">
          <Lightbulb className="mt-0.5 h-[15px] w-[15px] shrink-0 text-primary-ink" />
          <p className="text-xs leading-relaxed text-muted-foreground">{t("shopping.tip")}</p>
        </div>
      )}

      {/* CTA "Ir a comprar": fijo al fondo en la vista de una sola lista; en
          línea cuando hay dos listas apiladas (compra de la casa + solitario). */}
      {!readOnly && shopping?.length && needCount > 0 ? (
        inlineCta ? (
          <button
            type="button"
            onClick={onEnterShopMode}
            className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-primary py-4 text-sm font-bold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(255,138,61,.9)] transition-transform active:scale-[0.98]"
          >
            <ShoppingCart className="h-[17px] w-[17px]" />
            {t("shopping.goShop", { count: needCount })}
          </button>
        ) : (
          <div className="fixed inset-x-0 bottom-[calc(6.75rem+env(safe-area-inset-bottom))] z-30 pl-5 pr-[4.75rem] sm:px-5">
            <div className="mx-auto max-w-lg">
              <button
                type="button"
                onClick={onEnterShopMode}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-primary py-4 text-sm font-bold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(255,138,61,.9)] transition-transform active:scale-[0.98]"
              >
                <ShoppingCart className="h-[17px] w-[17px]" />
                {t("shopping.goShop", { count: needCount })}
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
