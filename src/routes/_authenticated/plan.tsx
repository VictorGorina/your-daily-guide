import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  CalendarRange,
  CalendarSync,
  Carrot,
  Check,
  ChevronLeft,
  ChevronRight,
  Egg,
  Fish,
  Lightbulb,
  RefreshCw,
  ShoppingBasket,
  ShoppingCart,
  Sparkle,
  Wheat,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { HistorialSection } from "@/components/historial-section";
import { PlanMonthCalendar } from "@/components/plan-month-calendar";
import { fetchMonthlyPlan, fetchProfile, monthISO, todayISO } from "@/lib/daily";
import {
  boughtTotal,
  cadenceOf,
  CADENCES,
  coverageRatio,
  eur,
  groupByTrip,
  homeTotal,
  ownedTotal,
  pendingTotal,
  shoppingToText,
  tripActualsTotal,
  tripDayRange,
  tripLabel,
  tripsOfCadence,
  tripTiming,
  tripToText,
  shoppingTotal,
  type ShoppingCadence,
  type ShoppingItem,
  type TripTiming,
} from "@/lib/plan-shared";
import {
  generateMonthlyPlan,
  recadenceMonthlyPlan,
  setTripActual,
  setTripConfirmed,
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
    mutationFn: (vars: { itemName: string; trip: number; source: "fridge" | "store" | null }) =>
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

  const tripConfirm = useServerFn(setTripConfirmed);
  const confirmTrip = useMutation({
    mutationFn: (vars: { trip: number; confirmed: boolean }) =>
      tripConfirm({ data: { month, ...vars } }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, confirmed_trips: res.confirmed_trips } : prev,
      );
    },
    onError: () => toast.error("No hemos podido fijar los ingredientes"),
  });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  const total = shoppingTotal(shopping);
  const alreadyHome = homeTotal(shopping);
  const alreadyBought = boughtTotal(shopping);
  const stillPending = pendingTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const spentSoFar = tripActualsTotal(tripActuals);
  const hasActuals = Object.keys(tripActuals).length > 0;
  const confirmedTrips = planQ.data?.confirmed_trips ?? {};
  const coverage = plan?.coverage;
  const activeCadence: ShoppingCadence = cadence ?? plan?.cadence ?? cadenceOf(shopping);
  const tripsTotal = tripsOfCadence(activeCadence);
  const trips = groupByTrip(shopping, tripsTotal);
  const todayDayOfMonth = Number(todayISO().slice(8, 10));

  // Compra seleccionada: por defecto la que toca hoy (current) o la primera
  // que sea "future" si no hay ninguna "current" (esto puede pasar a fin de mes).
  const [selectedTrip, setSelectedTrip] = useState<number>(() => {
    for (let i = 0; i < tripsTotal; i++) {
      if (tripTiming(tripsTotal, i, todayDayOfMonth, coverage) === "current") return i;
    }
    for (let i = 0; i < tripsTotal; i++) {
      if (tripTiming(tripsTotal, i, todayDayOfMonth, coverage) === "future") return i;
    }
    return 0;
  });
  // Filtro de ingredientes: "need" (falta), "have" (ya lo tengo), "all"
  const [filter, setFilter] = useState<"need" | "have" | "all">("need");
  // Modo compra a pantalla completa
  const [shopMode, setShopMode] = useState(false);

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
          ) : shopMode ? (
            <ShopModeView
              trip={trips[selectedTrip]}
              label={tripLabel(activeCadence, selectedTrip, coverage, tripsTotal)}
              coverage={coverage}
              tripsTotal={tripsTotal}
              selectedTrip={selectedTrip}
              onToggle={(itemName) =>
                owned.mutate({ itemName, trip: selectedTrip, source: "store" })
              }
              onClose={() => setShopMode(false)}
              tripActual={tripActuals[selectedTrip]}
              savingActual={setActual.isPending}
              onSaveActual={(amount) => setActual.mutate({ trip: selectedTrip, amount })}
            />
          ) : (
            <IngredientsTab
              shopping={shopping}
              trips={trips}
              tripsTotal={tripsTotal}
              activeCadence={activeCadence}
              coverage={coverage}
              todayDayOfMonth={todayDayOfMonth}
              selectedTrip={selectedTrip}
              setSelectedTrip={setSelectedTrip}
              filter={filter}
              setFilter={setFilter}
              recadence={recadence}
              setCadence={setCadence}
              owned={owned}
              tripActuals={tripActuals}
              setActual={setActual}
              confirmedTrips={confirmedTrips}
              confirmTrip={confirmTrip}
              onEnterShopMode={() => setShopMode(true)}
              onShareTrip={(trip, label) => void shareTrip(trip, label)}
              month={month}
              total={total}
              alreadyHome={alreadyHome}
              alreadyBought={alreadyBought}
              stillPending={stillPending}
              spentSoFar={spentSoFar}
              hasActuals={hasActuals}
              periodBudget={periodBudget}
              partialMonth={partialMonth}
              overBudget={overBudget}
            />
          )}
        </>
      )}

      <BottomNav />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Icono Lucide por categoría de supermercado (la lista viene del plan generado
// por la IA con nombres como "Frutas y verduras", "Pescado y carne", etc.)
// ---------------------------------------------------------------------------
// Categories are free-form AI-generated text — match by keyword, not exact name.
const CATEGORY_MATCHERS: [RegExp, React.ComponentType<{ className?: string }>][] = [
  [/verdura|fruta|hortaliza/i, Carrot],
  [/pescado|carne|proteín|pollo|ternera/i, Fish],
  [/despensa|conserva|cereal|legumbre|pasta|arroz|aceite/i, Wheat],
  [/lácteo|huevo|leche|yogur|queso/i, Egg],
];
const CategoryIcon = ({ category, className }: { category: string; className?: string }) => {
  const match = CATEGORY_MATCHERS.find(([re]) => re.test(category));
  if (!match) return null;
  const Icon = match[1];
  return <Icon className={className} />;
};

// ---------------------------------------------------------------------------
// Pestaña Ingredientes — nueva versión con una compra a la vez,
// un solo gesto por ingrediente y filtros por chip.
// ---------------------------------------------------------------------------
function IngredientsTab({
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
  setCadence,
  owned,
  tripActuals,
  setActual,
  confirmedTrips,
  confirmTrip,
  onEnterShopMode,
  onShareTrip,
  month,
  total,
  alreadyHome,
  alreadyBought,
  stillPending,
  spentSoFar,
  hasActuals,
  periodBudget,
  partialMonth,
  overBudget,
}: {
  shopping: { category: string; items: ShoppingItem[] }[] | null;
  trips: { trip: number; groups: { category: string; items: ShoppingItem[] }[] }[];
  tripsTotal: number;
  activeCadence: ShoppingCadence;
  coverage: { fromDay: number; toDay: number } | undefined;
  todayDayOfMonth: number;
  selectedTrip: number;
  setSelectedTrip: (t: number) => void;
  filter: "need" | "have" | "all";
  setFilter: (f: "need" | "have" | "all") => void;
  recadence: { isPending: boolean; mutate: (c: ShoppingCadence) => void };
  setCadence: (c: ShoppingCadence) => void;
  owned: {
    mutate: (v: { itemName: string; trip: number; source: "fridge" | "store" | null }) => void;
  };
  tripActuals: Record<number, number>;
  setActual: { isPending: boolean; mutate: (v: { trip: number; amount: number | null }) => void };
  confirmedTrips: Record<number, string>;
  confirmTrip: { isPending: boolean; mutate: (v: { trip: number; confirmed: boolean }) => void };
  onEnterShopMode: () => void;
  onShareTrip: (
    trip: { groups: { category: string; items: ShoppingItem[] }[] },
    label: string,
  ) => void;
  month: string;
  total: number;
  alreadyHome: number;
  alreadyBought: number;
  stillPending: number;
  spentSoFar: number;
  hasActuals: boolean;
  periodBudget: number;
  partialMonth: boolean;
  overBudget: boolean;
}) {
  const currentTrip = trips[selectedTrip] ?? trips[0];
  const timing = tripTiming(tripsTotal, selectedTrip, todayDayOfMonth, coverage);
  const editable = timing === "current";
  const tripPending = pendingTotal(currentTrip?.groups);

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
  const tripRange = coverage
    ? tripDayRange(coverage, tripsTotal, selectedTrip)
    : { from: 1, to: 31 };

  // Barras de progreso del resumen
  const barHome = total > 0 ? (alreadyHome / total) * 100 : 0;
  const barBought = total > 0 ? (alreadyBought / total) * 100 : 0;

  return (
    <section className="mt-5 space-y-3 pb-28">
      {/* Cadencia */}
      <div className="surface-card px-4 py-3.5">
        <div className="flex items-center gap-2">
          <CalendarSync className="h-[15px] w-[15px] shrink-0 text-primary" />
          <h3 className="flex-1 text-[12.5px] font-semibold">Cada cuánto compras</h3>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-full bg-secondary/70 p-1">
          {CADENCES.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                if (recadence.isPending) return;
                setCadence(c.key);
                if (c.key !== activeCadence) recadence.mutate(c.key);
              }}
              disabled={recadence.isPending}
              className={`rounded-full py-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-60 ${
                activeCadence === c.key ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {recadence.isPending
            ? "Repartiendo la compra..."
            : tripsTotal > 1
              ? `${tripsTotal} compras separadas, cada una con su lista.`
              : "1 sola compra: menos frescos, más despensa."}
        </p>
      </div>

      {/* Navegador de compra ← → */}
      {tripsTotal > 1 ? (
        <div className="flex items-center gap-2 overflow-hidden rounded-full bg-secondary/55 p-1">
          <button
            type="button"
            onClick={() => setSelectedTrip(Math.max(0, selectedTrip - 1))}
            disabled={selectedTrip === 0}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-surface text-muted-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[12.5px] font-semibold">
              {activeCadence === "mensual"
                ? "Compra única del mes"
                : `Compra ${selectedTrip + 1} de ${tripsTotal}`}
              {timing === "current" ? " · esta semana" : ""}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {tripRange.from} – {tripRange.to}{" "}
              {new Date(`${month}-01`).toLocaleDateString("es-ES", { month: "short" })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedTrip(Math.min(tripsTotal - 1, selectedTrip + 1))}
            disabled={selectedTrip === tripsTotal - 1}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-surface text-muted-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Resumen "Te falta comprar" */}
      <div className="surface-card p-5">
        <p className="text-xs font-semibold text-muted-foreground">Te falta comprar</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-title text-4xl font-semibold tabular-nums tracking-tight text-primary">
            {eur(stillPending)}
          </span>
          <span className="text-xs text-muted-foreground">
            {needCount} artículo{needCount === 1 ? "" : "s"}
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
            En casa {eur(alreadyHome)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-success/50" />
            Comprado {eur(alreadyBought)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-secondary" />
            Total {eur(total)}
          </span>
        </div>
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
            Se pasa de tu presupuesto ({eur(periodBudget)}). Puedo ajustarlo: regenera el plan o
            dímelo en el chat.
          </p>
        ) : null}
      </div>

      {/* Cabecera + filtros */}
      <div className="flex items-center justify-between gap-2.5 px-0.5">
        <h2 className="font-title text-xl font-semibold tracking-[-0.02em]">Ingredientes</h2>
        <span className="text-[11.5px] text-muted-foreground">{pctResolved}% ya resuelto</span>
      </div>
      <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
        Toca un ingrediente para marcarlo como que ya lo tienes en casa. Lo que quede en naranja es
        tu lista del súper.
      </p>

      <div className="flex gap-1.5">
        {(
          [
            ["need", "Falta comprar", needCount],
            ["have", "Ya lo tengo", haveCount],
            ["all", "Todo", totalItems],
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
              <CategoryIcon category={g.category} className="h-[15px] w-[15px] text-primary" />
              <h3 className="flex-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {g.category}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">{g.items.length}</span>
            </div>
            <ul className="m-0 list-none p-0">
              {g.items.map((item) => {
                const have = !!item.owned;
                return (
                  <li
                    key={item.name}
                    onClick={() => {
                      if (!editable) return;
                      // Un solo gesto: toca para alternar "ya lo tengo en casa"
                      owned.mutate({
                        itemName: item.name,
                        trip: selectedTrip,
                        source: item.owned ? null : "fridge",
                      });
                    }}
                    className={`flex cursor-pointer items-center gap-3 border-t border-secondary/90 py-2.5 ${editable ? "active:bg-secondary/40" : "cursor-default"}`}
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
                        {eur(item.price_eur)}
                      </span>
                      {have ? (
                        <span className="block text-[10px] font-semibold text-success">
                          {item.owned === "store" ? "Comprado" : "En casa"}
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
            Aún no hay lista. Regenera el plan para crearla.
          </p>
        ) : null}
      </div>

      {/* Tip de persistencia */}
      <div className="flex items-start gap-2.5 rounded-[20px] bg-primary/10 px-4 py-3.5">
        <Lightbulb className="mt-0.5 h-[15px] w-[15px] shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Lo que marques como "en casa" se guarda para las siguientes compras del mes: no te lo
          volveré a pedir mientras te dure.
        </p>
      </div>

      {/* CTA fijo al fondo — "Ir a comprar" */}
      {shopping?.length && needCount > 0 ? (
        <div className="fixed inset-x-0 bottom-[88px] z-20 px-5">
          <div className="mx-auto max-w-lg">
            <button
              type="button"
              onClick={onEnterShopMode}
              className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-primary py-4 text-sm font-bold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(255,138,61,.9)] transition-transform active:scale-[0.98]"
            >
              <ShoppingCart className="h-[17px] w-[17px]" />
              Ir a comprar · {needCount} art.
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modo compra — pantalla completa solo con lo que falta
// ---------------------------------------------------------------------------
function ShopModeView({
  trip,
  label,
  coverage,
  tripsTotal,
  selectedTrip,
  onToggle,
  onClose,
  tripActual,
  savingActual,
  onSaveActual,
}: {
  trip: { trip: number; groups: { category: string; items: ShoppingItem[] }[] } | undefined;
  label: string;
  coverage: { fromDay: number; toDay: number } | undefined;
  tripsTotal: number;
  selectedTrip: number;
  onToggle: (itemName: string) => void;
  onClose: () => void;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
}) {
  const [text, setText] = useState(tripActual != null ? String(tripActual) : "");

  // Solo los items que todavía faltan o que se acaban de marcar como "bought"
  // en esta sesión de compra (para que se vean tachados, no desaparezcan).
  const allItems = useMemo(
    () => (trip?.groups ?? []).flatMap((g) => g.items.filter((i) => i.owned !== "fridge")),
    [trip],
  );
  const shopGroups = useMemo(() => {
    if (!trip) return [];
    const cats = new Map<string, ShoppingItem[]>();
    for (const g of trip.groups) {
      for (const item of g.items) {
        // Excluir los que ya estaban "en casa" — el modo compra no los muestra.
        if (item.owned === "fridge") continue;
        const arr = cats.get(g.category) ?? [];
        arr.push(item);
        cats.set(g.category, arr);
      }
    }
    return [...cats.entries()].map(([cat, items]) => ({ category: cat, items }));
  }, [trip]);

  const leftItems = allItems.filter((i) => !i.owned);
  const leftTotal = leftItems.reduce((s, i) => s + i.price_eur, 0);
  const doneTotal = allItems
    .filter((i) => i.owned === "store")
    .reduce((s, i) => s + i.price_eur, 0);
  const pct = allItems.length ? ((allItems.length - leftItems.length) / allItems.length) * 100 : 0;
  const allDone = leftItems.length === 0;

  const tripRange = coverage
    ? tripDayRange(coverage, tripsTotal, selectedTrip)
    : { from: 1, to: 31 };

  const commitActual = () => {
    const trimmed = text.trim().replace(",", ".");
    if (!trimmed) {
      if (tripActual != null) onSaveActual(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n !== tripActual) onSaveActual(Math.round(n * 100) / 100);
  };

  return (
    <section className="mt-5 pb-32">
      {/* Cabecera modo compra */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Compra {selectedTrip + 1} de {tripsTotal} · {tripRange.from}–{tripRange.to} ago
          </p>
          <h1 className="font-title text-2xl font-semibold tracking-[-0.02em] leading-tight">
            En el súper
          </h1>
        </div>
      </div>

      {/* Resumen compra */}
      <div className="mt-4 surface-card p-5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground">Queda por coger</p>
            <p className="mt-0.5 font-title text-[30px] font-semibold tabular-nums tracking-tight text-primary">
              {eur(Math.round(leftTotal * 100) / 100)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[11px] text-muted-foreground">en el carro</p>
            <p className="mt-0.5 font-mono text-[15px] font-medium text-success">
              {eur(Math.round(doneTotal * 100) / 100)}
            </p>
          </div>
        </div>
        <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-success transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {leftItems.length} de {allItems.length} por coger · lo que ya tienes en casa no aparece
          aquí
        </p>
      </div>

      {/* Lista de ingredientes agrupados */}
      <div className="mt-3.5 flex flex-col gap-4">
        {shopGroups.map((g) => (
          <div key={g.category}>
            <div className="flex items-center gap-2 px-1 pb-2">
              <CategoryIcon category={g.category} className="h-[15px] w-[15px] text-primary" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {g.category}
              </h3>
            </div>
            <ul className="flex flex-col gap-1.5 p-0">
              {g.items.map((item) => {
                const done = item.owned === "store";
                return (
                  <li
                    key={item.name}
                    onClick={() => {
                      // En modo compra, tocar alterna "store" (comprado)
                      onToggle(item.name);
                    }}
                    className={`flex cursor-pointer items-center gap-3.5 rounded-[18px] px-4 py-3.5 transition-colors active:scale-[0.99] ${
                      done ? "bg-secondary/45" : "bg-surface"
                    }`}
                  >
                    {/* Checkbox cuadrado redondeado */}
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] transition-colors ${
                        done
                          ? "bg-success text-success-foreground"
                          : "border-[1.5px] border-border text-transparent"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-base font-semibold tracking-[-0.01em] ${done ? "text-muted-foreground line-through" : ""}`}
                      >
                        {item.name}
                      </span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {item.qty} · {eur(item.price_eur)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Botón fijo fondo */}
      <div className="fixed inset-x-0 bottom-5 z-20 px-5">
        <div className="mx-auto max-w-lg">
          {allDone ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-[20px] bg-surface px-4 py-3">
                <label className="flex-1 text-xs text-muted-foreground">¿Cuánto gastaste?</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={commitActual}
                  placeholder={eur(Math.round(leftTotal * 100) / 100)}
                  disabled={savingActual}
                  className="w-24 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm tabular-nums disabled:opacity-60"
                />
                <span className="text-xs text-muted-foreground">€</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-success py-[17px] text-sm font-bold text-success-foreground"
              >
                Compra completa · guardar gasto
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-foreground py-[17px] text-sm font-bold text-background"
            >
              Terminar compra
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
