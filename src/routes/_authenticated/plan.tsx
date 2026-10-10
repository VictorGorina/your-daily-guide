import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Lock,
  ShoppingBasket,
  Sparkle,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DayDetailSheet } from "@/components/day-detail-sheet";
import { GoalWeightSummary } from "@/components/goal-weight-summary";
import { MonthIntakeChat } from "@/components/month-intake-chat";
import { MonthSpendSummary } from "@/components/month-spend-summary";
import { IngredientsTab } from "@/components/plan/ingredients-tab";
import { ShoppingMode } from "@/components/plan/shopping-mode";
import { PlanMonthCalendar } from "@/components/plan-month-calendar";
import {
  fetchLogs,
  fetchLogsForMonth,
  addMessage,
  fetchMonthlyPlan,
  fetchPlannerShopping,
  fetchProfile,
  todayISO,
} from "@/lib/daily";
import { fetchHousehold, householdSharedSlots } from "@/lib/household";
import { dateLocale } from "@/lib/i18n";
import {
  addMonths,
  cadenceOf,
  capitalizeFirst,
  coverageRatio,
  daysInMonth,
  effectiveMealSlots,
  isMonthActionable,
  monthParts,
  monthTitle,
  planMonthStatus,
  planNavBounds,
  projectTrips,
  tripsForCoverage,
  WEEK_COUNT,
  tripTiming,
  shoppingTotal,
  type PantryExtra,
  type ShoppingCadence,
  type TripReceipts,
} from "@/lib/plan-shared";
import {
  fitPlanOnce,
  planDishesToWarm,
  useRecipeWarmProgress,
  warmPlanRecipes,
} from "@/lib/recipe-warm";
import { PlanFitNote } from "@/components/plan-fit-note";
import { warmRecipes } from "@/lib/recipes.functions";
import {
  flushPlanRecalc,
  onPlanRecalcDone,
  schedulePlanRecalc,
  wirePlanRecalcFlush,
} from "@/lib/plan-recalc";
import {
  fitMonthlyPlan,
  generateMonthlyPlan,
  recadenceMonthlyPlan,
  welcomeBriefing,
} from "@/lib/plan.functions";
import { useShoppingMutations } from "@/lib/use-shopping-mutations";

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
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
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
  const plannerName = hh?.planner?.display_name ?? t("plan.plannerFallback");
  // La regla del servidor (horarios de cada persona), no la columna a pelo.
  const sharedSlots = householdSharedSlots(hh);
  // Para que el calendario del mes solo oculte "Ver receta" a quien de verdad
  // cambió un plato compartido, no al resto del hogar (`dishChangeIsMine`).
  const homePlanner = sharedSlots ? { isPlanner: !!hh?.me?.is_planner, sharedSlots } : null;
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

  // --- Compra de la casa (issue 06) --------------------------------------
  // Un miembro no planificador ve y OPERA la lista del planificador: marcar en
  // casa / comprado por tramo, gasto real, tiquet, despensa — con navegador de
  // compras y modo compra propios, para poder ir al súper de forma autónoma.
  // Solo se le ocultan regenerar el plan y cambiar la cadencia (eso lo decide
  // el planificador). El servidor resuelve la fila objetivo (`resolveShoppingRow`).
  const plannerShopping = plannerShoppingQ.data?.shopping ?? null;
  const plannerPlan = plannerShoppingQ.data?.plan ?? null;
  const plannerCadence: ShoppingCadence = plannerPlan?.cadence ?? cadenceOf(plannerShopping);
  const plannerCoverage = plannerPlan?.coverage;
  const plannerTripsTotal = tripsForCoverage(plannerCadence, plannerCoverage);
  const plannerCadenceFrom = plannerPlan?.cadenceFrom;
  const hhTrips = useMemo(
    () =>
      projectTrips(
        plannerShopping,
        plannerCadence,
        plannerCoverage ?? { fromDay: 1, toDay: daysInMonth(month) },
        WEEK_COUNT,
        plannerCadenceFrom,
      ),
    [plannerShopping, plannerCadence, plannerCoverage, month, plannerCadenceFrom],
  );
  const hhTripActuals = plannerShoppingQ.data?.trip_actuals ?? {};
  const hhPantryExtras: PantryExtra[] = plannerShoppingQ.data?.pantry_extras ?? [];
  const [hhSelectedTrip, setHhSelectedTrip] = useState(0);
  const [hhFilter, setHhFilter] = useState<"need" | "have" | "all">("all");
  const hhSafeTrip = Math.min(hhSelectedTrip, Math.max(0, plannerTripsTotal - 1));
  const hasHouseholdShopping = isSoloPlanner && (plannerShopping?.length ?? 0) > 0;

  const appStartedOn = profileQ.data?.app_started_on ?? null;
  const monthStatus = planMonthStatus(month, today);
  const actionable = isMonthActionable(month, today);

  const bounds = planNavBounds(today, appStartedOn);
  const [openDay, setOpenDay] = useState<string | null>(null);

  // Un mes se genera UNA vez, y siempre tras la conversación con el coach
  // (`MonthIntakeChat`): "Crear plan" abre las cinco preguntas y la última
  // genera. El primer plan de la persona (`firstPlan`) trae además el
  // mensaje de bienvenida del coach, que antes pedía el onboarding.
  const [intakeOpen, setIntakeOpen] = useState(false);
  const briefFn = useServerFn(welcomeBriefing);
  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      make({ data: { month, cadence: nextCadence ?? "mensual", today } }),
    onSuccess: (res) => {
      setIntakeOpen(false);
      qc.invalidateQueries({ queryKey: ["plan", month] });
      if (res.firstPlan) {
        void briefFn({ data: { month } })
          .then(({ text }) => (text ? addMessage("assistant", text) : undefined))
          .catch(() => undefined);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("plan.errors.create")),
  });

  // Cambiar la cadencia no llama a la IA: la lista canónica guarda el desglose
  // por semana, así que solo cambia cómo se agrupa en pantalla (`projectTrips`).
  // El servidor guarda la nueva cadencia y devuelve el plan y la compra al día.
  const recadence = useMutation({
    mutationFn: (nextCadence: ShoppingCadence) =>
      recad({ data: { month, cadence: nextCadence, today: todayISO() } }),
    onSuccess: (res) => {
      setPendingCadence(null);
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, plan: res.plan, shopping: res.shopping } : prev,
      );
    },
    onError: (e) => {
      setPendingCadence(null);
      toast.error(e instanceof Error ? e.message : t("plan.errors.recadence"));
    },
  });

  // Un cambio en la despensa propia invalida los platos de los días futuros: se
  // programa un recálculo silencioso con debounce (issue 05). No para un no
  // planificador (su despensa va a la fila del planificador y el servidor no
  // regenera el plan de otra persona).
  const recalcFromPantry = () => {
    if (!isSoloPlanner) schedulePlanRecalc(month, today, "meals");
  };

  // Estado de la compra (propia y de la casa): optimista y en serie por mes,
  // ver `useShoppingMutations`.
  const {
    own: { owned, actual: setActual, pantry, receipt },
    house: { owned: hhOwned, actual: hhSetActual, pantry: hhPantry, receipt: hhReceipt },
  } = useShoppingMutations(month, { onOwnPantryChanged: recalcFromPantry });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  // Total del mes: solo para el aviso de presupuesto. Las cifras de la tarjeta
  // "Te falta comprar" son de la compra seleccionada y se calculan dentro de
  // IngredientsTab (diseño 1c).
  const monthTotal = shoppingTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const tripReceipts: TripReceipts = planQ.data?.trip_receipts ?? {};
  const pantryExtras: PantryExtra[] = planQ.data?.pantry_extras ?? [];
  const coverage = plan?.coverage;
  const activeCadence: ShoppingCadence = plan?.cadence ?? cadenceOf(shopping);
  const tripsTotal = tripsForCoverage(activeCadence, coverage);
  // Cada compra suma lo que piden los platos de las semanas que cubre
  // (`projectTrips`); cambiar de cadencia solo re-trocea el mismo total del mes.
  // La compra va siempre en `WEEK_COUNT` semanas, aunque el plan tenga la fila
  // de los días 29-31: esos días cuentan en la última.
  // Memoizado (ticket 28): sin esto cada render daba una lista nueva y el
  // `useMemo` de `IngredientsTab` sobre la compra seleccionada no servía.
  const cadenceFrom = plan?.cadenceFrom;
  const trips = useMemo(
    () =>
      projectTrips(
        shopping,
        activeCadence,
        coverage ?? { fromDay: 1, toDay: daysInMonth(month) },
        WEEK_COUNT,
        cadenceFrom,
      ),
    [shopping, activeCadence, coverage, month, cadenceFrom],
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
  // Modo compra a pantalla completa. `shopSource` decide sobre qué lista opera:
  // la propia o la de la casa (un no planificador compra la de la casa, issue 06).
  const [shopMode, setShopMode] = useState(false);
  const [shopSource, setShopSource] = useState<"own" | "household">("own");
  const safeTrip = Math.min(selectedTrip, Math.max(0, tripsTotal - 1));

  // Al cambiar de mes, el índice de compra y el modo compra dejan de tener
  // sentido (dependían del plan del mes anterior). El primer render se salta
  // para no pisar el `selectedTrip` inicial (que apunta a la compra en curso).
  const prevMonthRef = useRef(month);
  useEffect(() => {
    if (prevMonthRef.current === month) return;
    prevMonthRef.current = month;
    setSelectedTrip(0);
    setHhSelectedTrip(0);
    setShopMode(false);
    setShopSource("own");
    setOpenDay(null);
  }, [month]);

  // Recálculo automático del plan (issue 05). Red de seguridad: si la persona
  // cambió la despensa o la mesa y cerró la pestaña antes de que saltara el
  // debounce, se lanza aquí al abrir/volver a Plan. `wirePlanRecalcFlush` engancha
  // además el envío al ocultar la pestaña. Cuando un recálculo termina se refresca
  // el plan en pantalla (el `intro` explica qué cambió; no hay más aviso).
  useEffect(() => {
    wirePlanRecalcFlush();
    return onPlanRecalcDone((done) => {
      qc.invalidateQueries({ queryKey: ["plan", done] });
      qc.invalidateQueries({ queryKey: ["planner-shopping", done] });
    });
  }, [qc]);
  useEffect(() => {
    if (!isSoloPlanner) flushPlanRecalc(month);
  }, [month, isSoloPlanner]);

  // Todos los platos del plan, calculados al generarlo o cambiarlo (ticket 06,
  // D13): ninguno llega a Hoy "Calculando…". Solo lo que falte en la caché; si
  // la app se cerró a medias, se retoma aquí.
  //
  // Con todos calculados, UNA comprobación del plan contra el objetivo (ticket
  // 10, `fitMonthlyPlan`): cambia los platos que ni ajustando la cantidad dejan
  // el día en su objetivo. Una vez por plan (la marca `plan.fit`); lo que
  // cambió se enseña en "Cómo enfocamos el mes".
  const warmFn = useServerFn(warmRecipes);
  const fitFn = useServerFn(fitMonthlyPlan);
  const warmProgress = useRecipeWarmProgress();
  const [fitting, setFitting] = useState(false);
  useEffect(() => {
    if (!plan || !actionable) return;
    let alive = true;
    void warmPlanRecipes(planDishesToWarm(plan, month, today), (dishes) =>
      warmFn({ data: { dishes } }),
    ).then(async (complete) => {
      if (!alive || !complete || plan.fit || !plan.targetsVersion) return;
      setFitting(true);
      const res = await fitPlanOnce(month, () => fitFn({ data: { month, today } }));
      if (alive) setFitting(false);
      if (res?.fit) qc.invalidateQueries({ queryKey: ["plan", month] });
    });
    return () => {
      alive = false;
    };
  }, [plan, actionable, month, today, warmFn, fitFn, qc]);

  const goToMonth = (target: string) => {
    if (target < bounds.earliest || target > bounds.latest) return;
    setSelectedMonth(target);
    setTab("plan");
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

  // Datos que alimentan el modo compra según sobre qué lista se entró (issue 06).
  const shop =
    shopSource === "household"
      ? {
          trip: hhTrips[hhSafeTrip],
          cadence: plannerCadence,
          coverage: plannerCoverage,
          tripsTotal: plannerTripsTotal,
          selectedTrip: hhSafeTrip,
          tripActual: hhTripActuals[hhSafeTrip] as number | undefined,
          savingActual: hhSetActual.isPending,
          scanningReceipt: hhReceipt.isPending,
          onToggle: (itemName: string) =>
            hhOwned.mutate({ itemName, trip: hhSafeTrip, source: "store" }),
          onSaveActual: (amount: number | null) => hhSetActual.mutate({ trip: hhSafeTrip, amount }),
          onScanReceipt: (imageBase64: string, mime: string) =>
            hhReceipt.mutate({ trip: hhSafeTrip, imageBase64, mime }),
        }
      : {
          trip: trips[safeTrip],
          cadence: activeCadence,
          coverage,
          tripsTotal,
          selectedTrip: safeTrip,
          tripActual: tripActuals[safeTrip] as number | undefined,
          savingActual: setActual.isPending,
          scanningReceipt: receipt.isPending,
          onToggle: (itemName: string) =>
            owned.mutate({ itemName, trip: safeTrip, source: "store" }),
          onSaveActual: (amount: number | null) => setActual.mutate({ trip: safeTrip, amount }),
          onScanReceipt: (imageBase64: string, mime: string) =>
            receipt.mutate({ trip: safeTrip, imageBase64, mime }),
        };

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <header className="animate-rise relative flex justify-center">
        <div className="min-w-0 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("plan.eyebrow")}
          </p>
          <div className="mt-0.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToMonth(addMonths(month, -1))}
              disabled={!canPrev}
              aria-label={t("plan.prevMonth")}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            {/* Dos líneas (mes arriba, año debajo) en vez de una sola con
                truncate: "Septiembre de 2026" no cabía entre los dos botones
                de 32 px y se leía "Septiembre de …". El mes solo, sin el año
                al lado, cabe de sobra incluso en el más largo (septiembre). */}
            <h1 className="min-w-0 flex-1 text-center leading-tight">
              <span className="block font-title text-[26px] font-semibold tracking-[-0.03em]">
                {capitalizeFirst(monthParts(month, locale).monthName)}
              </span>
              <span className="block text-[13px] font-medium text-muted-foreground">
                {monthParts(month, locale).year}
              </span>
            </h1>
            <button
              type="button"
              onClick={() =>
                nextIsLocked
                  ? toast.info(
                      t("plan.nextLockedInfo", {
                        next: monthTitle(addMonths(month, 1), locale),
                        current: monthTitle(month, locale),
                      }),
                    )
                  : goToMonth(addMonths(month, 1))
              }
              disabled={!canNext && !nextIsLocked}
              aria-label={nextIsLocked ? t("plan.nextMonthLocked") : t("plan.nextMonth")}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground disabled:opacity-30"
            >
              {nextIsLocked ? <Lock className="h-4 w-4" /> : <ChevronRight className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {/* Fuera del flujo: dentro de la fila del header empujaba el mes a la
            izquierda, y debajo movía la pantalla al aparecer y desaparecer.
            Cabe en el hueco (mt-6) hasta las subpestañas. */}
        {warmProgress.running ? (
          <p
            className="absolute right-0 top-full mt-1 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {t("plan.warming")}
          </p>
        ) : null}
      </header>

      {showCreateTakeover && intakeOpen ? (
        <MonthIntakeChat
          month={month}
          generating={generate.isPending}
          onGenerate={() => generate.mutate(undefined)}
          onCancel={() => setIntakeOpen(false)}
        />
      ) : showCreateTakeover ? (
        <section className="surface-card animate-rise mt-8 p-6 text-center">
          <CalendarRange className="mx-auto h-7 w-7 text-primary-ink" />
          <h2 className="mt-3 text-sm font-semibold">
            {isSoloPlanner
              ? t("plan.create.titleSolo")
              : monthStatus === "next-unlocked"
                ? t("plan.create.titleNext", { month: monthTitle(month, locale) })
                : t("plan.create.titleCurrent")}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isSoloPlanner
              ? t("plan.create.bodySolo", { name: plannerName })
              : monthStatus === "next-unlocked"
                ? t("plan.create.bodyNext")
                : t("plan.create.bodyCurrent")}
          </p>
          <button
            onClick={() => setIntakeOpen(true)}
            disabled={generate.isPending || planQ.isLoading}
            className="mt-5 w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {generate.isPending
              ? t("plan.create.preparing")
              : isSoloPlanner
                ? t("plan.create.ctaSolo")
                : monthStatus === "next-unlocked"
                  ? t("plan.create.ctaNext", { month: monthTitle(month, locale) })
                  : t("plan.create.ctaCurrent")}
          </button>
        </section>
      ) : (
        <>
          <div className="sticky top-3 z-10 mt-6 grid grid-cols-2 gap-2 rounded-full bg-secondary/80 p-1 backdrop-blur">
            {(
              [
                ["plan", t("plan.tabs.plan"), CalendarRange],
                ["compra", t("plan.tabs.ingredients"), ShoppingBasket],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center justify-center gap-1 rounded-full py-2.5 text-xs font-medium transition-colors sm:gap-1.5 sm:text-sm ${
                  tab === key ? "bg-surface text-primary-ink" : "text-muted-foreground"
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
                <Trans
                  i18nKey="plan.sharedBy"
                  values={{ name: plannerName }}
                  components={{ b: <span className="font-medium text-foreground" /> }}
                />
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
                    <Sparkle className="h-4 w-4 text-primary-ink" />
                    <h2 className="text-sm font-semibold">{t("plan.focusTitle")}</h2>
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
                    {t("plan.focusNote")}
                  </p>
                  <PlanFitNote fit={plan.fit} fitting={fitting} />
                </div>
              ) : null}

              <PlanMonthCalendar
                plan={plan}
                month={month}
                logs={monthLogsQ.data ?? []}
                monthStatus={monthStatus}
                appStartedOn={appStartedOn}
                householdChildren={hh?.children}
                selectedMealSlots={effectiveMealSlots(profileQ.data ?? {})}
                onOpenDay={setOpenDay}
                homePlanner={homePlanner}
              />

              {!plan && !(monthLogsQ.data?.length ?? 0) ? (
                <p className="px-1 text-sm text-muted-foreground">
                  {t("plan.notPlanned", { month: monthTitle(month, locale) })}
                </p>
              ) : null}
            </section>
          ) : isSoloPlanner ? (
            <div className="mt-5 space-y-6">
              {hasHouseholdShopping ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-0.5">
                    <Users className="h-4 w-4 text-primary-ink" />
                    <h2 className="font-title text-lg font-semibold tracking-[-0.02em]">
                      {t("plan.householdShopping.title")}
                    </h2>
                  </div>
                  <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("plan.householdShopping.body", { name: plannerName })}
                  </p>
                  <IngredientsTab
                    shopping={plannerShopping}
                    trips={hhTrips}
                    tripsTotal={plannerTripsTotal}
                    activeCadence={plannerCadence}
                    pendingCadence={null}
                    coverage={plannerCoverage}
                    todayDayOfMonth={todayDayOfMonth}
                    selectedTrip={hhSafeTrip}
                    setSelectedTrip={setHhSelectedTrip}
                    filter={hhFilter}
                    setFilter={setHhFilter}
                    recadence={{ isPending: false, mutate: () => {} }}
                    setPendingCadence={() => {}}
                    owned={hhOwned}
                    tripActuals={hhTripActuals}
                    pantryExtras={hhPantryExtras}
                    pantry={hhPantry}
                    onEnterShopMode={() => {
                      setShopSource("household");
                      setShopMode(true);
                    }}
                    month={month}
                    monthStatus={monthStatus}
                    readOnly={readOnlyMonth}
                    periodBudget={0}
                    overBudget={false}
                    plannerLocked
                    plannerName={plannerName}
                    inlineCta
                  />
                </div>
              ) : null}

              <div className="space-y-3">
                <div className="flex items-center gap-2 px-0.5">
                  <ShoppingBasket className="h-4 w-4 text-primary-ink" />
                  <h2 className="font-title text-lg font-semibold tracking-[-0.02em]">
                    {t("plan.soloShopping.title")}
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
                    pantryExtras={pantryExtras}
                    pantry={pantry}
                    onEnterShopMode={() => {
                      setShopSource("own");
                      setShopMode(true);
                    }}
                    month={month}
                    monthStatus={monthStatus}
                    readOnly={readOnlyMonth}
                    periodBudget={periodBudget}
                    overBudget={overBudget}
                    inlineCta
                  />
                ) : intakeOpen && actionable ? (
                  <MonthIntakeChat
                    month={month}
                    generating={generate.isPending}
                    onGenerate={() => generate.mutate(undefined)}
                    onCancel={() => setIntakeOpen(false)}
                  />
                ) : (
                  <div className="surface-card p-5 text-center">
                    <p className="text-sm text-muted-foreground">{t("plan.soloShopping.empty")}</p>
                    {actionable ? (
                      <button
                        onClick={() => setIntakeOpen(true)}
                        disabled={generate.isPending}
                        className="mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                      >
                        {generate.isPending
                          ? t("plan.create.preparingShort")
                          : t("plan.create.ctaSolo")}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
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
              pantryExtras={pantryExtras}
              pantry={pantry}
              onEnterShopMode={() => {
                setShopSource("own");
                setShopMode(true);
              }}
              month={month}
              monthStatus={monthStatus}
              readOnly={readOnlyMonth}
              periodBudget={periodBudget}
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
        householdChildren={hh?.children}
        household={
          sharedSlots
            ? {
                sharedSlots,
                memberCount: (hh?.members ?? []).filter((m) => m.user_id).length,
              }
            : undefined
        }
        onClose={() => setOpenDay(null)}
      />

      {/* El modo compra se pinta ENCIMA de la lista, no en su lugar: el botón
          que lo abre sigue montado y Radix le devuelve el foco al cerrar. */}
      {tab === "compra" && shopMode && actionable ? (
        <ShoppingMode
          trip={shop.trip}
          cadence={shop.cadence}
          coverage={shop.coverage}
          tripsTotal={shop.tripsTotal}
          selectedTrip={shop.selectedTrip}
          month={month}
          onToggle={shop.onToggle}
          onClose={() => setShopMode(false)}
          tripActual={shop.tripActual}
          savingActual={shop.savingActual}
          onSaveActual={shop.onSaveActual}
          onScanReceipt={shop.onScanReceipt}
          scanningReceipt={shop.scanningReceipt}
        />
      ) : null}

      <BottomNav />
    </main>
  );
}
