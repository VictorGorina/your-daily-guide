import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Lock,
  ShoppingBasket,
  ShoppingCart,
  Sparkles,
  Users,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { DayDetailSheet } from "../../components/day-detail-sheet";
import { GoalWeightSummary } from "../../components/goal-weight-summary";
import { MonthIntakeChat } from "../../components/month-intake-chat";
import { MonthSpendSummary } from "../../components/month-spend-summary";
import { IngredientsTab } from "../../components/plan/ingredients-tab";
import { PlanMonthCalendar } from "../../components/plan/month-calendar";
import { ShoppingMode } from "../../components/plan/shopping-mode";
import { PlanFitNote } from "../../components/plan-fit-note";
import { apiPost } from "../../lib/api";
import {
  fitPlanOnce,
  planDishesToWarm,
  useRecipeWarmProgress,
  warmPlanRecipes,
  type WarmResult,
} from "../../lib/recipe-warm";
import {
  fetchLogs,
  fetchLogsForMonth,
  addMessage,
  fetchMonthlyPlan,
  fetchPlannerShopping,
  fetchProfile,
  todayISO,
} from "../../lib/daily";
import { fetchHousehold, householdSharedSlots } from "../../lib/household";
import { dateLocale } from "../../lib/i18n";
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
  shoppingTotal,
  tripSpendBars,
  tripsForCoverage,
  tripTiming,
  WEEK_COUNT,
  type MonthlyPlan,
  type PantryExtra,
  type PlanFitMark,
  type ShoppingCadence,
  type ShoppingList,
  type TripReceipts,
} from "../../lib/plan-shared";
import { useShoppingMutations } from "../../lib/use-shopping-mutations";
import {
  flushPlanRecalc,
  onPlanRecalcDone,
  schedulePlanRecalc,
  wirePlanRecalcFlush,
} from "../../lib/plan-recalc";

type GenerateResult = { plan: MonthlyPlan; shopping: ShoppingList; firstPlan?: boolean };

export default function Plan() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const qc = useQueryClient();
  const today = todayISO();
  const params = useLocalSearchParams<{ tab?: string; month?: string }>();
  const [tab, setTab] = useState<"plan" | "compra">(params.tab === "compra" ? "compra" : "plan");
  const [selectedMonth, setSelectedMonth] = useState(
    typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : today.slice(0, 7),
  );
  const month = selectedMonth;
  // Solo para resaltar el botón mientras el servidor guarda la cadencia; la
  // cadencia real sale de `plan.cadence` hasta que llega la respuesta (así
  // `projectTrips` no corre con un nº de compras que aún no coincide).
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
  // la compra de la casa las lleva el planificador; aquí solo planifica sus
  // comidas en solitario. Cambia el copy del botón de generar y añade la compra
  // de la casa en solo lectura a la pestaña Ingredientes (issue 05).
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
  // tenga fila propia (id ""), para que vea las comidas de la casa.
  const hasOwnPlanRow = !!planQ.data && planQ.data.id !== "";

  // --- Compra de la casa (issue 06) --------------------------------------
  // Un miembro no planificador ve y OPERA la lista del planificador (marcar en
  // casa / comprado por tramo, gasto real, tiquet, despensa) con navegador de
  // compras y modo compra propios, para ir al súper de forma autónoma. Solo se
  // le ocultan regenerar y cambiar la cadencia. El servidor resuelve la fila
  // objetivo (`resolveShoppingRow`).
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
  const hhClampedTrip = Math.min(hhSelectedTrip, Math.max(0, plannerTripsTotal - 1));
  const hhCurrentTrip = hhTrips[hhClampedTrip] ?? hhTrips[0];
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
  // Cada paso de la conversación añade una pregunta abajo: se baja hasta ella
  // para que no quede tapada por la barra (la web lo hace con scrollIntoView).
  const scrollRef = useRef<ScrollView>(null);
  const scrollToEnd = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/generate", {
        month,
        cadence: nextCadence ?? "mensual",
        today,
      }),
    onSuccess: (res) => {
      setIntakeOpen(false);
      qc.invalidateQueries({ queryKey: ["plan", month] });
      if (res.firstPlan) {
        void apiPost<{ text?: string }>("plan/welcome", { month })
          .then(({ text }) => (text ? addMessage("assistant", text) : undefined))
          .catch(() => undefined);
      }
    },
    onError: (e) => Alert.alert(e instanceof Error ? e.message : t("plan.errors.create")),
  });

  // Cambiar la cadencia no llama a la IA: la lista canónica guarda el desglose
  // por semana, así que solo cambia cómo se agrupa en pantalla (`projectTrips`).
  // El servidor guarda la nueva cadencia y devuelve el plan y la compra al día.
  const recadence = useMutation({
    mutationFn: (nextCadence: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/recadence", { month, cadence: nextCadence, today: todayISO() }),
    onSuccess: (res) => {
      setPendingCadence(null);
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, plan: res.plan, shopping: res.shopping } : prev,
      );
    },
    onError: (e) => {
      setPendingCadence(null);
      Alert.alert(e instanceof Error ? e.message : t("plan.errors.recadence"));
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
  // IngredientsTab (ver diseño 1c).
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
  const projCoverage = useMemo(
    () => coverage ?? { fromDay: 1, toDay: daysInMonth(month) },
    [coverage, month],
  );
  const cadenceFrom = plan?.cadenceFrom;
  const trips = useMemo(
    () => projectTrips(shopping, activeCadence, projCoverage, WEEK_COUNT, cadenceFrom),
    [shopping, activeCadence, projCoverage, cadenceFrom],
  );
  const todayDayOfMonth = Number(todayISO().slice(8, 10));

  // Compra seleccionada: por defecto la que toca hoy (current) o la primera
  // "future" si no hay ninguna "current" (puede pasar a fin de mes).
  const [selectedTrip, setSelectedTrip] = useState<number>(() => {
    for (let i = 0; i < tripsTotal; i++) {
      if (tripTiming(tripsTotal, i, todayDayOfMonth, coverage) === "current") return i;
    }
    for (let i = 0; i < tripsTotal; i++) {
      if (tripTiming(tripsTotal, i, todayDayOfMonth, coverage) === "future") return i;
    }
    return 0;
  });
  // Abre mostrando TODO (auditoría): marcas lo que ya tienes y "Ir a comprar"
  // te lleva al modo súper solo con lo que falta.
  const [filter, setFilter] = useState<"need" | "have" | "all">("all");
  // Modo compra a pantalla completa. `shopSource` decide sobre qué lista opera:
  // la propia o la de la casa (un no planificador compra la de la casa, issue 06).
  const [shopMode, setShopMode] = useState(false);
  const [shopSource, setShopSource] = useState<"own" | "household">("own");

  const clampedTrip = Math.min(selectedTrip, Math.max(0, tripsTotal - 1));
  const currentTrip = trips[clampedTrip] ?? trips[0];
  const spendBars = useMemo(() => tripSpendBars(trips, projCoverage), [trips, projCoverage]);
  const readOnlyMonth = monthStatus === "past";

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

  // Recálculo automático del plan (issue 05). Red de seguridad: si se cambió la
  // despensa o la mesa y la app se cerró antes de que saltara el debounce, se
  // lanza al abrir/volver a Plan. `wirePlanRecalcFlush` engancha además el envío
  // al pasar la app a segundo plano. Al terminar se refresca el plan (el `intro`
  // explica qué cambió; no hay más aviso).
  useEffect(() => {
    wirePlanRecalcFlush();
    return onPlanRecalcDone((done) => {
      qc.invalidateQueries({ queryKey: ["plan", done] });
      qc.invalidateQueries({ queryKey: ["planner-shopping", done] });
    });
  }, [qc]);
  useEffect(() => {
    if (!isSoloPlanner) void flushPlanRecalc(month);
  }, [month, isSoloPlanner]);

  // Todos los platos del plan, calculados al generarlo o cambiarlo (ticket 06,
  // D13): ninguno llega a Hoy "Calculando…". Solo lo que falte en la caché; si
  // la app se cerró a medias, se retoma aquí.
  //
  // Con todos calculados, UNA comprobación del plan contra el objetivo (ticket
  // 10, `fitMonthlyPlan`): cambia los platos que ni ajustando la cantidad dejan
  // el día en su objetivo. Una vez por plan (la marca `plan.fit`); lo que
  // cambió se enseña en "Cómo enfocamos el mes".
  const warmProgress = useRecipeWarmProgress();
  const [fitting, setFitting] = useState(false);
  useEffect(() => {
    if (!plan || !actionable) return;
    let alive = true;
    void warmPlanRecipes(planDishesToWarm(plan, month, today), (dishes) =>
      apiPost<WarmResult>("recipes/warm", { dishes }),
    ).then(async (complete) => {
      if (!alive || !complete || plan.fit || !plan.targetsVersion) return;
      setFitting(true);
      const res = await fitPlanOnce(month, () =>
        apiPost<{ fit: PlanFitMark | null }>("plan/fit", { month, today }),
      );
      if (alive) setFitting(false);
      if (res?.fit) qc.invalidateQueries({ queryKey: ["plan", month] });
    });
    return () => {
      alive = false;
    };
  }, [plan, actionable, month, today, qc]);

  const goToMonth = (target: string) => {
    if (target < bounds.earliest || target > bounds.latest) return;
    setSelectedMonth(target);
    setTab("plan");
  };
  const canPrev = month > bounds.earliest;
  const canNext = month < bounds.latest;
  const nextIsLocked = !canNext && planMonthStatus(addMonths(month, 1), today) === "next-locked";
  const showCreateTakeover = !plan && actionable;

  const budget = Number(profileQ.data?.budget_month_eur ?? 0);
  // Si el plan empieza a media de mes, el presupuesto que aplica es la parte
  // proporcional del mes que cubre, no el mes entero.
  const periodBudget =
    budget > 0 && coverage ? Math.round(budget * coverageRatio(coverage, month)) : budget;
  const overBudget = periodBudget > 0 && monthTotal > periodBudget;

  const needCount =
    currentTrip?.groups.reduce((s, g) => s + g.items.filter((i) => !i.owned).length, 0) ?? 0;
  // El CTA de página es solo para la vista de una lista; con dos listas apiladas
  // (compra de la casa + solitario) cada `IngredientsTab` lleva su CTA en línea.
  const showShopCta =
    Boolean(plan) &&
    tab === "compra" &&
    !shopMode &&
    !readOnlyMonth &&
    !isSoloPlanner &&
    (shopping?.length ?? 0) > 0 &&
    needCount > 0;

  // Datos que alimentan el modo compra según sobre qué lista se entró (issue 06).
  const shop =
    shopSource === "household"
      ? {
          trip: hhCurrentTrip,
          cadence: plannerCadence,
          coverage: plannerCoverage,
          tripsTotal: plannerTripsTotal,
          selectedTrip: hhClampedTrip,
          tripActual: hhTripActuals[hhClampedTrip] as number | undefined,
          savingActual: hhSetActual.isPending,
          scanningReceipt: hhReceipt.isPending,
          onToggle: (itemName: string, next: "fridge" | "store" | null) =>
            hhOwned.mutate({ itemName, trip: hhClampedTrip, source: next }),
          onSaveActual: (amount: number | null) =>
            hhSetActual.mutate({ trip: hhClampedTrip, amount }),
          onScanReceipt: (imageBase64: string, mime: string) =>
            hhReceipt.mutate({ trip: hhClampedTrip, imageBase64, mime }),
        }
      : {
          trip: currentTrip,
          cadence: activeCadence,
          coverage,
          tripsTotal,
          selectedTrip: clampedTrip,
          tripActual: tripActuals[clampedTrip] as number | undefined,
          savingActual: setActual.isPending,
          scanningReceipt: receipt.isPending,
          onToggle: (itemName: string, next: "fridge" | "store" | null) =>
            owned.mutate({ itemName, trip: clampedTrip, source: next }),
          onSaveActual: (amount: number | null) => setActual.mutate({ trip: clampedTrip, amount }),
          onScanReceipt: (imageBase64: string, mime: string) =>
            receipt.mutate({ trip: clampedTrip, imageBase64, mime }),
        };

  // Modo compra: pantalla completa enfocada (diseño 1b). Sustituye toda la
  // pantalla — sin cabecera del plan, sin pestañas, sin barra de navegación —
  // y se sale con la flecha ← de su cabecera.
  if (tab === "compra" && shopMode && actionable && shop.trip) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        // Los campos de texto (conversación del mes, despensa) no deben quedar
        // bajo el teclado; y un toque en "Siguiente" con el teclado abierto
        // tiene que pulsar el botón, no solo cerrar el teclado.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-52 pt-6"
      >
        <View className="relative flex-row justify-center">
          <View className="items-center">
            <Text className="text-xs font-sans-medium uppercase tracking-wide text-muted-foreground">
              {t("plan.eyebrow")}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1">
              <Pressable
                onPress={() => goToMonth(addMonths(month, -1))}
                disabled={!canPrev}
                accessibilityRole="button"
                accessibilityLabel={t("plan.prevMonth")}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full"
                style={!canPrev ? { opacity: 0.3 } : undefined}
              >
                <ChevronLeft size={20} color="#6b6256" />
              </Pressable>
              {/* Dos líneas (mes arriba, año debajo) en vez de una sola con
                  numberOfLines={1}: "Septiembre de 2026" no cabía entre los
                  dos botones de 32 px y se leía cortado. El mes solo, sin el
                  año al lado, cabe de sobra incluso en el más largo
                  (septiembre). */}
              <View className="items-center">
                <Text className="text-center font-heading text-[24px] text-foreground">
                  {capitalizeFirst(monthParts(month, locale).monthName)}
                </Text>
                <Text className="text-center text-[13px] font-sans-medium text-muted-foreground">
                  {monthParts(month, locale).year}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  nextIsLocked
                    ? Alert.alert(
                        t("plan.notYetTitle"),
                        t("plan.nextLockedInfo", {
                          next: monthTitle(addMonths(month, 1), locale),
                          current: monthTitle(month, locale),
                        }),
                      )
                    : goToMonth(addMonths(month, 1))
                }
                disabled={!canNext && !nextIsLocked}
                accessibilityRole="button"
                accessibilityLabel={nextIsLocked ? t("plan.nextMonthLocked") : t("plan.nextMonth")}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full"
                style={!canNext && !nextIsLocked ? { opacity: 0.3 } : undefined}
              >
                {nextIsLocked ? (
                  <Lock size={16} color="#6b6256" />
                ) : (
                  <ChevronRight size={20} color="#6b6256" />
                )}
              </Pressable>
            </View>
          </View>
          {/* Fuera del flujo, como en la web: no mueve la pantalla al aparecer
              y desaparecer. Cabe en el hueco (mt-6) hasta las subpestañas. */}
          {warmProgress.running ? (
            <Text
              className="absolute right-0 mt-1 text-xs text-muted-foreground"
              style={{ top: "100%" }}
            >
              {t("plan.warming")}
            </Text>
          ) : null}
        </View>

        {showCreateTakeover && intakeOpen ? (
          <MonthIntakeChat
            month={month}
            generating={generate.isPending}
            onGenerate={() => generate.mutate(undefined)}
            onCancel={() => setIntakeOpen(false)}
            onAdvance={scrollToEnd}
          />
        ) : showCreateTakeover ? (
          <View className="mt-8 items-center rounded-3xl bg-surface p-6">
            <CalendarRange size={28} color="#a84a17" />
            <Text className="mt-3 text-sm font-sans-semibold text-foreground">
              {isSoloPlanner
                ? t("plan.create.titleSolo")
                : monthStatus === "next-unlocked"
                  ? t("plan.create.titleNext", { month: monthTitle(month, locale) })
                  : t("plan.create.titleCurrent")}
            </Text>
            <Text className="mt-1.5 text-center text-sm text-muted-foreground">
              {isSoloPlanner
                ? t("plan.create.bodySolo", { name: plannerName })
                : monthStatus === "next-unlocked"
                  ? t("plan.create.bodyNext")
                  : t("plan.create.bodyCurrent")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIntakeOpen(true)}
              disabled={generate.isPending || planQ.isLoading}
              className="mt-5 w-full items-center rounded-full bg-primary py-4 active:opacity-90"
              style={generate.isPending || planQ.isLoading ? { opacity: 0.6 } : undefined}
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {generate.isPending
                  ? t("plan.create.preparing")
                  : isSoloPlanner
                    ? t("plan.create.ctaSolo")
                    : monthStatus === "next-unlocked"
                      ? t("plan.create.ctaNext", { month: monthTitle(month, locale) })
                      : t("plan.create.ctaCurrent")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="mt-6 flex-row gap-2 rounded-full bg-secondary/80 p-1">
              {(
                [
                  ["plan", t("plan.tabs.plan"), CalendarRange],
                  ["compra", t("plan.tabs.ingredients"), ShoppingBasket],
                ] as const
              ).map(([key, label, Icon]) => {
                const active = tab === key;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={key}
                    onPress={() => setTab(key)}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-full py-2.5 active:opacity-80 ${
                      active ? "bg-surface" : ""
                    }`}
                  >
                    <Icon size={14} color={active ? "#a84a17" : "#6b6256"} />
                    <Text
                      className={`text-xs font-sans-medium ${active ? "text-primary-ink" : "text-muted-foreground"}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {isSoloPlanner && hasSharedMeals ? (
              <View className="mt-4 flex-row items-start gap-2 rounded-2xl bg-secondary/60 px-3.5 py-2.5">
                <Users size={14} color="#6b6256" style={{ marginTop: 2 }} />
                <Text className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
                  <Trans
                    i18nKey="plan.sharedBy"
                    values={{ name: plannerName }}
                    components={{ b: <Text className="font-sans-medium text-foreground" /> }}
                  />
                </Text>
              </View>
            ) : null}

            {tab === "plan" ? (
              <View className="mt-5 gap-5">
                <GoalWeightSummary logs={globalLogsQ.data ?? []} profile={profileQ.data ?? null} />

                <MonthSpendSummary
                  shopping={shopping}
                  tripActuals={tripActuals}
                  tripReceipts={tripReceipts}
                  periodBudget={periodBudget}
                  partialMonth={Boolean(coverage && coverage.fromDay > 1)}
                  monthStatus={monthStatus}
                />

                {plan ? (
                  <View className="rounded-3xl bg-surface p-5">
                    <View className="flex-row items-center gap-2">
                      <Sparkles size={16} color="#a84a17" />
                      <Text className="text-sm font-sans-semibold text-foreground">
                        {t("plan.focusTitle")}
                      </Text>
                    </View>
                    <Text className="mt-2 text-sm leading-relaxed text-foreground">
                      {plan.intro}
                    </Text>
                    {plan.focus.length ? (
                      <View className="mt-3 gap-1.5">
                        {plan.focus.map((f) => (
                          <View key={f} className="flex-row gap-2">
                            <View className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                            <Text className="flex-1 text-sm text-foreground">{f}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Text className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {t("plan.focusNote")}
                    </Text>
                    <PlanFitNote fit={plan.fit} fitting={fitting} />
                  </View>
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
                  <Text className="px-1 text-sm text-muted-foreground">
                    {t("plan.notPlanned", { month: monthTitle(month, locale) })}
                  </Text>
                ) : null}
              </View>
            ) : isSoloPlanner ? (
              <View className="mt-5 gap-6">
                {hasHouseholdShopping ? (
                  <View className="gap-3">
                    <View className="flex-row items-center gap-2 px-0.5">
                      <Users size={16} color="#a84a17" />
                      <Text className="font-heading text-lg text-foreground">
                        {t("plan.householdShopping.title")}
                      </Text>
                    </View>
                    <Text className="px-0.5 text-xs leading-relaxed text-muted-foreground">
                      {t("plan.householdShopping.body", { name: plannerName })}
                    </Text>
                    <IngredientsTab
                      shopping={plannerShopping}
                      currentTrip={hhCurrentTrip}
                      spendBars={[]}
                      tripsTotal={plannerTripsTotal}
                      activeCadence={plannerCadence}
                      pendingCadence={null}
                      coverage={plannerCoverage}
                      todayDayOfMonth={todayDayOfMonth}
                      selectedTrip={hhClampedTrip}
                      setSelectedTrip={setHhSelectedTrip}
                      filter={hhFilter}
                      setFilter={setHhFilter}
                      recadence={{ isPending: false, mutate: () => {} }}
                      setPendingCadence={() => {}}
                      onToggle={(itemName, next) =>
                        hhOwned.mutate({ itemName, trip: hhClampedTrip, source: next })
                      }
                      pantryExtras={hhPantryExtras}
                      pantry={hhPantry}
                      month={month}
                      monthStatus={monthStatus}
                      readOnly={readOnlyMonth}
                      tripActual={hhTripActuals[hhClampedTrip]}
                      periodBudget={0}
                      overBudget={false}
                      plannerLocked
                      plannerName={plannerName}
                      onEnterShopMode={() => {
                        setShopSource("household");
                        setShopMode(true);
                      }}
                    />
                  </View>
                ) : null}

                <View className="gap-3">
                  <View className="flex-row items-center gap-2 px-0.5">
                    <ShoppingBasket size={16} color="#a84a17" />
                    <Text className="font-heading text-lg text-foreground">
                      {t("plan.soloShopping.title")}
                    </Text>
                  </View>

                  {hasOwnPlanRow ? (
                    <IngredientsTab
                      shopping={shopping}
                      currentTrip={currentTrip}
                      spendBars={spendBars}
                      tripsTotal={tripsTotal}
                      activeCadence={activeCadence}
                      pendingCadence={pendingCadence}
                      coverage={coverage}
                      todayDayOfMonth={todayDayOfMonth}
                      selectedTrip={clampedTrip}
                      setSelectedTrip={setSelectedTrip}
                      filter={filter}
                      setFilter={setFilter}
                      recadence={recadence}
                      setPendingCadence={setPendingCadence}
                      onToggle={(itemName, next) =>
                        owned.mutate({ itemName, trip: clampedTrip, source: next })
                      }
                      pantryExtras={pantryExtras}
                      pantry={pantry}
                      month={month}
                      monthStatus={monthStatus}
                      readOnly={readOnlyMonth}
                      tripActual={tripActuals[clampedTrip]}
                      periodBudget={periodBudget}
                      overBudget={overBudget}
                      onEnterShopMode={() => {
                        setShopSource("own");
                        setShopMode(true);
                      }}
                    />
                  ) : intakeOpen && actionable ? (
                    <MonthIntakeChat
                      month={month}
                      generating={generate.isPending}
                      onGenerate={() => generate.mutate(undefined)}
                      onCancel={() => setIntakeOpen(false)}
                      onAdvance={scrollToEnd}
                    />
                  ) : (
                    <View className="items-center rounded-3xl bg-surface p-5">
                      <Text className="text-center text-sm text-muted-foreground">
                        {t("plan.soloShopping.empty")}
                      </Text>
                      {actionable ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setIntakeOpen(true)}
                          disabled={generate.isPending}
                          className="mt-4 w-full items-center rounded-full bg-primary py-3.5 active:opacity-90"
                          style={generate.isPending ? { opacity: 0.6 } : undefined}
                        >
                          <Text className="text-sm font-sans-semibold text-primary-foreground">
                            {generate.isPending
                              ? t("plan.create.preparingShort")
                              : t("plan.create.ctaSolo")}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              </View>
            ) : (
              <IngredientsTab
                shopping={shopping}
                currentTrip={currentTrip}
                spendBars={spendBars}
                tripsTotal={tripsTotal}
                activeCadence={activeCadence}
                pendingCadence={pendingCadence}
                coverage={coverage}
                todayDayOfMonth={todayDayOfMonth}
                selectedTrip={clampedTrip}
                setSelectedTrip={setSelectedTrip}
                filter={filter}
                setFilter={setFilter}
                recadence={recadence}
                setPendingCadence={setPendingCadence}
                onToggle={(itemName, next) =>
                  owned.mutate({ itemName, trip: clampedTrip, source: next })
                }
                pantryExtras={pantryExtras}
                pantry={pantry}
                month={month}
                monthStatus={monthStatus}
                readOnly={readOnlyMonth}
                tripActual={tripActuals[clampedTrip]}
                periodBudget={periodBudget}
                overBudget={overBudget}
              />
            )}
          </>
        )}
      </ScrollView>

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

      {showShopCta ? (
        <View className="absolute inset-x-0 bottom-[124px] px-5">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setShopSource("own");
              setShopMode(true);
            }}
            className="mx-auto w-full max-w-lg flex-row items-center justify-center gap-2 rounded-[20px] bg-primary py-4 active:opacity-90"
          >
            <ShoppingCart size={17} color="#3e3d39" />
            <Text className="text-sm font-sans-bold text-primary-foreground">
              {t("shopping.goShop", { count: needCount })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <BottomNav />
    </SafeAreaView>
  );
}
