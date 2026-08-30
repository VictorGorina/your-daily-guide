import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
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
  Sparkles,
  Wheat,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { DishRecipe } from "../../components/dish-recipe";
import { HistorialSection } from "../../components/historial-section";
import { Dialog } from "../../components/ui/dialog";
import { apiPost } from "../../lib/api";
import { fetchMonthlyPlan, fetchProfile, monthISO, todayISO } from "../../lib/daily";
import {
  boughtTotal,
  cadenceOf,
  CADENCES,
  coverageRatio,
  eur,
  groupByTrip,
  homeTotal,
  mealsForDate,
  offListNote,
  pendingTotal,
  planForDate,
  shoppingTotal,
  tripActualsTotal,
  tripDayRange,
  tripsOfCadence,
  tripTiming,
  type MonthlyPlan,
  type PlanCoverage,
  type ShoppingCadence,
  type ShoppingItem,
  type ShoppingList,
  type TripActuals,
} from "../../lib/plan-shared";

type GenerateResult = { plan: MonthlyPlan; shopping: ShoppingList };

type TripGroups = { trip: number; groups: { category: string; items: ShoppingItem[] }[] };

const FULL_COVERAGE: PlanCoverage = { fromDay: 1, toDay: 31 };

export default function Plan() {
  const qc = useQueryClient();
  const month = monthISO();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"plan" | "compra" | "historial">(
    params.tab === "compra" || params.tab === "historial" ? params.tab : "plan",
  );
  const [cadence, setCadence] = useState<ShoppingCadence | null>(null);

  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });

  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/generate", {
        month,
        cadence: nextCadence ?? cadence ?? "mensual",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) =>
      Alert.alert(e instanceof Error ? e.message : "No hemos podido crear el plan ahora mismo"),
  });

  // Cambiar la cadencia solo reparte la misma compra en más o menos viajes según
  // los platos reales de cada semana, sin regenerar el plan por IA (ver AGENTS.md).
  const recadence = useMutation({
    mutationFn: (nextCadence: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/recadence", { month, cadence: nextCadence }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, plan: res.plan, shopping: res.shopping } : prev,
      );
    },
    onError: (e) => {
      setCadence(null);
      Alert.alert(e instanceof Error ? e.message : "No hemos podido cambiar la frecuencia");
    },
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

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  const total = shoppingTotal(shopping);
  const alreadyHome = homeTotal(shopping);
  const alreadyBought = boughtTotal(shopping);
  const stillPending = pendingTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const spentSoFar = tripActualsTotal(tripActuals);
  const hasActuals = Object.keys(tripActuals).length > 0;
  const coverage = plan?.coverage;
  const activeCadence: ShoppingCadence = cadence ?? plan?.cadence ?? cadenceOf(shopping);
  const tripsTotal = tripsOfCadence(activeCadence);
  const trips = groupByTrip(shopping, tripsTotal);
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
  // Filtro de ingredientes: "need" (falta), "have" (ya lo tengo), "all"
  const [filter, setFilter] = useState<"need" | "have" | "all">("need");
  // Modo compra a pantalla completa
  const [shopMode, setShopMode] = useState(false);

  const clampedTrip = Math.min(selectedTrip, Math.max(0, tripsTotal - 1));
  const currentTrip = trips[clampedTrip] ?? trips[0];

  const budget = Number(profileQ.data?.budget_month_eur ?? 0);
  // Si el plan empieza a media de mes, el presupuesto que aplica es la parte
  // proporcional del mes que cubre, no el mes entero.
  const periodBudget =
    budget > 0 && coverage ? Math.round(budget * coverageRatio(coverage, month)) : budget;
  const overBudget = periodBudget > 0 && total > periodBudget;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

  const needCount =
    currentTrip?.groups.reduce((s, g) => s + g.items.filter((i) => !i.owned).length, 0) ?? 0;
  const showShopCta =
    Boolean(plan) && tab === "compra" && !shopMode && (shopping?.length ?? 0) > 0 && needCount > 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-40 pt-6">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-sans-medium uppercase tracking-wide text-muted-foreground">
              Plan mensual
            </Text>
            <Text className="font-heading text-3xl capitalize text-foreground" numberOfLines={1}>
              {monthLabel}
            </Text>
          </View>
          {plan ? (
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

        {!plan ? (
          <View className="mt-8 items-center rounded-3xl bg-surface p-6">
            <CalendarRange size={28} color="#ff8a3d" />
            <Text className="mt-3 text-sm font-sans-semibold text-foreground">
              Todavía no tienes plan de este mes
            </Text>
            <Text className="mt-1.5 text-center text-sm text-muted-foreground">
              Un mes de comidas flexibles y sus ingredientes del mes con precios, ajustada a tu
              presupuesto.
            </Text>
            <Pressable
              onPress={() => generate.mutate(undefined)}
              disabled={generate.isPending || planQ.isLoading}
              className="mt-5 w-full items-center rounded-full bg-primary py-4 active:opacity-90"
              style={generate.isPending || planQ.isLoading ? { opacity: 0.6 } : undefined}
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {generate.isPending ? "Preparando tu mes..." : "Crear plan del mes"}
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
                  ["historial", "Historial", CalendarDays],
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

            {tab === "plan" ? (
              <View className="mt-5 gap-5">
                <View className="rounded-3xl bg-surface p-5">
                  <View className="flex-row items-center gap-2">
                    <Sparkles size={16} color="#ff8a3d" />
                    <Text className="text-sm font-sans-semibold text-foreground">
                      Cómo enfocamos el mes
                    </Text>
                  </View>
                  <Text className="mt-2 text-sm leading-relaxed text-foreground">{plan.intro}</Text>
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

                <PlanMonthCalendar plan={plan} month={month} />
              </View>
            ) : tab === "historial" ? (
              <HistorialSection />
            ) : shopMode ? (
              <ShopModeView
                trip={currentTrip}
                coverage={coverage}
                tripsTotal={tripsTotal}
                selectedTrip={clampedTrip}
                month={month}
                onToggle={(itemName, next) =>
                  owned.mutate({ itemName, trip: clampedTrip, source: next })
                }
                onClose={() => setShopMode(false)}
                tripActual={tripActuals[clampedTrip]}
                savingActual={setActual.isPending}
                onSaveActual={(amount) => setActual.mutate({ trip: clampedTrip, amount })}
              />
            ) : (
              <IngredientsTab
                shopping={shopping}
                currentTrip={currentTrip}
                tripsTotal={tripsTotal}
                activeCadence={activeCadence}
                coverage={coverage}
                todayDayOfMonth={todayDayOfMonth}
                selectedTrip={clampedTrip}
                setSelectedTrip={setSelectedTrip}
                filter={filter}
                setFilter={setFilter}
                recadence={recadence}
                setCadence={setCadence}
                onToggle={(itemName, next) =>
                  owned.mutate({ itemName, trip: clampedTrip, source: next })
                }
                month={month}
                total={total}
                alreadyHome={alreadyHome}
                alreadyBought={alreadyBought}
                stillPending={stillPending}
                spentSoFar={spentSoFar}
                hasActuals={hasActuals}
                periodBudget={periodBudget}
                overBudget={overBudget}
              />
            )}
          </>
        )}
      </ScrollView>

      {showShopCta ? (
        <View className="absolute inset-x-0 bottom-[96px] px-5">
          <Pressable
            onPress={() => setShopMode(true)}
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

// Calendario del mes con detalle de día en modal, equivalente RN del
// PlanMonthCalendar de la web.
function PlanMonthCalendar({ plan, month }: { plan: MonthlyPlan; month: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const [year, m] = month.split("-").map(Number);
  const monthIdx = (m ?? 1) - 1;
  const y = year ?? new Date().getFullYear();
  const daysInMonth = new Date(y, monthIdx + 1, 0).getDate();
  const firstOffset = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
  const isoDay = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDay(i + 1)),
  ];

  const detail = selected ? planForDate(plan, selected) : null;
  const meals = selected ? mealsForDate(plan, selected).filter((meal) => meal.idea) : [];

  return (
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">Calendario del mes</Text>
      <Text className="mt-1 text-xs text-muted-foreground">
        Toca un día para ver su menú completo.
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
          return (
            <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
              <Pressable
                onPress={() => setSelected(date)}
                className={`aspect-square items-center justify-center rounded-xl active:opacity-80 ${
                  isWeekend ? "bg-accent/60" : "bg-secondary"
                } ${isToday ? "border-2 border-primary" : ""}`}
                style={isToday ? { borderWidth: 2 } : undefined}
              >
                <Text
                  className={`text-sm ${
                    date < today && !isWeekend ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

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
  setCadence,
  onToggle,
  month,
  total,
  alreadyHome,
  alreadyBought,
  stillPending,
  spentSoFar,
  hasActuals,
  periodBudget,
  overBudget,
}: {
  shopping: ShoppingList | null;
  currentTrip: TripGroups | undefined;
  tripsTotal: number;
  activeCadence: ShoppingCadence;
  coverage: PlanCoverage | undefined;
  todayDayOfMonth: number;
  selectedTrip: number;
  setSelectedTrip: (t: number) => void;
  filter: "need" | "have" | "all";
  setFilter: (f: "need" | "have" | "all") => void;
  recadence: { isPending: boolean; mutate: (c: ShoppingCadence) => void };
  setCadence: (c: ShoppingCadence) => void;
  onToggle: (itemName: string, next: "fridge" | "store" | null) => void;
  month: string;
  total: number;
  alreadyHome: number;
  alreadyBought: number;
  stillPending: number;
  spentSoFar: number;
  hasActuals: boolean;
  periodBudget: number;
  overBudget: boolean;
}) {
  const timing = tripTiming(tripsTotal, selectedTrip, todayDayOfMonth, coverage);
  const editable = timing === "current";

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

  const barHome = total > 0 ? (alreadyHome / total) * 100 : 0;
  const barBought = total > 0 ? (alreadyBought / total) * 100 : 0;

  return (
    <View className="mt-5 gap-2.5">
      {/* Cadencia */}
      <View className="rounded-3xl bg-surface px-4 py-3.5">
        <View className="flex-row items-center gap-2">
          <CalendarSync size={15} color="#ff8a3d" />
          <Text className="flex-1 text-[12.5px] font-sans-semibold text-foreground">
            Cada cuánto compras
          </Text>
        </View>
        <View className="mt-2.5 flex-row gap-1 rounded-full bg-secondary/70 p-1">
          {CADENCES.map((c) => {
            const active = activeCadence === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => {
                  if (recadence.isPending) return;
                  setCadence(c.key);
                  if (c.key !== activeCadence) recadence.mutate(c.key);
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
            ? "Repartiendo la compra..."
            : tripsTotal > 1
              ? `${tripsTotal} compras separadas, cada una con su lista.`
              : "1 sola compra: menos frescos, más despensa."}
        </Text>
      </View>

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
              {timing === "current" ? " · esta semana" : ""}
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
          <View className="h-full bg-success" style={{ width: `${barHome}%` }} />
          <View className="h-full bg-success/50" style={{ width: `${barBought}%` }} />
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
        {hasActuals ? (
          <Text className="mt-2 text-xs text-muted-foreground">
            Gasto real hasta ahora:{" "}
            <Text className="font-sans-semibold text-foreground">{eur(spentSoFar)}</Text>
            {spentSoFar !== total ? (
              <Text className={spentSoFar > total ? "text-destructive" : "text-success"}>
                {" "}
                ({spentSoFar > total ? "+" : ""}
                {eur(spentSoFar - total)} vs. lo estimado)
              </Text>
            ) : null}
          </Text>
        ) : null}
        {overBudget ? (
          <Text className="mt-2 text-xs text-destructive">
            Se pasa de tu presupuesto ({eur(periodBudget)}). Puedo ajustarlo: regenera el plan o
            dímelo en el chat.
          </Text>
        ) : null}
      </View>

      {/* Cabecera + filtros */}
      <View className="mt-1 flex-row items-center justify-between gap-2.5 px-0.5">
        <Text className="font-heading text-xl text-foreground">Ingredientes</Text>
        <Text className="text-[11.5px] text-muted-foreground">{pctResolved}% ya resuelto</Text>
      </View>
      <Text className="px-0.5 text-xs leading-relaxed text-muted-foreground">
        Toca un ingrediente para marcarlo como que ya lo tienes en casa. Lo que quede sin marcar es
        tu lista del súper.
      </Text>

      <View className="flex-row gap-1.5">
        {(
          [
            ["need", "Falta comprar", needCount],
            ["have", "Ya lo tengo", haveCount],
            ["all", "Todo", totalItems],
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
            {g.items.map((item) => {
              const have = !!item.owned;
              return (
                <Pressable
                  key={item.name}
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
            Aún no hay lista. Regenera el plan para crearla.
          </Text>
        ) : filteredGroups.length === 0 ? (
          <Text className="px-0.5 text-sm text-muted-foreground">
            {filter === "need"
              ? "No te falta nada de esta compra. 🎉"
              : filter === "have"
                ? "Todavía no has marcado nada como que ya lo tienes."
                : "Esta compra no tiene ingredientes."}
          </Text>
        ) : null}
      </View>

      {/* Tip de persistencia */}
      <View className="mt-1 flex-row items-start gap-2.5 rounded-3xl bg-primary/10 px-4 py-3.5">
        <Lightbulb size={15} color="#ff8a3d" style={{ marginTop: 2 }} />
        <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
          Lo que marques como "en casa" se guarda para las siguientes compras del mes: no te lo
          volveré a pedir mientras te dure.
        </Text>
      </View>
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
}) {
  const [text, setText] = useState(tripActual != null ? String(tripActual) : "");

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
  const monthShort = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "short",
  });

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
    <View className="mt-5">
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
            Compra {selectedTrip + 1} de {tripsTotal} · {tripRange.from}–{tripRange.to} {monthShort}
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
          <View className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
        </View>
        <Text className="mt-2 text-[11.5px] text-muted-foreground">
          {leftItems.length} de {allItems.length} por coger · lo que ya tienes en casa no aparece
          aquí
        </Text>
      </View>

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
              {g.items.map((item) => {
                const done = item.owned === "store";
                return (
                  <Pressable
                    key={item.name}
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

      {/* Cierre de la compra */}
      {allDone ? (
        <View className="mt-6 gap-3">
          <View className="flex-row items-center gap-2 rounded-2xl bg-surface px-4 py-3">
            <Text className="flex-1 text-xs text-muted-foreground">¿Cuánto gastaste?</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              onBlur={commitActual}
              placeholder={eur(leftTotal)}
              keyboardType="decimal-pad"
              editable={!savingActual}
              className="w-24 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm text-foreground"
              style={savingActual ? { opacity: 0.6 } : undefined}
            />
            <Text className="text-xs text-muted-foreground">€</Text>
          </View>
          <Pressable
            onPress={onClose}
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
          className="mt-6 items-center rounded-2xl bg-foreground py-4 active:opacity-90"
        >
          <Text className="text-sm font-sans-bold text-background">Terminar compra</Text>
        </Pressable>
      )}
    </View>
  );
}
