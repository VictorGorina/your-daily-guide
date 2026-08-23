import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Copy,
  Download,
  Share2,
  Lock,
  RefreshCw,
  ShoppingBasket,
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
  shoppingToText,
  splitOwned,
  tripActualsTotal,
  tripCount,
  tripLabel,
  shoppingTotal,
  type ShoppingCadence,
  type ShoppingItem,
} from "@/lib/plan-shared";
import {
  confirmMonthlyPlan,
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
          "Tu plan mensual de comidas con la lista de la compra y su precio orientativo, ajustada a tu presupuesto.",
      },
      { property: "og:title", content: "Plan del mes · Peppers" },
      {
        property: "og:description",
        content: "Plan mensual de comidas y lista de la compra con precios.",
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
  const confirm = useServerFn(confirmMonthlyPlan);
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

  const lock = useMutation({
    mutationFn: () => confirm({ data: { month } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      toast.success("Compra confirmada: los ingredientes del mes quedan fijos");
    },
    onError: () => toast.error("No hemos podido confirmar la compra"),
  });

  const toggleOwned = useServerFn(toggleShoppingOwned);
  const owned = useMutation({
    mutationFn: (vars: { itemName: string; owned: boolean }) =>
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
  const confirmed = Boolean(planQ.data?.confirmed_at);
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

  const shareList = async () => {
    const text = listText();
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string }) => Promise<void>;
    };
    try {
      if (nav.share) {
        await nav.share({ title: "Lista de la compra", text });
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
    a.download = `lista-compra-${month}.txt`;
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
        {plan && !confirmed ? (
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
            Un mes de comidas flexibles y su lista de la compra con precios, ajustada a tu
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
                ["compra", "Compra", ShoppingBasket],
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
                {confirmed && hasActuals ? (
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

                {confirmed ? (
                  <p className="mt-4 flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2.5 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    Compra confirmada: los ingredientes del mes ya no cambian. Los platos sí puedo
                    recolocarlos.
                  </p>
                ) : (
                  <button
                    onClick={() => lock.mutate()}
                    disabled={lock.isPending}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {lock.isPending ? "Confirmando..." : "Ya he comprado esto"}
                  </button>
                )}
              </div>

              {shopping?.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["Compartir", Share2, shareList],
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
                        if (confirmed || recadence.isPending) return;
                        setCadence(c.key);
                        if (c.key !== activeCadence) recadence.mutate(c.key);
                      }}
                      disabled={confirmed || recadence.isPending}
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
                {confirmed ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    La compra está confirmada: la frecuencia ya no se puede cambiar este mes.
                  </p>
                ) : recadence.isPending ? (
                  <p className="mt-2 text-xs text-muted-foreground">Repartiendo la compra...</p>
                ) : null}
              </div>

              <p className="px-1 text-xs text-muted-foreground">
                Precios orientativos de supermercado. Ajusta cantidades a tu casa.
              </p>
              {trips.map((t) => (
                <TripCard
                  key={t.trip}
                  trip={t}
                  label={tripLabel(activeCadence, t.trip, coverage, tripsTotal)}
                  confirmed={confirmed}
                  tripActual={tripActuals[t.trip]}
                  savingActual={setActual.isPending}
                  onSaveActual={(amount) => setActual.mutate({ trip: t.trip, amount })}
                  onToggleOwned={(itemName, nextOwned) =>
                    owned.mutate({ itemName, owned: nextOwned })
                  }
                />
              ))}
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
 * Tarjeta de una compra: separa lo pendiente de comprar (arriba, agrupado por
 * categoría como en el súper) de lo ya marcado como "en casa" (abajo, oculto
 * por defecto), para que de un vistazo se sepa qué falta de verdad.
 */
function TripCard({
  trip,
  label,
  confirmed,
  tripActual,
  savingActual,
  onSaveActual,
  onToggleOwned,
}: {
  trip: { trip: number; groups: { category: string; items: ShoppingItem[] }[] };
  label: string;
  confirmed: boolean;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
  onToggleOwned: (itemName: string, owned: boolean) => void;
}) {
  const [ownedOpen, setOwnedOpen] = useState(false);
  const tripTotal = shoppingTotal(trip.groups);
  const { pending, owned } = splitOwned(trip.groups);
  const pendingCount = pending.reduce((s, g) => s + g.items.length, 0);
  const ownedCount = owned.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="surface-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="shrink-0 text-xs font-semibold text-primary">{eur(tripTotal)}</span>
      </div>
      {ownedCount > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {pendingCount > 0
            ? `Te falta comprar ${pendingCount} de ${pendingCount + ownedCount}`
            : "Ya tienes todo de esta compra"}
        </p>
      ) : null}

      {pending.map((group) => (
        <ShoppingGroup key={group.category} group={group} onToggleOwned={onToggleOwned} />
      ))}

      {owned.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setOwnedOpen((o) => !o)}
            aria-expanded={ownedOpen}
            className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground"
          >
            <span>Ya en casa ({ownedCount})</span>
            <span>{ownedOpen ? "ocultar" : "ver"}</span>
          </button>
          {ownedOpen
            ? owned.map((group) => (
                <ShoppingGroup key={group.category} group={group} onToggleOwned={onToggleOwned} />
              ))
            : null}
        </div>
      ) : null}

      {confirmed ? (
        <TripActualField
          value={tripActual}
          estimated={tripTotal}
          saving={savingActual}
          onSave={onSaveActual}
        />
      ) : null}
    </div>
  );
}

function ShoppingGroup({
  group,
  onToggleOwned,
}: {
  group: { category: string; items: ShoppingItem[] };
  onToggleOwned: (itemName: string, owned: boolean) => void;
}) {
  return (
    <div className="mt-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {group.category}
      </span>
      <ul className="mt-1.5 space-y-1.5">
        {group.items.map((item) => (
          <li key={item.name} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => onToggleOwned(item.name, !item.owned)}
              aria-label={
                item.owned
                  ? `${item.name}: ya la tienes, quitar marca`
                  : `${item.name}: marcar que ya la tienes en casa`
              }
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors ${
                item.owned ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}
            >
              {item.owned ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </button>
            <span
              className={`min-w-0 flex-1 ${item.owned ? "text-muted-foreground line-through" : ""}`}
            >
              {item.name}
              {item.qty ? <span className="text-muted-foreground"> · {item.qty}</span> : null}
              {item.perishable ? (
                <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                  fresco
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{eur(item.price_eur)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
