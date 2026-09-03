import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
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
  Sparkles,
  Users,
  Wheat,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { DayDetailSheet } from "../../components/day-detail-sheet";
import { DishRecipe } from "../../components/dish-recipe";
import { GoalWeightSummary } from "../../components/goal-weight-summary";
import { MonthSpendSummary } from "../../components/month-spend-summary";
import { Dialog } from "../../components/ui/dialog";
import { apiPost } from "../../lib/api";
import {
  fetchLogs,
  fetchLogsForMonth,
  fetchMonthlyPlan,
  fetchPlannerShopping,
  fetchProfile,
  ratioSignal,
  todayISO,
  type DailyLog,
} from "../../lib/daily";
import { fetchHousehold } from "../../lib/household";
import {
  addMonths,
  boughtTotal,
  cadenceOf,
  CADENCES,
  childMealsForDate,
  coverageRatio,
  daysInMonth,
  eur,
  homeTotal,
  isBeforeAppStart,
  isMonthActionable,
  mealsForDate,
  monthTitle,
  offListNote,
  pendingTotal,
  planForDate,
  planMonthStatus,
  planNavBounds,
  projectTrips,
  shoppingTotal,
  tripDayRange,
  tripsOfCadence,
  tripTiming,
  WEEK_COUNT,
  type MonthlyPlan,
  type PantryExtra,
  type PlanCoverage,
  type PlanMonthStatus,
  type ShoppingCadence,
  type ShoppingItem,
  type ShoppingList,
  type TripActuals,
  type TripConfirmations,
  type TripReceipts,
} from "../../lib/plan-shared";
import { freshRiskNames, freshRisksForTrip } from "../../lib/perishability";

type GenerateResult = { plan: MonthlyPlan; shopping: ShoppingList };

type ReceiptScanResult = {
  trip_actuals: TripActuals;
  pantry_extras: PantryExtra[];
  trip_receipts: TripReceipts;
  total: number;
  added: string[];
  discarded: { name: string; reason: string }[];
};

type TripGroups = { trip: number; groups: { category: string; items: ShoppingItem[] }[] };

const FULL_COVERAGE: PlanCoverage = { fromDay: 1, toDay: 31 };

export default function Plan() {
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
  const plannerTripsTotal = tripsOfCadence(plannerCadence);
  const plannerCoverage = plannerPlan?.coverage;
  const hhTrips = projectTrips(
    plannerShopping,
    plannerCadence,
    plannerCoverage ?? { fromDay: 1, toDay: daysInMonth(month) },
    plannerPlan?.weeks.length ?? WEEK_COUNT,
  );
  const hhTripActuals = plannerShoppingQ.data?.trip_actuals ?? {};
  const hhConfirmedTrips: TripConfirmations = plannerShoppingQ.data?.confirmed_trips ?? {};
  const hhPantryExtras: PantryExtra[] = plannerShoppingQ.data?.pantry_extras ?? [];
  const [hhSelectedTrip, setHhSelectedTrip] = useState(0);
  const [hhFilter, setHhFilter] = useState<"need" | "have" | "all">("all");
  const hhClampedTrip = Math.min(hhSelectedTrip, Math.max(0, plannerTripsTotal - 1));
  const hhCurrentTrip = hhTrips[hhClampedTrip] ?? hhTrips[0];
  const hasHouseholdShopping = isSoloPlanner && (plannerShopping?.length ?? 0) > 0;

  const hhOwned = useMutation({
    mutationFn: (vars: { itemName: string; trip: number; source: "fridge" | "store" | null }) =>
      apiPost<{ shopping: ShoppingList }>("plan/shopping-owned", { month, ...vars }),
    onSuccess: (res) =>
      qc.setQueryData(["planner-shopping", month], (prev: typeof plannerShoppingQ.data) =>
        prev ? { ...prev, shopping: res.shopping } : prev,
      ),
    onError: () => Alert.alert("No hemos podido guardar el cambio"),
  });
  const hhSetActual = useMutation({
    mutationFn: (vars: { trip: number; amount: number | null }) =>
      apiPost<{ trip_actuals: TripActuals }>("plan/trip-actual", { month, ...vars }),
    onSuccess: (res) =>
      qc.setQueryData(["planner-shopping", month], (prev: typeof plannerShoppingQ.data) =>
        prev ? { ...prev, trip_actuals: res.trip_actuals } : prev,
      ),
    onError: () => Alert.alert("No hemos podido guardar el gasto"),
  });
  const hhPantry = useMutation({
    mutationFn: (vars: { name: string; qty?: string; remove?: boolean }) =>
      apiPost<{ pantry_extras: PantryExtra[] }>("plan/pantry-extra", { month, ...vars }),
    onSuccess: (res) =>
      qc.setQueryData(["planner-shopping", month], (prev: typeof plannerShoppingQ.data) =>
        prev ? { ...prev, pantry_extras: res.pantry_extras } : prev,
      ),
    onError: () => Alert.alert("No hemos podido guardar el ingrediente"),
  });
  const hhConfirmTrip = useMutation({
    mutationFn: (vars: { trip: number; confirmed: boolean }) =>
      apiPost<{ confirmed_trips: TripConfirmations }>("plan/trip-confirm", { month, ...vars }),
    onSuccess: (res) =>
      qc.setQueryData(["planner-shopping", month], (prev: typeof plannerShoppingQ.data) =>
        prev ? { ...prev, confirmed_trips: res.confirmed_trips } : prev,
      ),
    onError: () => Alert.alert("No hemos podido fijar los ingredientes"),
  });
  const hhReceipt = useMutation({
    mutationFn: (vars: { trip: number; imageBase64: string; mime: string }) =>
      apiPost<ReceiptScanResult>("plan/receipt", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["planner-shopping", month], (prev: typeof plannerShoppingQ.data) =>
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
      if (res.added.length) parts.push(`Añadí a la despensa de la casa: ${res.added.join(", ")}`);
      if (res.discarded.length)
        parts.push(`Descarté: ${res.discarded.map((d) => `${d.name} (${d.reason})`).join(", ")}`);
      Alert.alert("Tiquet leído", parts.join("\n"));
    },
    onError: (e) => Alert.alert(e instanceof Error ? e.message : "No hemos podido leer el tiquet"),
  });

  const appStartedOn = profileQ.data?.app_started_on ?? null;
  const monthStatus = planMonthStatus(month, today);
  const actionable = isMonthActionable(month, today);
  const bounds = planNavBounds(today, appStartedOn);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/generate", {
        month,
        cadence: nextCadence ?? "mensual",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) =>
      Alert.alert(e instanceof Error ? e.message : "No hemos podido crear el plan ahora mismo"),
  });

  // Cambiar la cadencia no llama a la IA: la lista canónica guarda el desglose
  // por semana, así que solo cambia cómo se agrupa en pantalla (`projectTrips`).
  // El servidor guarda la nueva cadencia y devuelve el plan y la compra al día.
  const recadence = useMutation({
    mutationFn: (nextCadence: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/recadence", { month, cadence: nextCadence }),
    onSuccess: (res) => {
      setPendingCadence(null);
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, plan: res.plan, shopping: res.shopping } : prev,
      );
    },
    onError: (e) => {
      setPendingCadence(null);
      Alert.alert(e instanceof Error ? e.message : "No hemos podido cambiar la frecuencia");
    },
  });

  const pantry = useMutation({
    mutationFn: (vars: { name: string; qty?: string; remove?: boolean }) =>
      apiPost<{ pantry_extras: PantryExtra[] }>("plan/pantry-extra", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, pantry_extras: res.pantry_extras } : prev,
      );
    },
    onError: () => Alert.alert("No hemos podido guardar el ingrediente"),
  });

  const receipt = useMutation({
    mutationFn: (vars: { trip: number; imageBase64: string; mime: string }) =>
      apiPost<ReceiptScanResult>("plan/receipt", { month, ...vars }),
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
      Alert.alert("Tiquet leído", parts.join("\n"));
    },
    onError: (e) => Alert.alert(e instanceof Error ? e.message : "No hemos podido leer el tiquet"),
  });

  const owned = useMutation({
    mutationFn: (vars: { itemName: string; trip: number; source: "fridge" | "store" | null }) =>
      apiPost<{ shopping: ShoppingList }>("plan/shopping-owned", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, shopping: res.shopping } : prev,
      );
    },
    onError: () => Alert.alert("No hemos podido guardar el cambio"),
  });

  const setActual = useMutation({
    mutationFn: (vars: { trip: number; amount: number | null }) =>
      apiPost<{ trip_actuals: TripActuals }>("plan/trip-actual", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, trip_actuals: res.trip_actuals } : prev,
      );
    },
    onError: () => Alert.alert("No hemos podido guardar el gasto"),
  });

  const confirmTrip = useMutation({
    mutationFn: (vars: { trip: number; confirmed: boolean }) =>
      apiPost<{ confirmed_trips: TripConfirmations }>("plan/trip-confirm", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, confirmed_trips: res.confirmed_trips } : prev,
      );
    },
    onError: () => Alert.alert("No hemos podido fijar los ingredientes"),
  });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  // Total del mes: solo para el aviso de presupuesto. Las cifras de la tarjeta
  // "Te falta comprar" son de la compra seleccionada y se calculan dentro de
  // IngredientsTab (ver diseño 1c).
  const monthTotal = shoppingTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const confirmedTrips: TripConfirmations = planQ.data?.confirmed_trips ?? {};
  const tripReceipts: TripReceipts = planQ.data?.trip_receipts ?? {};
  const pantryExtras: PantryExtra[] = planQ.data?.pantry_extras ?? [];
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
        <ShopModeView
          trip={shop.trip}
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
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-52 pt-6">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-sans-medium uppercase tracking-wide text-muted-foreground">
              Plan mensual
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1">
              <Pressable
                onPress={() => goToMonth(addMonths(month, -1))}
                disabled={!canPrev}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full"
                style={!canPrev ? { opacity: 0.3 } : undefined}
              >
                <ChevronLeft size={20} color="#83796c" />
              </Pressable>
              <Text
                className="min-w-0 flex-1 text-center font-heading text-[26px] capitalize text-foreground"
                numberOfLines={1}
              >
                {monthTitle(month)}
              </Text>
              <Pressable
                onPress={() =>
                  nextIsLocked
                    ? Alert.alert(
                        "Aún no toca",
                        `Podrás preparar ${monthTitle(addMonths(month, 1))} la última semana de ${monthTitle(month)}.`,
                      )
                    : goToMonth(addMonths(month, 1))
                }
                disabled={!canNext && !nextIsLocked}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full"
                style={!canNext && !nextIsLocked ? { opacity: 0.3 } : undefined}
              >
                {nextIsLocked ? (
                  <Lock size={16} color="#83796c" />
                ) : (
                  <ChevronRight size={20} color="#83796c" />
                )}
              </Pressable>
            </View>
          </View>
          {plan && actionable ? (
            <Pressable
              onPress={() => generate.mutate(undefined)}
              disabled={generate.isPending}
              className="mt-1 h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-70"
              style={generate.isPending ? { opacity: 0.6 } : undefined}
            >
              {generate.isPending ? (
                <ActivityIndicator size="small" color="#83796c" />
              ) : (
                <RefreshCw size={18} color="#83796c" />
              )}
            </Pressable>
          ) : null}
        </View>

        {showCreateTakeover ? (
          <View className="mt-8 items-center rounded-3xl bg-surface p-6">
            <CalendarRange size={28} color="#ff8a3d" />
            <Text className="mt-3 text-sm font-sans-semibold text-foreground">
              {isSoloPlanner
                ? "Planifica tus comidas en solitario"
                : monthStatus === "next-unlocked"
                  ? `Prepara tu plan de ${monthTitle(month)}`
                  : "Todavía no tienes plan de este mes"}
            </Text>
            <Text className="mt-1.5 text-center text-sm text-muted-foreground">
              {isSoloPlanner
                ? `Las comidas compartidas de tu casa las lleva ${plannerName}. Esto planifica solo lo que comes por tu cuenta (desayunos, snacks y los días que no compartís).`
                : monthStatus === "next-unlocked"
                  ? "Créalo ya y tendrás la lista de la compra lista antes de que empiece el mes."
                  : "Un mes de comidas flexibles y sus ingredientes del mes con precios, ajustada a tu presupuesto."}
            </Text>
            <Pressable
              onPress={() => generate.mutate(undefined)}
              disabled={generate.isPending || planQ.isLoading}
              className="mt-5 w-full items-center rounded-full bg-primary py-4 active:opacity-90"
              style={generate.isPending || planQ.isLoading ? { opacity: 0.6 } : undefined}
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {generate.isPending
                  ? "Preparando tu mes..."
                  : isSoloPlanner
                    ? "Planificar mis comidas en solitario"
                    : monthStatus === "next-unlocked"
                      ? `Crear plan de ${monthTitle(month)}`
                      : "Crear plan del mes"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="mt-6 flex-row gap-2 rounded-full bg-secondary/80 p-1">
              {(
                [
                  ["plan", "Plan", CalendarRange],
                  ["compra", "Ingredientes", ShoppingBasket],
                ] as const
              ).map(([key, label, Icon]) => {
                const active = tab === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setTab(key)}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-full py-2.5 active:opacity-80 ${
                      active ? "bg-surface" : ""
                    }`}
                  >
                    <Icon size={14} color={active ? "#ff8a3d" : "#83796c"} />
                    <Text
                      className={`text-xs font-sans-medium ${active ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {isSoloPlanner && hasSharedMeals ? (
              <View className="mt-4 flex-row items-start gap-2 rounded-2xl bg-secondary/60 px-3.5 py-2.5">
                <Users size={14} color="#83796c" style={{ marginTop: 2 }} />
                <Text className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
                  Las comidas compartidas de tu casa las lleva{" "}
                  <Text className="font-sans-medium text-foreground">{plannerName}</Text>. Aquí solo
                  planificas y ves tus comidas en solitario.
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
                      <Sparkles size={16} color="#ff8a3d" />
                      <Text className="text-sm font-sans-semibold text-foreground">
                        Cómo enfocamos el mes
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
                      Solo cocinas con lo que has comprado. Si te saltas un día, dímelo en el chat y
                      recoloco los siguientes.
                    </Text>
                  </View>
                ) : null}

                <PlanMonthCalendar
                  plan={plan}
                  month={month}
                  logs={monthLogsQ.data ?? []}
                  monthStatus={monthStatus}
                  appStartedOn={appStartedOn}
                  householdChildren={hh?.children}
                  onOpenDay={setOpenDay}
                />

                {!plan && !(monthLogsQ.data?.length ?? 0) ? (
                  <Text className="px-1 text-sm text-muted-foreground">
                    No planificaste {monthTitle(month)}.
                  </Text>
                ) : null}
              </View>
            ) : isSoloPlanner ? (
              <View className="mt-5 gap-6">
                {hasHouseholdShopping ? (
                  <View className="gap-3">
                    <View className="flex-row items-center gap-2 px-0.5">
                      <Users size={16} color="#ff8a3d" />
                      <Text className="font-heading text-lg text-foreground">
                        La compra de la casa
                      </Text>
                    </View>
                    <Text className="px-0.5 text-xs leading-relaxed text-muted-foreground">
                      La lleva {plannerName}. Marca lo que ya tengas y sal a comprar cuando quieras;
                      las cantidades y la frecuencia las decide {plannerName}.
                    </Text>
                    <IngredientsTab
                      shopping={plannerShopping}
                      currentTrip={hhCurrentTrip}
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
                      confirmedTrips={hhConfirmedTrips}
                      confirmTrip={hhConfirmTrip}
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
                    <ShoppingBasket size={16} color="#ff8a3d" />
                    <Text className="font-heading text-lg text-foreground">
                      Tu compra en solitario
                    </Text>
                  </View>

                  {hasOwnPlanRow ? (
                    <IngredientsTab
                      shopping={shopping}
                      currentTrip={currentTrip}
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
                      confirmedTrips={confirmedTrips}
                      confirmTrip={confirmTrip}
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
                  ) : (
                    <View className="items-center rounded-3xl bg-surface p-5">
                      <Text className="text-center text-sm text-muted-foreground">
                        Aún no tienes lista propia. Planifica tus comidas en solitario (desayunos,
                        snacks y los días que no compartís) y aparecerá aquí.
                      </Text>
                      {actionable ? (
                        <Pressable
                          onPress={() => generate.mutate(undefined)}
                          disabled={generate.isPending}
                          className="mt-4 w-full items-center rounded-full bg-primary py-3.5 active:opacity-90"
                          style={generate.isPending ? { opacity: 0.6 } : undefined}
                        >
                          <Text className="text-sm font-sans-semibold text-primary-foreground">
                            {generate.isPending
                              ? "Preparando…"
                              : "Planificar mis comidas en solitario"}
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
                confirmedTrips={confirmedTrips}
                confirmTrip={confirmTrip}
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
        onClose={() => setOpenDay(null)}
      />

      {showShopCta ? (
        <View className="absolute inset-x-0 bottom-[124px] px-5">
          <Pressable
            onPress={() => {
              setShopSource("own");
              setShopMode(true);
            }}
            className="mx-auto w-full max-w-lg flex-row items-center justify-center gap-2 rounded-[20px] bg-primary py-4 active:opacity-90"
          >
            <ShoppingCart size={17} color="#fbfaf7" />
            <Text className="text-sm font-sans-bold text-primary-foreground">
              Ir a comprar · {needCount} art.
            </Text>
          </Pressable>
        </View>
      ) : null}

      <BottomNav />
    </SafeAreaView>
  );
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

const SIGNAL_BG: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-muted",
};

// Calendario del mes con detalle de día en modal, equivalente RN del
// PlanMonthCalendar de la web. Los días pasados llevan el semáforo de
// cumplimiento y abren el detalle reducido del día (`onOpenDay`).
function PlanMonthCalendar({
  plan,
  month,
  logs,
  monthStatus,
  appStartedOn,
  householdChildren,
  onOpenDay,
}: {
  plan: MonthlyPlan | null;
  month: string;
  logs: DailyLog[];
  monthStatus: PlanMonthStatus;
  appStartedOn: string | null;
  /** Niños de la casa, para el plato aparte cuando el compartido no vale (issue 07). */
  householdChildren?: { id: string; name: string }[];
  onOpenDay: (date: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const [year, m] = month.split("-").map(Number);
  const monthIdx = (m ?? 1) - 1;
  const y = year ?? new Date().getFullYear();
  const daysInMonth = new Date(y, monthIdx + 1, 0).getDate();
  const firstOffset = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
  const isoDay = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const fromDay = plan?.coverage?.fromDay ?? 1;
  const logByDate = new Map(logs.map((l) => [l.log_date, l]));

  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDay(i + 1)),
  ];

  const detail = selected ? planForDate(plan, selected) : null;
  const meals = selected ? mealsForDate(plan, selected).filter((meal) => meal.idea) : [];
  // Platos aparte de los niños ese día (issue 07), por slot.
  const kidMealsBySlot = new Map<string, { name: string; dish: string; off: string[] }[]>();
  if (selected) {
    for (const c of householdChildren ?? []) {
      for (const k of childMealsForDate(plan, selected, c.id)) {
        const list = kidMealsBySlot.get(k.slot) ?? [];
        list.push({ name: c.name, dish: k.dish, off: k.off });
        kidMealsBySlot.set(k.slot, list);
      }
    }
  }

  return (
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">Calendario del mes</Text>
      <Text className="mt-1 text-xs text-muted-foreground">
        {monthStatus === "past"
          ? "Toca un día para ver lo que comiste y sus macros."
          : "Toca un día pasado para ver lo que comiste; uno futuro para su menú."}
      </Text>

      <View className="mt-4 flex-row flex-wrap">
        {WEEKDAYS.map((d, i) => (
          <View key={`${d}-${i}`} className="items-center py-1" style={{ width: `${100 / 7}%` }}>
            <Text className="text-[11px] font-sans-medium text-muted-foreground">{d}</Text>
          </View>
        ))}
        {cells.map((date, i) => {
          if (!date)
            return <View key={`empty-${i}`} className="p-0.5" style={{ width: `${100 / 7}%` }} />;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          const isToday = date === today;
          const isPast = date < today;
          const log = logByDate.get(date);
          const inertBefore =
            isBeforeAppStart(date, appStartedOn) || Number(date.slice(8, 10)) < fromDay;

          if (inertBefore && !log) {
            return (
              <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
                <View className="aspect-square items-center justify-center rounded-xl bg-muted/50">
                  <Text className="text-sm text-muted-foreground/40">
                    {Number(date.slice(8, 10))}
                  </Text>
                </View>
              </View>
            );
          }

          if (isPast) {
            const habits = log?.habits ?? [];
            const signal = ratioSignal(habits.filter((h) => h.done).length, habits.length);
            const bg = SIGNAL_BG[signal] ?? "bg-secondary/70";
            return (
              <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
                <Pressable
                  onPress={() => onOpenDay(date)}
                  className={`aspect-square items-center justify-center rounded-xl active:opacity-80 ${bg}`}
                >
                  <Text className="text-sm text-foreground">{Number(date.slice(8, 10))}</Text>
                </Pressable>
              </View>
            );
          }

          return (
            <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
              <Pressable
                onPress={() => setSelected(date)}
                className={`aspect-square items-center justify-center rounded-xl active:opacity-80 ${
                  isWeekend ? "bg-accent/60" : "bg-secondary"
                } ${isToday ? "border-2 border-primary" : ""}`}
                style={isToday ? { borderWidth: 2 } : undefined}
              >
                <Text className="text-sm text-foreground">{Number(date.slice(8, 10))}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Verde: todas las comidas. Amarillo: comiste algo. Gris: sin comidas ese día.
      </Text>

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={
          selected
            ? new Date(`${selected}T00:00:00`).toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : ""
        }
      >
        {detail ? (
          <View className="gap-3">
            <Text className="text-xs text-muted-foreground">
              {detail.week.label} · {detail.week.focus}
            </Text>
            <View className="gap-2">
              {meals.map((meal) => {
                const note = offListNote(meal.off);
                return (
                  <View key={meal.slot} className="rounded-xl bg-secondary p-3">
                    <Text className="text-xs font-sans-semibold text-primary">{meal.moment}</Text>
                    <Text className="mt-1 text-sm text-foreground">{meal.idea}</Text>
                    {note ? (
                      <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
                        <Text className="text-[11px] font-sans-medium text-foreground">{note}</Text>
                      </View>
                    ) : null}
                    {(kidMealsBySlot.get(meal.slot) ?? []).map((k) => (
                      <Text
                        key={`${k.name}-${k.dish}`}
                        className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground"
                      >
                        Para {k.name}: <Text className="text-foreground">{k.dish}</Text>
                        {offListNote(k.off) ? ` · ${offListNote(k.off)}` : ""}
                      </Text>
                    ))}
                    <DishRecipe dish={meal.idea} month={month} />
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">
            Este día todavía no tiene menú en el plan.
          </Text>
        )}
      </Dialog>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Icono por categoría de supermercado. Las categorías las escribe la IA como
// texto libre ("Frutas y verduras", "Pescado y carne"...), así que el match es
// por palabra clave, no por nombre exacto.
// ---------------------------------------------------------------------------
const CATEGORY_MATCHERS: [RegExp, typeof Carrot][] = [
  [/verdura|fruta|hortaliza/i, Carrot],
  [/pescado|carne|proteín|pollo|ternera/i, Fish],
  [/despensa|conserva|cereal|legumbre|pasta|arroz|aceite/i, Wheat],
  [/lácteo|huevo|leche|yogur|queso/i, Egg],
];

function CategoryIcon({
  category,
  size = 15,
  color = "#ff8a3d",
}: {
  category: string;
  size?: number;
  color?: string;
}) {
  const match = CATEGORY_MATCHERS.find(([re]) => re.test(category));
  if (!match) return null;
  const Icon = match[1];
  return <Icon size={size} color={color} />;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

// Relleno de barra de progreso que anima su ancho al cambiar, para igualar la
// transición `duration-500` de la web (React Native no anima cambios de estilo
// por sí solo). `Animated` clásico basta: nada de anchura por native driver.
function ProgressFill({ pct, color, rounded }: { pct: number; color: string; rounded?: boolean }) {
  const target = clampPct(pct);
  const w = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: target, duration: 500, useNativeDriver: false }).start();
  }, [target, w]);
  return (
    <Animated.View
      style={{
        height: "100%",
        backgroundColor: color,
        borderRadius: rounded ? 999 : 0,
        width: w.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }),
      }}
    />
  );
}

/**
 * Tarjeta "Ya lo tengo en casa (fuera del plan)": la persona añade ingredientes
 * que ya tiene y que la lista de la compra no incluye. El planificador los
 * cuenta como disponibles al recolocar (no se añaden a la compra). Copia del
 * `PantryExtrasCard` de la web.
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
    <View className="mt-1 rounded-3xl bg-surface px-4 py-3.5">
      <View className="flex-row items-center gap-2">
        <Carrot size={15} color="#ff8a3d" />
        <Text className="flex-1 text-[12.5px] font-sans-semibold text-foreground">
          Ya lo tengo en casa · fuera del plan
        </Text>
      </View>
      <Text className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        Si tienes algo que la lista no incluye, dímelo y lo tendré en cuenta al recolocar los
        próximos días. No se añade a la compra.
      </Text>
      <View className="mt-2.5 flex-row gap-1.5">
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
          placeholder="p. ej. lentejas, espinacas..."
          placeholderTextColor="#a89f92"
          className="min-w-0 flex-1 rounded-full bg-secondary px-3.5 py-2 text-xs text-foreground"
        />
        <Pressable
          onPress={add}
          disabled={pantry.isPending || !name.trim()}
          className="h-9 w-9 items-center justify-center rounded-full bg-foreground active:opacity-80"
          style={pantry.isPending || !name.trim() ? { opacity: 0.4 } : undefined}
        >
          <Plus size={16} color="#f3f1ed" />
        </Pressable>
      </View>
      {extras.length ? (
        <View className="mt-2.5 flex-row flex-wrap gap-1.5">
          {extras.map((e) => (
            <View
              key={e.name}
              className="flex-row items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1"
            >
              <Text className="text-[11.5px] text-foreground">{e.name}</Text>
              {e.source === "receipt" ? <Receipt size={12} color="#83796c" /> : null}
              <Pressable
                onPress={() => pantry.mutate({ name: e.name, remove: true })}
                disabled={pantry.isPending}
                hitSlop={6}
              >
                <X size={12} color="#83796c" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pestaña Ingredientes — una compra a la vez, un solo gesto por ingrediente y
// filtros por chip. Portada del rediseño web (src/routes/_authenticated/plan.tsx).
// ---------------------------------------------------------------------------
function IngredientsTab({
  shopping,
  currentTrip,
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
  onToggle,
  confirmedTrips = {},
  confirmTrip,
  pantryExtras,
  pantry,
  month,
  monthStatus,
  readOnly,
  tripActual,
  periodBudget,
  overBudget,
  plannerLocked = false,
  plannerName,
  onEnterShopMode,
}: {
  shopping: ShoppingList | null;
  currentTrip: TripGroups | undefined;
  tripsTotal: number;
  activeCadence: ShoppingCadence;
  pendingCadence: ShoppingCadence | null;
  coverage: PlanCoverage | undefined;
  todayDayOfMonth: number;
  selectedTrip: number;
  setSelectedTrip: (t: number) => void;
  filter: "need" | "have" | "all";
  setFilter: (f: "need" | "have" | "all") => void;
  recadence: { isPending: boolean; mutate: (c: ShoppingCadence) => void };
  setPendingCadence: (c: ShoppingCadence) => void;
  onToggle: (itemName: string, next: "fridge" | "store" | null) => void;
  confirmedTrips?: TripConfirmations;
  confirmTrip?: { isPending: boolean; mutate: (v: { trip: number; confirmed: boolean }) => void };
  pantryExtras: PantryExtra[];
  pantry: {
    isPending: boolean;
    mutate: (v: { name: string; qty?: string; remove?: boolean }) => void;
  };
  month: string;
  monthStatus: PlanMonthStatus;
  readOnly: boolean;
  /** Gasto real registrado para la compra seleccionada (o undefined). */
  tripActual: number | undefined;
  periodBudget: number;
  overBudget: boolean;
  /** Lista de la casa vista por un no planificador (issue 06): se puede marcar
   *  y comprar, pero no regenerar ni cambiar la cadencia. */
  plannerLocked?: boolean;
  plannerName?: string;
  /** Si se pasa, el `IngredientsTab` muestra su propio CTA "Ir a comprar" en
   *  línea (para la vista con dos listas apiladas). */
  onEnterShopMode?: () => void;
}) {
  const timing = tripTiming(tripsTotal, selectedTrip, todayDayOfMonth, coverage);
  // Mes que viene desbloqueado: la compra se hace entera ahora. Mes pasado: solo
  // lectura. Mes en curso: cualquier compra que no haya pasado ya (puedes
  // auditar la nevera para la semana que viene por adelantado); las compras ya
  // pasadas quedan bloqueadas.
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

  // Items de esta compra, filtrados por el chip activo
  const filteredGroups = useMemo(() => {
    if (!currentTrip) return [];
    return currentTrip.groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter((i) => {
          if (filter === "need") return !i.owned;
          if (filter === "have") return !!i.owned;
          return true;
        }),
      }))
      .filter((g) => g.items.length);
  }, [currentTrip, filter]);

  const totalItems = currentTrip?.groups.reduce((s, g) => s + g.items.length, 0) ?? 0;
  const needCount =
    currentTrip?.groups.reduce((s, g) => s + g.items.filter((i) => !i.owned).length, 0) ?? 0;
  const haveCount = totalItems - needCount;
  const pctResolved = totalItems > 0 ? Math.round((haveCount / totalItems) * 100) : 0;

  const tripRange = tripDayRange(coverage ?? FULL_COVERAGE, tripsTotal, selectedTrip);
  const monthShort = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "short",
  });

  // Frescos que esta compra no cubre sin que se estropeen: no cambia la lista,
  // solo avisa de comprarlos más cerca de cuando se cocinan.
  const freshRisks = freshRisksForTrip(
    tripGroups,
    coverage ?? FULL_COVERAGE,
    tripsTotal,
    selectedTrip,
  );

  const barHome = total > 0 ? (alreadyHome / total) * 100 : 0;
  const barBought = total > 0 ? (alreadyBought / total) * 100 : 0;

  return (
    <View className="mt-5 gap-2.5">
      {readOnly ? (
        <View className="rounded-[20px] bg-secondary/60 px-4 py-3">
          <Text className="text-xs leading-relaxed text-muted-foreground">
            Compra de un mes ya pasado: se muestra solo para consultar, no se puede modificar.
          </Text>
        </View>
      ) : plannerLocked ? null : (
        /* Cadencia */
        <View className="rounded-3xl bg-surface px-4 py-3.5">
          <View className="flex-row items-center gap-2">
            <CalendarSync size={15} color="#ff8a3d" />
            <Text className="flex-1 text-[12.5px] font-sans-semibold text-foreground">
              Cada cuánto compras
            </Text>
          </View>
          <View className="mt-2.5 flex-row gap-1 rounded-full bg-secondary/70 p-1">
            {CADENCES.map((c) => {
              const active = (pendingCadence ?? activeCadence) === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => {
                    if (recadence.isPending || c.key === activeCadence) return;
                    setPendingCadence(c.key);
                    recadence.mutate(c.key);
                  }}
                  disabled={recadence.isPending}
                  className={`flex-1 items-center rounded-full py-2.5 active:opacity-80 ${
                    active ? "bg-foreground" : ""
                  }`}
                  style={recadence.isPending ? { opacity: 0.6 } : undefined}
                >
                  <Text
                    className={`text-[11.5px] font-sans-semibold ${
                      active ? "text-background" : "text-muted-foreground"
                    }`}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
            {recadence.isPending
              ? "Actualizando…"
              : tripsTotal > 1
                ? `${tripsTotal} compras separadas, cada una con lo de sus semanas.`
                : "1 sola compra: apóyate en despensa y congelados; los frescos, sobre la marcha."}
          </Text>
        </View>
      )}

      {/* Aviso de presupuesto: es del mes entero, no de una compra. */}
      {overBudget ? (
        <View className="rounded-3xl bg-destructive/10 px-4 py-3">
          <Text className="text-xs leading-relaxed text-destructive">
            El mes se pasa de tu presupuesto ({eur(periodBudget)}). Puedo ajustarlo: regenera el
            plan o dímelo en el chat.
          </Text>
        </View>
      ) : null}

      {/* Navegador de compra ← → */}
      {tripsTotal > 1 ? (
        <View className="flex-row items-center gap-2 rounded-full bg-secondary/60 p-1">
          <Pressable
            onPress={() => setSelectedTrip(Math.max(0, selectedTrip - 1))}
            disabled={selectedTrip === 0}
            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-70"
            style={selectedTrip === 0 ? { opacity: 0.4 } : undefined}
          >
            <ChevronLeft size={14} color="#83796c" />
          </Pressable>
          <View className="min-w-0 flex-1 items-center">
            <Text className="text-[12.5px] font-sans-semibold text-foreground">
              {activeCadence === "mensual"
                ? "Compra única del mes"
                : `Compra ${selectedTrip + 1} de ${tripsTotal}`}
              {monthStatus === "current" && timing === "current" ? " · esta semana" : ""}
            </Text>
            <Text className="font-mono text-[10px] text-muted-foreground">
              {tripRange.from} – {tripRange.to} {monthShort}
            </Text>
          </View>
          <Pressable
            onPress={() => setSelectedTrip(Math.min(tripsTotal - 1, selectedTrip + 1))}
            disabled={selectedTrip === tripsTotal - 1}
            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-70"
            style={selectedTrip === tripsTotal - 1 ? { opacity: 0.4 } : undefined}
          >
            <ChevronRight size={14} color="#83796c" />
          </Pressable>
        </View>
      ) : null}

      {/* Resumen "Te falta comprar" */}
      <View className="rounded-3xl bg-surface p-5">
        <Text className="text-xs font-sans-semibold text-muted-foreground">Te falta comprar</Text>
        <View className="mt-0.5 flex-row items-baseline gap-2">
          <Text className="font-heading text-4xl tabular-nums text-primary">
            {eur(stillPending)}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {needCount} artículo{needCount === 1 ? "" : "s"}
          </Text>
        </View>
        <View className="mt-3.5 h-2 flex-row overflow-hidden rounded-full bg-secondary">
          <ProgressFill pct={barHome} color="#4cae64" />
          <ProgressFill pct={barBought} color="rgba(76,174,100,0.5)" />
        </View>
        <View className="mt-2.5 flex-row flex-wrap gap-3">
          <View className="flex-row items-center gap-1.5">
            <View className="h-[7px] w-[7px] rounded-full bg-success" />
            <Text className="text-[11.5px] text-muted-foreground">En casa {eur(alreadyHome)}</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-[7px] w-[7px] rounded-full bg-success/50" />
            <Text className="text-[11.5px] text-muted-foreground">
              Comprado {eur(alreadyBought)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-[7px] w-[7px] rounded-full bg-secondary" />
            <Text className="text-[11.5px] text-muted-foreground">Total {eur(total)}</Text>
          </View>
        </View>
        {tripActual != null ? (
          <Text className="mt-2 text-xs text-muted-foreground">
            Gastaste en esta compra:{" "}
            <Text className="font-sans-semibold text-foreground">{eur(tripActual)}</Text>
            {tripActual !== total ? (
              <Text className={tripActual > total ? "text-destructive" : "text-success"}>
                {" "}
                ({tripActual > total ? "+" : ""}
                {eur(tripActual - total)} vs. lo estimado)
              </Text>
            ) : null}
          </Text>
        ) : null}
      </View>

      {/* Botón de fijar ingredientes de esta compra: aparece cuando todos los
          items están resueltos y la compra aún no está fijada. */}
      {confirmTrip &&
      editable &&
      !confirmedTrips[selectedTrip] &&
      needCount === 0 &&
      totalItems > 0 ? (
        <Pressable
          onPress={() => confirmTrip.mutate({ trip: selectedTrip, confirmed: true })}
          disabled={confirmTrip.isPending}
          className="flex-row items-center justify-center gap-2 rounded-full bg-success py-3.5 active:opacity-90"
          style={confirmTrip.isPending ? { opacity: 0.6 } : undefined}
        >
          <Check size={16} color="#fff" />
          <Text className="text-sm font-sans-semibold text-white">
            {confirmTrip.isPending ? "Fijando…" : "Fijar ingredientes de esta compra"}
          </Text>
        </Pressable>
      ) : confirmedTrips[selectedTrip] ? (
        <View className="flex-row items-center justify-center gap-2 rounded-full bg-success/15 py-3">
          <Lock size={13} color="#4cae64" />
          <Text className="text-xs font-sans-semibold text-success">
            Compra fijada el {new Date(confirmedTrips[selectedTrip]).toLocaleDateString("es-ES")}
          </Text>
        </View>
      ) : null}

      {/* Aviso de frescura: frescos que no aguantan los días de esta compra. */}
      {freshRisks.length ? (
        <View className="rounded-3xl bg-warning/20 px-4 py-3">
          <Text className="text-xs leading-relaxed text-foreground">
            {freshRiskNames(freshRisks)} {freshRisks.length === 1 ? "no aguanta" : "no aguantan"}{" "}
            los {tripRange.to - tripRange.from + 1} días de esta compra. Cómpralo
            {freshRisks.length === 1 ? "" : "s"} más cerca de cuando los vayas a cocinar.
          </Text>
        </View>
      ) : null}

      {/* Cabecera + filtros */}
      <View className="mt-1 flex-row items-center justify-between gap-2.5 px-0.5">
        <Text className="font-heading text-xl text-foreground">Ingredientes</Text>
        <Text className="text-[11.5px] text-muted-foreground">{pctResolved}% ya resuelto</Text>
      </View>
      <Text className="px-0.5 text-xs leading-relaxed text-muted-foreground">
        Marca lo que ya tengas en casa; lo que quede sin marcar es tu lista del súper. Cuando
        termines, pulsa Ir a comprar.
      </Text>

      <View className="flex-row gap-1.5">
        {(
          [
            ["all", "Todo", totalItems],
            ["need", "Falta comprar", needCount],
            ["have", "Ya lo tengo", haveCount],
          ] as const
        ).map(([key, chipLabel, count]) => {
          const active = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              className={`flex-row items-center gap-1.5 rounded-full px-3 py-2 active:opacity-80 ${
                active ? "bg-foreground" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-xs font-sans-semibold ${
                  active ? "text-background" : "text-muted-foreground"
                }`}
              >
                {chipLabel}
              </Text>
              <Text
                className={`font-mono text-[11px] ${active ? "text-background" : "text-muted-foreground"}`}
              >
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Grupos de categoría */}
      <View className="gap-2.5">
        {filteredGroups.map((g) => (
          <View key={g.category} className="rounded-3xl bg-surface px-4 pb-1.5 pt-3.5">
            <View className="flex-row items-center gap-2 pb-1.5">
              <CategoryIcon category={g.category} />
              <Text className="flex-1 text-[11px] font-sans-bold uppercase tracking-wide text-muted-foreground">
                {g.category}
              </Text>
              <Text className="font-mono text-[11px] text-muted-foreground">{g.items.length}</Text>
            </View>
            {g.items.map((item, i) => {
              const have = !!item.owned;
              return (
                <Pressable
                  key={`${item.name}-${i}`}
                  onPress={() => {
                    if (!editable) return;
                    onToggle(item.name, item.owned ? null : "fridge");
                  }}
                  className={`flex-row items-center gap-3 border-t border-secondary py-2.5 ${
                    editable ? "active:opacity-60" : ""
                  }`}
                >
                  <View
                    className={`h-[26px] w-[26px] items-center justify-center rounded-full ${
                      have ? "bg-success" : "border-[1.5px] border-border"
                    }`}
                  >
                    {have ? <Check size={14} color="#fbfaf7" /> : null}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text
                      className={`text-[14.5px] font-sans-medium ${
                        have ? "text-muted-foreground line-through" : "text-foreground"
                      }`}
                    >
                      {item.name}
                    </Text>
                    {item.qty ? (
                      <Text className="font-mono text-[10.5px] text-muted-foreground">
                        {item.qty}
                      </Text>
                    ) : null}
                  </View>
                  <View className="items-end">
                    <Text className="font-mono text-xs text-muted-foreground">
                      {eur(item.price_eur)}
                    </Text>
                    {have ? (
                      <Text className="text-[10px] font-sans-semibold text-success">
                        {item.owned === "store" ? "Comprado" : "En casa"}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        {!shopping?.length ? (
          <Text className="text-sm text-muted-foreground">
            {readOnly
              ? "No hubo lista de la compra este mes."
              : plannerLocked
                ? `Aún no hay lista de la casa. La prepara ${plannerName ?? "quien planifica"}.`
                : "Aún no hay lista. Regenera el plan para crearla."}
          </Text>
        ) : filteredGroups.length === 0 ? (
          <Text className="px-0.5 text-sm text-muted-foreground">
            {filter === "need"
              ? "No te falta nada de esta compra."
              : filter === "have"
                ? "Todavía no has marcado nada como que ya lo tienes."
                : "Esta compra no tiene ingredientes."}
          </Text>
        ) : null}
      </View>

      {/* Ya tengo en casa fuera del plan */}
      {readOnly ? null : <PantryExtrasCard extras={pantryExtras} pantry={pantry} />}

      {/* Tip de persistencia */}
      {readOnly ? null : (
        <View className="mt-1 flex-row items-start gap-2.5 rounded-3xl bg-primary/10 px-4 py-3.5">
          <Lightbulb size={15} color="#ff8a3d" style={{ marginTop: 2 }} />
          <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
            Lo que marques como "en casa" se guarda para las siguientes compras del mes: no te lo
            volveré a pedir mientras te dure.
          </Text>
        </View>
      )}

      {/* CTA "Ir a comprar" en línea — para la vista con dos listas apiladas
          (compra de la casa + compra en solitario); en la vista de una sola
          lista el CTA lo pinta la pantalla, fijo al fondo. */}
      {onEnterShopMode && editable && (shopping?.length ?? 0) > 0 && needCount > 0 ? (
        <Pressable
          onPress={onEnterShopMode}
          className="mt-1 flex-row items-center justify-center gap-2 rounded-[20px] bg-primary py-4 active:opacity-90"
        >
          <ShoppingCart size={17} color="#fbfaf7" />
          <Text className="text-sm font-sans-bold text-primary-foreground">
            Ir a comprar · {needCount} art.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Modo compra — pantalla completa solo con lo que falta coger en el súper.
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
  trip: TripGroups | undefined;
  coverage: PlanCoverage | undefined;
  tripsTotal: number;
  selectedTrip: number;
  month: string;
  onToggle: (itemName: string, next: "store" | null) => void;
  onClose: () => void;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
  onScanReceipt: (imageBase64: string, mime: string) => void;
  scanningReceipt: boolean;
}) {
  const [text, setText] = useState(tripActual != null ? String(tripActual) : "");

  // Deja elegir foto (galería o cámara), la reescala a ~1280 px JPEG y la manda
  // al servidor como base64. Necesita el módulo nativo `expo-image-picker`: hasta
  // el próximo build nativo el botón avisa en vez de fallar.
  const pickReceipt = async () => {
    try {
      const ImagePicker = await import("expo-image-picker");
      const ImageManipulator = await import("expo-image-manipulator");
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Necesito acceso a tus fotos para leer el tiquet");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const shrunk = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (shrunk.base64) onScanReceipt(shrunk.base64, "image/jpeg");
    } catch (e) {
      Alert.alert("El escaneo de tiquets estará disponible en la próxima versión de la app.");
      console.warn("pickReceipt", e);
    }
  };

  // El modo compra no muestra lo que ya se tenía en casa (nevera): solo lo que
  // hay que coger o lo que se acaba de meter en el carro en esta sesión.
  const shopGroups = useMemo(() => {
    if (!trip) return [];
    return trip.groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter((i) => i.owned !== "fridge"),
      }))
      .filter((g) => g.items.length);
  }, [trip]);

  const allItems = shopGroups.flatMap((g) => g.items);
  const leftItems = allItems.filter((i) => !i.owned);
  const leftTotal = Math.round(leftItems.reduce((s, i) => s + i.price_eur, 0) * 100) / 100;
  const doneTotal =
    Math.round(
      allItems.filter((i) => i.owned === "store").reduce((s, i) => s + i.price_eur, 0) * 100,
    ) / 100;
  const pct = allItems.length ? ((allItems.length - leftItems.length) / allItems.length) * 100 : 0;
  const allDone = allItems.length > 0 && leftItems.length === 0;

  const tripRange = tripDayRange(coverage ?? FULL_COVERAGE, tripsTotal, selectedTrip);
  const freshRisks = trip
    ? freshRisksForTrip(trip.groups, coverage ?? FULL_COVERAGE, tripsTotal, selectedTrip)
    : [];
  const monthShort = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "short",
  });

  // Último importe enviado, para que `commitActual` no repita la misma mutación
  // cuando lo disparan seguidos el onBlur del campo y el onPress del botón.
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
    <View className="flex-1">
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pt-6 pb-40">
        {/* Cabecera modo compra */}
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={onClose}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70"
          >
            <ChevronLeft size={16} color="#83796c" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
              Compra {selectedTrip + 1} de {tripsTotal} · {tripRange.from}–{tripRange.to}{" "}
              {monthShort}
            </Text>
            <Text className="font-heading text-2xl text-foreground">En el súper</Text>
          </View>
        </View>

        {/* Resumen compra */}
        <View className="mt-4 rounded-3xl bg-surface p-5">
          <View className="flex-row items-end justify-between gap-3">
            <View className="min-w-0">
              <Text className="text-xs font-sans-semibold text-muted-foreground">
                Queda por coger
              </Text>
              <Text className="mt-0.5 font-heading text-3xl tabular-nums text-primary">
                {eur(leftTotal)}
              </Text>
            </View>
            <View className="items-end">
              <Text className="font-mono text-[11px] text-muted-foreground">en el carro</Text>
              <Text className="mt-0.5 font-mono-medium text-[15px] text-success">
                {eur(doneTotal)}
              </Text>
            </View>
          </View>
          <View className="mt-3.5 h-2 overflow-hidden rounded-full bg-secondary">
            <ProgressFill pct={pct} color="#4cae64" rounded />
          </View>
          <Text className="mt-2 text-[11.5px] text-muted-foreground">
            {leftItems.length} de {allItems.length} por coger · lo que ya tienes en casa no aparece
            aquí
          </Text>
        </View>

        {freshRisks.length ? (
          <View className="mt-3.5 rounded-2xl bg-warning/20 px-4 py-3">
            <Text className="text-xs leading-relaxed text-foreground">
              {freshRiskNames(freshRisks)} {freshRisks.length === 1 ? "no aguanta" : "no aguantan"}{" "}
              los {tripRange.to - tripRange.from + 1} días hasta la próxima compra. Cógelo
              {freshRisks.length === 1 ? "" : "s"} justo para los primeros platos.
            </Text>
          </View>
        ) : null}

        {/* Lista de ingredientes agrupados */}
        <View className="mt-3.5 gap-4">
          {shopGroups.map((g) => (
            <View key={g.category}>
              <View className="flex-row items-center gap-2 px-1 pb-2">
                <CategoryIcon category={g.category} />
                <Text className="text-[11px] font-sans-bold uppercase tracking-wide text-muted-foreground">
                  {g.category}
                </Text>
              </View>
              <View className="gap-1.5">
                {g.items.map((item, i) => {
                  const done = item.owned === "store";
                  return (
                    <Pressable
                      key={`${item.name}-${i}`}
                      onPress={() => onToggle(item.name, done ? null : "store")}
                      className={`flex-row items-center gap-3.5 rounded-2xl px-4 py-3.5 active:opacity-80 ${
                        done ? "bg-secondary/50" : "bg-surface"
                      }`}
                    >
                      <View
                        className={`h-7 w-7 items-center justify-center rounded-[9px] ${
                          done ? "bg-success" : "border-[1.5px] border-border"
                        }`}
                      >
                        {done ? <Check size={16} color="#fbfaf7" /> : null}
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text
                          className={`text-base font-sans-semibold ${
                            done ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                        >
                          {item.name}
                        </Text>
                        <Text className="font-mono text-[11px] text-muted-foreground">
                          {item.qty ? `${item.qty} · ` : ""}
                          {eur(item.price_eur)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {shopGroups.length === 0 ? (
            <Text className="px-1 text-sm text-muted-foreground">
              Nada que coger en esta compra: ya lo tienes todo en casa o comprado.
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Cierre de la compra — botón fijo al fondo (diseño 1b) */}
      <View className="absolute inset-x-0 bottom-0 border-t border-secondary bg-background px-5 pb-8 pt-3">
        <View className="mx-auto w-full max-w-lg">
          {allDone ? (
            <View className="gap-3">
              <View className="flex-row items-center gap-2 rounded-2xl bg-surface px-4 py-3">
                <Text className="flex-1 text-xs text-muted-foreground">¿Cuánto gastaste?</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  onBlur={commitActual}
                  placeholder={eur(doneTotal)}
                  keyboardType="decimal-pad"
                  editable={!savingActual}
                  className="w-24 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm text-foreground"
                  style={savingActual ? { opacity: 0.6 } : undefined}
                />
                <Text className="text-xs text-muted-foreground">€</Text>
              </View>
              <Pressable
                onPress={pickReceipt}
                disabled={scanningReceipt}
                className="flex-row items-center justify-center gap-2 rounded-2xl border border-secondary py-3 active:opacity-80"
                style={scanningReceipt ? { opacity: 0.6 } : undefined}
              >
                <Receipt size={16} color="#83796c" />
                <Text className="text-xs font-sans-semibold text-muted-foreground">
                  {scanningReceipt ? "Leyendo el tiquet..." : "Escanear tiquet y calcularlo"}
                </Text>
              </Pressable>
              <Text className="text-[10.5px] leading-relaxed text-muted-foreground">
                La foto se usa solo para leer el total y los productos; no se guarda.
              </Text>
              <Pressable
                onPress={() => {
                  // El botón "guardar gasto" no puede fiarse solo del onBlur del
                  // campo: si se pulsa con el teclado abierto, RN cierra la
                  // pantalla antes de que el blur guarde. Confirmamos aquí.
                  commitActual();
                  onClose();
                }}
                className="items-center rounded-2xl bg-success py-4 active:opacity-90"
              >
                <Text className="text-sm font-sans-bold text-success-foreground">
                  Compra completa · guardar gasto
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={onClose}
              className="items-center rounded-2xl bg-foreground py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-bold text-background">Terminar compra</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
