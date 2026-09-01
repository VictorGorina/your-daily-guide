import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarRange,
  CalendarSync,
  Carrot,
  Check,
  ChevronLeft,
  ChevronRight,
  Egg,
  Fish,
  Lightbulb,
  Lock,
  Plus,
  Receipt,
  RefreshCw,
  ShoppingBasket,
  ShoppingCart,
  Sparkle,
  Users,
  Wheat,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DayDetailSheet } from "@/components/day-detail-sheet";
import { GoalWeightSummary } from "@/components/goal-weight-summary";
import { MonthSpendSummary } from "@/components/month-spend-summary";
import { PlanMonthCalendar } from "@/components/plan-month-calendar";
import {
  fetchLogs,
  fetchLogsForMonth,
  fetchMonthlyPlan,
  fetchPlannerShopping,
  fetchProfile,
  todayISO,
} from "@/lib/daily";
import { fetchHousehold } from "@/lib/household";
import {
  addMonths,
  boughtTotal,
  cadenceOf,
  CADENCES,
  coverageRatio,
  daysInMonth,
  eur,
  homeTotal,
  isMonthActionable,
  monthCoverage,
  monthTitle,
  pendingTotal,
  planMonthStatus,
  planNavBounds,
  projectTrips,
  shoppingToText,
  tripDayRange,
  tripsOfCadence,
  WEEK_COUNT,
  tripTiming,
  tripToText,
  shoppingTotal,
  tripActualsTotal,
  type PantryExtra,
  type PlanMonthStatus,
  type ShoppingCadence,
  type ShoppingItem,
  type TripReceipts,
  type TripTiming,
} from "@/lib/plan-shared";
import { freshRiskNames, freshRisksForTrip } from "@/lib/perishability";
import {
  generateMonthlyPlan,
  recadenceMonthlyPlan,
  scanTripReceipt,
  setPantryExtra,
  setTripActual,
  setTripConfirmed,
  toggleShoppingOwned,
} from "@/lib/plan.functions";

export const Route = createFileRoute("/_authenticated/plan")({
  validateSearch: (search: Record<string, unknown>): { tab?: "compra"; month?: string } => ({
    tab: search.tab === "compra" ? "compra" : undefined,
    month:
      typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
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
  const today = todayISO();
  const make = useServerFn(generateMonthlyPlan);
  const recad = useServerFn(recadenceMonthlyPlan);
  const search = Route.useSearch();
  const [tab, setTab] = useState<"plan" | "compra">(search.tab ?? "plan");
  // Mes seleccionado en la cabecera: gobierna toda la pantalla (calendario e
  // ingredientes). Por defecto el mes en curso, o el que pida el deep link.
  const [selectedMonth, setSelectedMonth] = useState(search.month ?? today.slice(0, 7));
  const month = selectedMonth;
  // Cadencia que la persona acaba de pulsar mientras el servidor la guarda: solo
  // se usa para resaltar el botón. La cadencia real (`activeCadence`) sigue
  // saliendo de `plan.cadence` hasta que llega la respuesta, para que
  // `projectTrips` no corra con un nº de compras que aún no coincide con los datos.
  const [pendingCadence, setPendingCadence] = useState<ShoppingCadence | null>(null);

  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const globalLogsQ = useQuery({ queryKey: ["logs"], queryFn: fetchLogs });
  const monthLogsQ = useQuery({
    queryKey: ["logs", month],
    queryFn: () => fetchLogsForMonth(month),
  });
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  // Miembro del hogar que NO es quien planifica (D1): sus comidas compartidas y
  // la compra de la casa las lleva el planificador; aquí solo plan-ifica y ve
  // sus comidas en solitario. Cambia el copy del botón de generar y añade la
  // compra del hogar en solo lectura a la pestaña Ingredientes (issue 05).
  const hh = householdQ.data;
  const isSoloPlanner = !!hh?.me && !!hh?.planner && hh.me.id !== hh.planner.id;
  const plannerName = hh?.planner?.display_name ?? "quien lleva la cocina";
  const sharedSlots = hh?.household?.shared_slots ?? null;
  const hasSharedMeals =
    !!sharedSlots &&
    sharedSlots.desayuno.length + sharedSlots.comida.length + sharedSlots.cena.length > 0;

  const plannerShoppingQ = useQuery({
    queryKey: ["planner-shopping", month],
    queryFn: () => fetchPlannerShopping(month),
    enabled: isSoloPlanner,
  });
  // `fetchMonthlyPlan` compone un plan para un no planificador aunque él no
  // tenga fila propia (id ""), para que vea las comidas de la casa. Ese caso
  // necesita todavía un empujón a "planificar mis comidas en solitario".
  const hasOwnPlanRow = !!planQ.data && planQ.data.id !== "";

  const appStartedOn = profileQ.data?.app_started_on ?? null;
  const monthStatus = planMonthStatus(month, today);
  const actionable = isMonthActionable(month, today);
  const bounds = planNavBounds(today, appStartedOn);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      make({ data: { month, cadence: nextCadence ?? "mensual" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No hemos podido crear el plan ahora mismo"),
  });

  // Cambiar la cadencia no llama a la IA: la lista canónica guarda el desglose
  // por semana, así que solo cambia cómo se agrupa en pantalla (`projectTrips`).
  // El servidor guarda la nueva cadencia y devuelve el plan y la compra al día.
  const recadence = useMutation({
    mutationFn: (nextCadence: ShoppingCadence) => recad({ data: { month, cadence: nextCadence } }),
    onSuccess: (res) => {
      setPendingCadence(null);
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, plan: res.plan, shopping: res.shopping } : prev,
      );
    },
    onError: (e) => {
      setPendingCadence(null);
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

  const pantryFn = useServerFn(setPantryExtra);
  const pantry = useMutation({
    mutationFn: (vars: { name: string; qty?: string; remove?: boolean }) =>
      pantryFn({ data: { month, ...vars } }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, pantry_extras: res.pantry_extras } : prev,
      );
    },
    onError: () => toast.error("No hemos podido guardar el ingrediente"),
  });

  const receiptFn = useServerFn(scanTripReceipt);
  const receipt = useMutation({
    mutationFn: (vars: { trip: number; imageBase64: string; mime: string }) =>
      receiptFn({ data: { month, ...vars } }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev
          ? {
              ...prev,
              trip_actuals: res.trip_actuals,
              trip_receipts: res.trip_receipts,
              pantry_extras: res.pantry_extras,
            }
          : prev,
      );
      const parts = [`Gasto guardado: ${eur(res.total)}`];
      if (res.added.length) parts.push(`Añadí a tu despensa: ${res.added.join(", ")}`);
      if (res.discarded.length)
        parts.push(`Descarté: ${res.discarded.map((d) => `${d.name} (${d.reason})`).join(", ")}`);
      toast.success(parts.join(". "));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No hemos podido leer el tiquet"),
  });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  // Total del mes: solo para el aviso de presupuesto. Las cifras de la tarjeta
  // "Te falta comprar" son de la compra seleccionada y se calculan dentro de
  // IngredientsTab (diseño 1c).
  const monthTotal = shoppingTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const tripReceipts: TripReceipts = planQ.data?.trip_receipts ?? {};
  const pantryExtras: PantryExtra[] = planQ.data?.pantry_extras ?? [];
  const confirmedTrips = planQ.data?.confirmed_trips ?? {};
  const coverage = plan?.coverage;
  const activeCadence: ShoppingCadence = plan?.cadence ?? cadenceOf(shopping);
  const tripsTotal = tripsOfCadence(activeCadence);
  // Cada compra suma lo que piden los platos de las semanas que cubre
  // (`projectTrips`); cambiar de cadencia solo re-trocea el mismo total del mes.
  const projCoverage = coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const trips = projectTrips(
    shopping,
    activeCadence,
    projCoverage,
    plan?.weeks.length ?? WEEK_COUNT,
  );
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
  // Abre mostrando TODO (auditoría): marcas lo que ya tienes y "Ir a comprar"
  // te lleva al modo súper solo con lo que falta.
  const [filter, setFilter] = useState<"need" | "have" | "all">("all");
  // Modo compra a pantalla completa
  const [shopMode, setShopMode] = useState(false);
  const safeTrip = Math.min(selectedTrip, Math.max(0, tripsTotal - 1));

  // Al cambiar de mes, el índice de compra y el modo compra dejan de tener
  // sentido (dependían del plan del mes anterior). El primer render se salta
  // para no pisar el `selectedTrip` inicial (que apunta a la compra en curso).
  const prevMonthRef = useRef(month);
  useEffect(() => {
    if (prevMonthRef.current === month) return;
    prevMonthRef.current = month;
    setSelectedTrip(0);
    setShopMode(false);
    setOpenDay(null);
  }, [month]);

  const goToMonth = (target: string) => {
    if (target < bounds.earliest || target > bounds.latest) return;
    setSelectedMonth(target);
    setTab("plan");
  };

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
  const overBudget = periodBudget > 0 && monthTotal > periodBudget;

  const canPrev = month > bounds.earliest;
  const canNext = month < bounds.latest;
  // El navegador se para en el mes en curso mientras el siguiente sigue
  // bloqueado; el botón muestra un candado y explica cuándo se abrirá.
  const nextIsLocked = !canNext && planMonthStatus(addMonths(month, 1), today) === "next-locked";
  // Pantalla completa "crea tu plan": solo para meses donde se puede generar.
  const showCreateTakeover = !plan && actionable;
  const readOnlyMonth = monthStatus === "past";

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <header className="animate-rise flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Plan mensual
          </p>
          <div className="mt-0.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToMonth(addMonths(month, -1))}
              disabled={!canPrev}
              aria-label="Mes anterior"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-center font-title text-[28px] font-semibold capitalize tracking-[-0.03em]">
              {monthTitle(month)}
            </h1>
            <button
              type="button"
              onClick={() =>
                nextIsLocked
                  ? toast.info(
                      `Podrás preparar ${monthTitle(addMonths(month, 1))} la última semana de ${monthTitle(month)}.`,
                    )
                  : goToMonth(addMonths(month, 1))
              }
              disabled={!canNext && !nextIsLocked}
              aria-label={nextIsLocked ? "Mes siguiente (aún bloqueado)" : "Mes siguiente"}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground disabled:opacity-30"
            >
              {nextIsLocked ? <Lock className="h-4 w-4" /> : <ChevronRight className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {plan && actionable ? (
          <button
            onClick={() => generate.mutate(undefined)}
            disabled={generate.isPending}
            aria-label={
              isSoloPlanner ? "Volver a planificar mis comidas en solitario" : "Regenerar plan"
            }
            className="mt-1 rounded-full bg-surface p-2.5 text-muted-foreground disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${generate.isPending ? "animate-spin" : ""}`} />
          </button>
        ) : null}
      </header>

      {showCreateTakeover ? (
        <section className="surface-card animate-rise mt-8 p-6 text-center">
          <CalendarRange className="mx-auto h-7 w-7 text-primary" />
          <h2 className="mt-3 text-sm font-semibold">
            {isSoloPlanner
              ? "Planifica tus comidas en solitario"
              : monthStatus === "next-unlocked"
                ? `Prepara tu plan de ${monthTitle(month)}`
                : "Todavía no tienes plan de este mes"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isSoloPlanner
              ? `Las comidas compartidas de tu casa las lleva ${plannerName}. Esto planifica solo lo que comes por tu cuenta (desayunos, snacks y los días que no compartís).`
              : monthStatus === "next-unlocked"
                ? "Créalo ya y tendrás la lista de la compra lista antes de que empiece el mes."
                : "Un mes de comidas flexibles y sus ingredientes del mes con precios, ajustada a tu presupuesto."}
          </p>
          <button
            onClick={() => generate.mutate(undefined)}
            disabled={generate.isPending || planQ.isLoading}
            className="mt-5 w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {generate.isPending
              ? "Preparando tu mes..."
              : isSoloPlanner
                ? "Planificar mis comidas en solitario"
                : monthStatus === "next-unlocked"
                  ? `Crear plan de ${monthTitle(month)}`
                  : "Crear plan del mes"}
          </button>
        </section>
      ) : (
        <>
          <div className="sticky top-3 z-10 mt-6 grid grid-cols-2 gap-2 rounded-full bg-secondary/80 p-1 backdrop-blur">
            {(
              [
                ["plan", "Plan", CalendarRange],
                ["compra", "Ingredientes", ShoppingBasket],
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

          {isSoloPlanner && hasSharedMeals ? (
            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-secondary/60 px-3.5 py-2.5">
              <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Las comidas compartidas de tu casa las lleva{" "}
                <span className="font-medium text-foreground">{plannerName}</span>. Aquí solo
                planificas y ves tus comidas en solitario.
              </p>
            </div>
          ) : null}

          {tab === "plan" ? (
            <section className="mt-5 space-y-5">
              <GoalWeightSummary logs={globalLogsQ.data ?? []} profile={profileQ.data ?? null} />

              <MonthSpendSummary
                shopping={shopping}
                tripActuals={tripActuals}
                tripReceipts={tripReceipts}
                periodBudget={periodBudget}
                partialMonth={partialMonth}
                monthStatus={monthStatus}
              />

              {plan ? (
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
              ) : null}

              <PlanMonthCalendar
                plan={plan}
                month={month}
                logs={monthLogsQ.data ?? []}
                monthStatus={monthStatus}
                appStartedOn={appStartedOn}
                onOpenDay={setOpenDay}
              />

              {!plan && !(monthLogsQ.data?.length ?? 0) ? (
                <p className="px-1 text-sm text-muted-foreground">
                  No planificaste {monthTitle(month)}.
                </p>
              ) : null}
            </section>
          ) : shopMode && actionable ? (
            <ShopModeView
              trip={trips[safeTrip]}
              coverage={coverage}
              tripsTotal={tripsTotal}
              selectedTrip={safeTrip}
              month={month}
              onToggle={(itemName) => owned.mutate({ itemName, trip: safeTrip, source: "store" })}
              onClose={() => setShopMode(false)}
              tripActual={tripActuals[safeTrip]}
              savingActual={setActual.isPending}
              onSaveActual={(amount) => setActual.mutate({ trip: safeTrip, amount })}
              onScanReceipt={(imageBase64, mime) =>
                receipt.mutate({ trip: safeTrip, imageBase64, mime })
              }
              scanningReceipt={receipt.isPending}
            />
          ) : isSoloPlanner ? (
            <div className="mt-5 space-y-4">
              {plannerShoppingQ.data ? (
                <HouseholdShoppingBlock
                  row={plannerShoppingQ.data}
                  month={month}
                  plannerName={plannerName}
                  today={today}
                />
              ) : null}

              <div className="flex items-center gap-2 px-0.5 pt-1">
                <ShoppingBasket className="h-4 w-4 text-primary" />
                <h2 className="font-title text-lg font-semibold tracking-[-0.02em]">
                  Tu compra en solitario
                </h2>
              </div>

              {hasOwnPlanRow ? (
                <IngredientsTab
                  shopping={shopping}
                  trips={trips}
                  tripsTotal={tripsTotal}
                  activeCadence={activeCadence}
                  pendingCadence={pendingCadence}
                  coverage={coverage}
                  todayDayOfMonth={todayDayOfMonth}
                  selectedTrip={safeTrip}
                  setSelectedTrip={setSelectedTrip}
                  filter={filter}
                  setFilter={setFilter}
                  recadence={recadence}
                  setPendingCadence={setPendingCadence}
                  owned={owned}
                  tripActuals={tripActuals}
                  setActual={setActual}
                  confirmedTrips={confirmedTrips}
                  confirmTrip={confirmTrip}
                  pantryExtras={pantryExtras}
                  pantry={pantry}
                  onEnterShopMode={() => setShopMode(true)}
                  onShareTrip={(trip, label) => void shareTrip(trip, label)}
                  month={month}
                  monthStatus={monthStatus}
                  readOnly={readOnlyMonth}
                  periodBudget={periodBudget}
                  partialMonth={partialMonth}
                  overBudget={overBudget}
                />
              ) : (
                <div className="surface-card p-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    Aún no tienes lista propia. Planifica tus comidas en solitario (desayunos,
                    snacks y los días que no compartís) y aparecerá aquí.
                  </p>
                  {actionable ? (
                    <button
                      onClick={() => generate.mutate(undefined)}
                      disabled={generate.isPending}
                      className="mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                    >
                      {generate.isPending ? "Preparando…" : "Planificar mis comidas en solitario"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <IngredientsTab
              shopping={shopping}
              trips={trips}
              tripsTotal={tripsTotal}
              activeCadence={activeCadence}
              pendingCadence={pendingCadence}
              coverage={coverage}
              todayDayOfMonth={todayDayOfMonth}
              selectedTrip={safeTrip}
              setSelectedTrip={setSelectedTrip}
              filter={filter}
              setFilter={setFilter}
              recadence={recadence}
              setPendingCadence={setPendingCadence}
              owned={owned}
              tripActuals={tripActuals}
              setActual={setActual}
              confirmedTrips={confirmedTrips}
              confirmTrip={confirmTrip}
              pantryExtras={pantryExtras}
              pantry={pantry}
              onEnterShopMode={() => setShopMode(true)}
              onShareTrip={(trip, label) => void shareTrip(trip, label)}
              month={month}
              monthStatus={monthStatus}
              readOnly={readOnlyMonth}
              periodBudget={periodBudget}
              partialMonth={partialMonth}
              overBudget={overBudget}
            />
          )}
        </>
      )}

      <DayDetailSheet
        date={openDay}
        plan={plan}
        log={monthLogsQ.data?.find((l) => l.log_date === openDay)}
        profile={profileQ.data ?? null}
        onClose={() => setOpenDay(null)}
      />

      {/* En Modo compra la pantalla es completa (diseño 1b): sin barra de nav. */}
      {shopMode && actionable ? null : <BottomNav />}
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

/**
 * "La compra de la casa" — la lista del planificador, en SOLO LECTURA, para un
 * miembro que no es quien planifica (issue 05, D1). Ve qué se compra y cuánto,
 * pero no marca "lo tengo" ni cambia cantidades ni cadencia: eso lo lleva el
 * planificador. En issue 06 el estado de compra ("lo tengo en casa", gasto
 * real, despensa) pasa a ser editable por cualquier miembro. La vista es el
 * total del mes (una sola proyección "mensual"), sin el navegador de compras.
 */
function HouseholdShoppingBlock({
  row,
  month,
  plannerName,
  today,
}: {
  row: import("@/lib/daily").PlannerShoppingRow;
  month: string;
  plannerName: string;
  today: string;
}) {
  const [open, setOpen] = useState(true);
  const coverage = row.plan?.coverage ?? monthCoverage(month, today);
  const groups = useMemo(
    () => projectTrips(row.shopping, "mensual", coverage, WEEK_COUNT)[0]?.groups ?? [],
    [row.shopping, coverage],
  );
  const total = shoppingTotal(groups);
  const itemCount = groups.reduce((s, g) => s + g.items.length, 0);

  if (!itemCount) return null;

  return (
    <section className="surface-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
      >
        <ShoppingCart className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">La compra de la casa</p>
          <p className="text-[11.5px] text-muted-foreground">
            la lleva {plannerName} · {itemCount} artículos · {eur(total)}
          </p>
        </div>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open ? (
        <div className="border-t border-border/60 px-4 pb-4 pt-1">
          <p className="py-2 text-[11.5px] leading-relaxed text-muted-foreground">
            Solo para consultar. Las cantidades son para toda la mesa; lo que compres y marques como
            comprado lo gestiona {plannerName}.
          </p>
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.category}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <CategoryIcon category={group.category} className="h-3 w-3" />
                  {group.category}
                </div>
                <ul className="mt-1 divide-y divide-border/50">
                  {group.items.map((item) => (
                    <li
                      key={`${group.category}-${item.name}`}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]"
                    >
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                        {item.qty} · {eur(item.price_eur ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Reescala una imagen a JPEG de como máximo `maxSide` px de lado y devuelve el
 * base64 sin la cabecera `data:`. Una foto de tiquet queda muy por debajo del
 * límite de tamaño del endpoint y del body de Vercel.
 */
async function imageFileToBase64(
  file: File,
  maxSide = 1280,
): Promise<{ base64: string; mime: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("No se pudo abrir la imagen"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { base64: dataUrl.split(",")[1] ?? "", mime: file.type || "image/jpeg" };
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.72);
  return { base64: out.split(",")[1] ?? "", mime: "image/jpeg" };
}

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
  const [name, setName] = useState("");
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || pantry.isPending) return;
    pantry.mutate({ name: trimmed });
    setName("");
  };
  return (
    <div className="surface-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Carrot className="h-[15px] w-[15px] shrink-0 text-primary" />
        <h3 className="flex-1 text-[12.5px] font-semibold">Ya lo tengo en casa · fuera del plan</h3>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        Si tienes algo que la lista no incluye, dímelo y lo tendré en cuenta al recolocar los
        próximos días. No se añade a la compra.
      </p>
      <div className="mt-2.5 flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="p. ej. lentejas, espinacas..."
          className="min-w-0 flex-1 rounded-full bg-secondary px-3.5 py-2 text-xs outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          onClick={add}
          disabled={pantry.isPending || !name.trim()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
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
                aria-label={`Quitar ${e.name}`}
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
  pendingCadence,
  setPendingCadence,
  owned,
  tripActuals,
  setActual,
  confirmedTrips,
  confirmTrip,
  pantryExtras,
  pantry,
  onEnterShopMode,
  onShareTrip,
  month,
  monthStatus,
  readOnly,
  periodBudget,
  partialMonth,
  overBudget,
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
  setActual: { isPending: boolean; mutate: (v: { trip: number; amount: number | null }) => void };
  confirmedTrips: Record<number, string>;
  confirmTrip: { isPending: boolean; mutate: (v: { trip: number; confirmed: boolean }) => void };
  pantryExtras: PantryExtra[];
  pantry: {
    isPending: boolean;
    mutate: (v: { name: string; qty?: string; remove?: boolean }) => void;
  };
  onEnterShopMode: () => void;
  onShareTrip: (
    trip: { groups: { category: string; items: ShoppingItem[] }[] },
    label: string,
  ) => void;
  month: string;
  monthStatus: PlanMonthStatus;
  readOnly: boolean;
  periodBudget: number;
  partialMonth: boolean;
  overBudget: boolean;
}) {
  const currentTrip = trips[selectedTrip] ?? trips[0];
  const timing = tripTiming(tripsTotal, selectedTrip, todayDayOfMonth, coverage);
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

  // Frescos que esta compra no cubre sin que se estropeen: no cambia la lista,
  // solo avisa de comprarlos más cerca de cuando se cocinan.
  const freshRisks = freshRisksForTrip(tripGroups, covOrFull, tripsTotal, selectedTrip);

  // Barras de progreso del resumen
  const barHome = total > 0 ? (alreadyHome / total) * 100 : 0;
  const barBought = total > 0 ? (alreadyBought / total) * 100 : 0;

  return (
    <section className="mt-5 space-y-3 pb-40">
      {readOnly ? (
        <div className="rounded-[20px] bg-secondary/60 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Compra de un mes ya pasado: se muestra solo para consultar, no se puede modificar.
          </p>
        </div>
      ) : (
        /* Cadencia */
        <div className="surface-card px-4 py-3.5">
          <div className="flex items-center gap-2">
            <CalendarSync className="h-[15px] w-[15px] shrink-0 text-primary" />
            <h3 className="flex-1 text-[12.5px] font-semibold">Cada cuánto compras</h3>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-full bg-secondary/70 p-1">
            {CADENCES.map((c) => {
              const selected = (pendingCadence ?? activeCadence) === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => {
                    if (recadence.isPending || c.key === activeCadence) return;
                    setPendingCadence(c.key);
                    recadence.mutate(c.key);
                  }}
                  disabled={recadence.isPending}
                  className={`rounded-full py-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-60 ${
                    selected ? "bg-foreground text-background" : "text-muted-foreground"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
            {recadence.isPending
              ? "Actualizando…"
              : tripsTotal > 1
                ? `${tripsTotal} compras separadas, cada una con lo de sus semanas.`
                : "1 sola compra: apóyate en despensa y congelados; los frescos, sobre la marcha."}
          </p>
        </div>
      )}

      {/* Aviso de presupuesto: es del mes entero, no de una compra. */}
      {overBudget ? (
        <div className="rounded-[20px] bg-destructive/10 px-4 py-3">
          <p className="text-xs leading-relaxed text-destructive">
            El mes se pasa de tu presupuesto ({eur(periodBudget)}). Puedo ajustarlo: regenera el
            plan o dímelo en el chat.
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
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-surface text-muted-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[12.5px] font-semibold">
              {activeCadence === "mensual"
                ? "Compra única del mes"
                : `Compra ${selectedTrip + 1} de ${tripsTotal}`}
              {monthStatus === "current" && timing === "current" ? " · esta semana" : ""}
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
        {tripActual != null ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Gastaste en esta compra: <span className="font-semibold">{eur(tripActual)}</span>{" "}
            {tripActual !== total ? (
              <span className={tripActual > total ? "text-destructive" : "text-success"}>
                ({tripActual > total ? "+" : ""}
                {eur(tripActual - total)} vs. lo estimado)
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Aviso de frescura: frescos que no aguantan los días de esta compra. */}
      {freshRisks.length ? (
        <div className="rounded-[20px] bg-warning/20 px-4 py-3">
          <p className="text-xs leading-relaxed text-foreground">
            {freshRiskNames(freshRisks)} {freshRisks.length === 1 ? "no aguanta" : "no aguantan"}{" "}
            los {tripRange.to - tripRange.from + 1} días de esta compra. Cómpralo
            {freshRisks.length === 1 ? "" : "s"} más cerca de cuando los vayas a cocinar.
          </p>
        </div>
      ) : null}

      {/* Cabecera + filtros */}
      <div className="flex items-center justify-between gap-2.5 px-0.5">
        <h2 className="font-title text-xl font-semibold tracking-[-0.02em]">Ingredientes</h2>
        <span className="text-[11.5px] text-muted-foreground">{pctResolved}% ya resuelto</span>
      </div>
      <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
        Marca lo que ya tengas en casa; lo que quede sin marcar es tu lista del súper. Cuando
        termines, pulsa <span className="font-semibold text-foreground">Ir a comprar</span>.
      </p>

      <div className="flex gap-1.5">
        {(
          [
            ["all", "Todo", totalItems],
            ["need", "Falta comprar", needCount],
            ["have", "Ya lo tengo", haveCount],
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
              {g.items.map((item, i) => {
                const have = !!item.owned;
                return (
                  <li
                    key={`${item.name}-${i}`}
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
            {readOnly
              ? "No hubo lista de la compra este mes."
              : "Aún no hay lista. Regenera el plan para crearla."}
          </p>
        ) : filteredGroups.length === 0 ? (
          <p className="px-0.5 text-sm text-muted-foreground">
            {filter === "need"
              ? "No te falta nada de esta compra."
              : filter === "have"
                ? "Todavía no has marcado nada como que ya lo tienes."
                : "Esta compra no tiene ingredientes."}
          </p>
        ) : null}
      </div>

      {/* Ya tengo en casa fuera del plan */}
      {readOnly ? null : <PantryExtrasCard extras={pantryExtras} pantry={pantry} />}

      {/* Tip de persistencia */}
      {readOnly ? null : (
        <div className="flex items-start gap-2.5 rounded-[20px] bg-primary/10 px-4 py-3.5">
          <Lightbulb className="mt-0.5 h-[15px] w-[15px] shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Lo que marques como "en casa" se guarda para las siguientes compras del mes: no te lo
            volveré a pedir mientras te dure.
          </p>
        </div>
      )}

      {/* CTA fijo al fondo — "Ir a comprar" */}
      {!readOnly && shopping?.length && needCount > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(6.75rem+env(safe-area-inset-bottom))] z-30 pl-5 pr-[4.75rem] sm:px-5">
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
  coverage,
  tripsTotal,
  selectedTrip,
  month,
  onToggle,
  onClose,
  tripActual,
  savingActual,
  onSaveActual,
  onScanReceipt,
  scanningReceipt,
}: {
  trip: { trip: number; groups: { category: string; items: ShoppingItem[] }[] } | undefined;
  coverage: { fromDay: number; toDay: number } | undefined;
  tripsTotal: number;
  selectedTrip: number;
  month: string;
  onToggle: (itemName: string) => void;
  onClose: () => void;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
  onScanReceipt: (imageBase64: string, mime: string) => void;
  scanningReceipt: boolean;
}) {
  const [text, setText] = useState(tripActual != null ? String(tripActual) : "");
  const fileRef = useRef<HTMLInputElement>(null);
  const pickReceipt = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { base64, mime } = await imageFileToBase64(file);
      if (base64) onScanReceipt(base64, mime);
    } catch {
      toast.error("No hemos podido preparar la foto");
    }
  };

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

  const covOrFull = coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const tripRange = tripDayRange(covOrFull, tripsTotal, selectedTrip);
  const freshRisks = trip
    ? freshRisksForTrip(trip.groups, covOrFull, tripsTotal, selectedTrip)
    : [];
  const monthShort = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "short",
  });

  // Último importe enviado, para que `commitActual` no repita la misma mutación
  // cuando lo disparan seguidos el onBlur del campo y el onClick del botón.
  const savedActual = useRef<number | null | undefined>(tripActual);
  const commitActual = () => {
    const trimmed = text.trim().replace(",", ".");
    if (!trimmed) {
      if (savedActual.current != null) {
        savedActual.current = null;
        onSaveActual(null);
      }
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n !== savedActual.current) {
      const rounded = Math.round(n * 100) / 100;
      savedActual.current = rounded;
      onSaveActual(rounded);
    }
  };

  return (
    // Modo compra: pantalla completa enfocada (diseño 1b). El overlay tapa la
    // barra de navegación y la burbuja del coach; se sale con la flecha ←.
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto px-5 pb-6 pt-12">
        <div className="mx-auto max-w-lg">
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
                Compra {selectedTrip + 1} de {tripsTotal} · {tripRange.from}–{tripRange.to}{" "}
                {monthShort}
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
              {leftItems.length} de {allItems.length} por coger · lo que ya tienes en casa no
              aparece aquí
            </p>
          </div>

          {freshRisks.length ? (
            <div className="mt-3.5 rounded-[18px] bg-warning/20 px-4 py-3">
              <p className="text-xs leading-relaxed text-foreground">
                {freshRiskNames(freshRisks)}{" "}
                {freshRisks.length === 1 ? "no aguanta" : "no aguantan"} los{" "}
                {tripRange.to - tripRange.from + 1} días hasta la próxima compra. Cógelo
                {freshRisks.length === 1 ? "" : "s"} justo para los primeros platos.
              </p>
            </div>
          ) : null}

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
                  {g.items.map((item, i) => {
                    const done = item.owned === "store";
                    return (
                      <li
                        key={`${item.name}-${i}`}
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
        </div>
      </div>

      {/* Botón fijo al fondo (diseño 1b) */}
      <div className="border-t border-secondary bg-background px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
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
                  placeholder={eur(Math.round(doneTotal * 100) / 100)}
                  disabled={savingActual}
                  className="w-24 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm tabular-nums disabled:opacity-60"
                />
                <span className="text-xs text-muted-foreground">€</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void pickReceipt(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scanningReceipt}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-secondary py-3 text-xs font-semibold text-muted-foreground disabled:opacity-60"
              >
                <Receipt className="h-4 w-4" />
                {scanningReceipt ? "Leyendo el tiquet..." : "Escanear tiquet y calcularlo"}
              </button>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                La foto se usa solo para leer el total y los productos; no se guarda.
              </p>
              <button
                type="button"
                onClick={() => {
                  // "guardar gasto" tiene que guardar aunque el foco siga en el
                  // campo (Enter, o clic sin que dispare el onBlur antes).
                  commitActual();
                  onClose();
                }}
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
    </div>
  );
}
