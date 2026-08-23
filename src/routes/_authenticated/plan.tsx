import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  CalendarRange,
  Copy,
  Download,
  Refrigerator,
  Share2,
  RefreshCw,
  ShoppingBasket,
  ShoppingCart,
  Sparkle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { HistorialSection } from "@/components/historial-section";
import { PlanMonthCalendar } from "@/components/plan-month-calendar";
import { fetchMonthlyPlan, fetchProfile, monthISO } from "@/lib/daily";
import {
  cadenceOf,
  CADENCES,
  coverageRatio,
  eur,
  groupByTrip,
  ownedTotal,
  pendingTotal,
  shoppingToText,
  sortByPending,
  tripActualsTotal,
  tripCount,
  tripLabel,
  tripToText,
  shoppingTotal,
  type ShoppingCadence,
  type ShoppingItem,
} from "@/lib/plan-shared";
import {
  generateMonthlyPlan,
  recadenceMonthlyPlan,
  setTripActual,
  toggleShoppingOwned,
} from "@/lib/plan.functions";

export const Route = createFileRoute("/_authenticated/plan")({
  validateSearch: (search: Record<string, unknown>): { tab?: "plan" | "compra" | "historial" } => ({
    tab:
      search.tab === "compra" || search.tab === "historial"
        ? (search.tab as "compra" | "historial")
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Plan del mes · Peppers" },
      {
        name: "description",
        content:
          "Tu plan mensual de comidas con los ingredientes del mes y su precio orientativo, ajustada a tu presupuesto.",
      },
      { property: "og:title", content: "Plan del mes · Peppers" },
      {
        property: "og:description",
        content: "Plan mensual de comidas e ingredientes del mes con precios.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanPage,
});

function PlanPage() {
  const qc = useQueryClient();
  const month = monthISO();
  const make = useServerFn(generateMonthlyPlan);
  const recad = useServerFn(recadenceMonthlyPlan);
  const searchTab = Route.useSearch({ select: (s) => s.tab });
  const [tab, setTab] = useState<"plan" | "compra" | "historial">(searchTab ?? "plan");
  const [cadence, setCadence] = useState<ShoppingCadence | null>(null);

  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });

  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      make({ data: { month, cadence: nextCadence ?? cadence ?? "mensual" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No hemos podido crear el plan ahora mismo"),
  });

  // Cambiar la cadencia solo reparte la misma compra en más o menos viajes, sin
  // regenerar el plan por IA: instantáneo y sin poder fallar por el modelo.
  const recadence = useMutation({
    mutationFn: (nextCadence: ShoppingCadence) => recad({ data: { month, cadence: nextCadence } }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, plan: res.plan, shopping: res.shopping } : prev,
      );
    },
    onError: (e) => {
      setCadence(null);
      toast.error(e instanceof Error ? e.message : "No hemos podido cambiar la frecuencia");
    },
  });

  const toggleOwned = useServerFn(toggleShoppingOwned);
  const owned = useMutation({
    mutationFn: (vars: { itemName: string; source: "fridge" | "store" | null }) =>
      toggleOwned({ data: { month, ...vars } }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, shopping: res.shopping } : prev,
      );
    },
    onError: () => toast.error("No hemos podido guardar el cambio"),
  });

  const tripActual = useServerFn(setTripActual);
  const setActual = useMutation({
    mutationFn: (vars: { trip: number; amount: number | null }) =>
      tripActual({ data: { month, ...vars } }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, trip_actuals: res.trip_actuals } : prev,
      );
    },
    onError: () => toast.error("No hemos podido guardar el gasto"),
  });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  const total = shoppingTotal(shopping);
  const alreadyOwned = ownedTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const spentSoFar = tripActualsTotal(tripActuals);
  const hasActuals = Object.keys(tripActuals).length > 0;
  const coverage = plan?.coverage;
  const activeCadence: ShoppingCadence = cadence ?? plan?.cadence ?? cadenceOf(shopping);
  const trips = groupByTrip(shopping);
  const tripsTotal = tripCount(shopping);

  const listText = () => shoppingToText(shopping, activeCadence, month, coverage);

  // Cada compra es una lista distinta, así que se comparte aparte (no todo el
  // mes de golpe) — refuerza que "Compra 1" y "Compra 2" no son lo mismo.
  const shareTrip = async (
    trip: { groups: { category: string; items: ShoppingItem[] }[] },
    label: string,
  ) => {
    const text = tripToText(trip, label);
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string }) => Promise<void>;
    };
    try {
      if (nav.share) {
        await nav.share({ title: label, text });
        return;
      }
      await nav.clipboard.writeText(text);
      toast.success("Lista copiada al portapapeles");
    } catch {
      /* el usuario canceló el diálogo de compartir */
    }
  };

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(listText());
      toast.success("Lista copiada");
    } catch {
      toast.error("No hemos podido copiar la lista");
    }
  };

  const downloadList = () => {
    const blob = new Blob([listText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ingredientes-del-mes-${month}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const budget = Number(profileQ.data?.budget_month_eur ?? 0);
  // Si el plan empieza a media de mes, el presupuesto que aplica es la parte
  // proporcional del mes que cubre, no el mes entero.
  const partialMonth = Boolean(coverage && coverage.fromDay > 1);
  const periodBudget =
    budget > 0 && coverage ? Math.round(budget * coverageRatio(coverage, month)) : budget;
  const overBudget = periodBudget > 0 && total > periodBudget;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <header className="animate-rise flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Plan mensual
          </p>
          <h1 className="truncate font-title text-[34px] font-semibold tracking-[-0.03em] capitalize">
            {monthLabel}
          </h1>
        </div>
        {plan ? (
          <button
            onClick={() => generate.mutate(undefined)}
            disabled={generate.isPending}
            aria-label="Regenerar plan"
            className="mt-1 rounded-full bg-surface p-2.5 text-muted-foreground disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${generate.isPending ? "animate-spin" : ""}`} />
          </button>
        ) : null}
      </header>

      {!plan ? (
        <section className="surface-card animate-rise mt-8 p-6 text-center">
          <CalendarRange className="mx-auto h-7 w-7 text-primary" />
          <h2 className="mt-3 text-sm font-semibold">Todavía no tienes plan de este mes</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Un mes de comidas flexibles y sus ingredientes del mes con precios, ajustada a tu
            presupuesto.
          </p>
          <button
            onClick={() => generate.mutate(undefined)}
            disabled={generate.isPending || planQ.isLoading}
            className="mt-5 w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {generate.isPending ? "Preparando tu mes..." : "Crear plan del mes"}
          </button>
        </section>
      ) : (
        <>
          <div className="sticky top-3 z-10 mt-6 grid grid-cols-3 gap-2 rounded-full bg-secondary/80 p-1 backdrop-blur">
            {(
              [
                ["plan", "Plan", CalendarRange],
                ["compra", "Ingredientes", ShoppingBasket],
                ["historial", "Historial", CalendarDays],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center justify-center gap-1 rounded-full py-2.5 text-xs font-medium transition-colors sm:gap-1.5 sm:text-sm ${
                  tab === key ? "bg-surface text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" /> {label}
              </button>
            ))}
          </div>

          {tab === "plan" ? (
            <section className="mt-5 space-y-5">
              <div className="surface-card p-5">
                <div className="flex items-center gap-2">
                  <Sparkle className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Cómo enfocamos el mes</h2>
                </div>
                <p className="hyphens-auto mt-2 text-justify text-sm leading-relaxed">
                  {plan.intro}
                </p>
                {plan.focus.length ? (
                  <ul className="mt-3 space-y-1.5">
                    {plan.focus.map((f) => (
                      <li key={f} className="flex gap-2 text-sm">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="min-w-0">{f}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="hyphens-auto mt-3 text-justify text-xs leading-relaxed text-muted-foreground">
                  Solo cocinas con lo que has comprado. Si te saltas un día, dímelo en el chat y
                  recoloco los siguientes.
                </p>
              </div>

              <PlanMonthCalendar plan={plan} month={month} />
            </section>
          ) : tab === "historial" ? (
            <HistorialSection />
          ) : (
            <section className="mt-5 space-y-4">
              <h2 className="font-title text-2xl font-semibold tracking-[-0.02em]">
                Ingredientes del mes
              </h2>

              <div className="surface-card p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">
                      {partialMonth ? "Total orientativo del periodo" : "Total orientativo del mes"}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {periodBudget > 0
                        ? partialMonth
                          ? `Presupuesto para estos días: ${eur(periodBudget)}`
                          : `Tu presupuesto: ${eur(periodBudget)}`
                        : "Sin presupuesto definido en tu perfil"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-title text-2xl font-semibold tabular-nums ${overBudget ? "text-destructive" : "text-primary"}`}
                  >
                    {eur(total)}
                  </span>
                </div>
                {periodBudget > 0 ? (
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${
                        overBudget
                          ? "bg-danger"
                          : total / periodBudget >= 0.85
                            ? "bg-warning"
                            : "bg-success"
                      }`}
                      style={{ width: `${Math.min(100, (total / periodBudget) * 100)}%` }}
                    />
                  </div>
                ) : null}
                {partialMonth && coverage ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Este plan cubre del día {coverage.fromDay} al {coverage.toDay}, la parte que
                    queda de mes.
                  </p>
                ) : null}
                {alreadyOwned > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ya tienes {eur(alreadyOwned)} en casa · Te falta comprar{" "}
                    {eur(Math.max(0, total - alreadyOwned))}
                  </p>
                ) : null}
                {hasActuals ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Gasto real hasta ahora: <span className="font-semibold">{eur(spentSoFar)}</span>{" "}
                    {spentSoFar !== total ? (
                      <span className={spentSoFar > total ? "text-destructive" : "text-success"}>
                        ({spentSoFar > total ? "+" : ""}
                        {eur(spentSoFar - total)} vs. lo estimado)
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {overBudget ? (
                  <p className="mt-2 text-xs text-destructive">
                    Se pasa de tu presupuesto. Puedo ajustarlo: regenera el plan o dímelo en el
                    chat.
                  </p>
                ) : null}
              </div>

              {shopping?.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Copiar", Copy, copyList],
                      ["Descargar", Download, downloadList],
                    ] as const
                  ).map(([label, Icon, action]) => (
                    <button
                      key={label}
                      onClick={() => void action()}
                      className="flex flex-col items-center gap-1 rounded-2xl bg-surface py-3 text-[11px] font-semibold text-muted-foreground transition-transform active:scale-[0.97]"
                    >
                      <Icon className="h-4 w-4 text-primary" />
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="surface-card p-5">
                <h3 className="text-sm font-semibold">Cada cuánto compras</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reparto los frescos entre compras para que nada se eche a perder.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {CADENCES.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => {
                        if (recadence.isPending) return;
                        setCadence(c.key);
                        if (c.key !== activeCadence) recadence.mutate(c.key);
                      }}
                      disabled={recadence.isPending}
                      className={`rounded-2xl px-2 py-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        activeCadence === c.key
                          ? "bg-foreground text-background"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {recadence.isPending ? (
                  <p className="mt-2 text-xs text-muted-foreground">Repartiendo la compra...</p>
                ) : tripsTotal > 1 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Son {tripsTotal} compras separadas, cada una con su propia lista: lo que marques
                    en una no afecta a las demás.
                  </p>
                ) : null}
              </div>

              <p className="px-1 text-xs text-muted-foreground">
                Precios orientativos de supermercado. Ajusta cantidades a tu casa.
              </p>
              {trips.map((t) => {
                const label = tripLabel(activeCadence, t.trip, coverage, tripsTotal);
                return (
                  <TripCard
                    key={t.trip}
                    trip={t}
                    label={label}
                    onShare={() => void shareTrip(t, label)}
                    tripActual={tripActuals[t.trip]}
                    savingActual={setActual.isPending}
                    onSaveActual={(amount) => setActual.mutate({ trip: t.trip, amount })}
                    onToggleOwned={(itemName, source) => owned.mutate({ itemName, source })}
                  />
                );
              })}
              {!shopping?.length ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay lista. Regenera el plan para crearla.
                </p>
              ) : null}
            </section>
          )}
        </>
      )}

      <BottomNav />
    </main>
  );
}

/**
 * Campo para anotar lo que se ha gastado de verdad en un viaje de compra, aparte
 * del precio estimado por la IA. Guarda al perder el foco (no en cada tecla) y
 * muestra la diferencia contra lo estimado cuando hay un importe guardado.
 */
function TripActualField({
  value,
  estimated,
  saving,
  onSave,
}: {
  value: number | undefined;
  estimated: number;
  saving: boolean;
  onSave: (amount: number | null) => void;
}) {
  const [text, setText] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setText(value != null ? String(value) : "");
  }, [value]);

  const commit = () => {
    const trimmed = text.trim().replace(",", ".");
    if (!trimmed) {
      if (value != null) onSave(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(Math.round(n * 100) / 100);
  };

  const diff = value != null ? Math.round((value - estimated) * 100) / 100 : null;

  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-secondary/40 px-3 py-2.5">
      <label className="flex-1 text-xs text-muted-foreground">¿Cuánto gastaste?</label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          placeholder={eur(estimated)}
          disabled={saving}
          className="w-20 rounded-lg bg-surface px-2 py-1.5 text-right text-sm tabular-nums disabled:opacity-60"
        />
        <span className="text-xs text-muted-foreground">€</span>
      </div>
      {diff != null && diff !== 0 ? (
        <span
          className={`shrink-0 text-xs font-semibold ${diff > 0 ? "text-destructive" : "text-success"}`}
        >
          {diff > 0 ? "+" : ""}
          {eur(diff)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Tarjeta de un tramo de ingredientes: agrupados por categoría como en el
 * súper, con los ya marcados (nevera o comprados) hundidos al final de cada
 * grupo para que arriba solo queden los pendientes de comprar — así el
 * importe junto al título baja según se van marcando (lo que ya tienes en la
 * nevera te ahorra ese dinero). El botón de compartir va aquí, junto al
 * nombre del tramo, porque cada uno es una lista aparte (no el mes entero).
 */
function TripCard({
  trip,
  label,
  onShare,
  tripActual,
  savingActual,
  onSaveActual,
  onToggleOwned,
}: {
  trip: { trip: number; groups: { category: string; items: ShoppingItem[] }[] };
  label: string;
  onShare: () => void;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
  onToggleOwned: (itemName: string, source: "fridge" | "store" | null) => void;
}) {
  const tripTotal = pendingTotal(trip.groups);
  const totalCount = trip.groups.reduce((s, g) => s + g.items.length, 0);
  const ownedCount = trip.groups.reduce(
    (s, g) => s + g.items.filter((item) => item.owned).length,
    0,
  );
  const pendingCount = totalCount - ownedCount;

  return (
    <div className="surface-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{label}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-semibold text-primary">{eur(tripTotal)}</span>
          <button
            type="button"
            onClick={onShare}
            aria-label={`Compartir ${label}`}
            className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-muted-foreground transition-transform active:scale-[0.95]"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {totalCount} artículo{totalCount === 1 ? "" : "s"}
        {ownedCount > 0
          ? pendingCount > 0
            ? ` · te falta comprar ${pendingCount}`
            : " · ya tienes todo"
          : null}
      </p>

      {trip.groups.map((group) => (
        <ShoppingGroup key={group.category} group={group} onToggleOwned={onToggleOwned} />
      ))}

      <TripActualField
        value={tripActual}
        estimated={tripTotal}
        saving={savingActual}
        onSave={onSaveActual}
      />
    </div>
  );
}

function ShoppingGroup({
  group,
  onToggleOwned,
}: {
  group: { category: string; items: ShoppingItem[] };
  onToggleOwned: (itemName: string, source: "fridge" | "store" | null) => void;
}) {
  const items = sortByPending(group.items);
  return (
    <div className="mt-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {group.category}
      </span>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item) => (
          <li key={item.name} className="flex items-center gap-2 text-sm">
            <span className={`min-w-0 flex-1 ${item.owned ? "text-success" : ""}`}>
              {item.name}
              {item.qty ? <span className="text-muted-foreground"> · {item.qty}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{eur(item.price_eur)}</span>
            <OwnedToggle
              owned={item.owned}
              onChange={(next) => onToggleOwned(item.name, next)}
              name={item.name}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Toggle "lo tengo en casa" / "lo he comprado": empieza sin ninguna opción
 * marcada (ni color) y solo se resalta la que el usuario elige — volver a
 * tocar la misma la deselecciona. Las dos opciones significan "ya no hace
 * falta comprarlo"; solo cambian de dónde ha salido.
 */
function OwnedToggle({
  owned,
  onChange,
  name,
}: {
  owned: "fridge" | "store" | undefined;
  onChange: (next: "fridge" | "store" | null) => void;
  name: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-secondary/70 p-1">
      <button
        type="button"
        onClick={() => onChange(owned === "fridge" ? null : "fridge")}
        aria-label={
          owned === "fridge" ? `${name}: ya en la nevera, quitar marca` : `${name}: ya lo tenía`
        }
        aria-pressed={owned === "fridge"}
        className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
          owned === "fridge" ? "bg-success text-success-foreground" : "text-muted-foreground"
        }`}
      >
        <Refrigerator className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange(owned === "store" ? null : "store")}
        aria-label={
          owned === "store"
            ? `${name}: comprado en el súper, quitar marca`
            : `${name}: marcar comprado en el súper`
        }
        aria-pressed={owned === "store"}
        className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
          owned === "store" ? "bg-success text-success-foreground" : "text-muted-foreground"
        }`}
      >
        <ShoppingCart className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
